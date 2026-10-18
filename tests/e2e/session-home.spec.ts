import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  selectProject,
  e2eTempDir,
  untilDrawn,
} from './helpers'
import { openHome } from './session-views'
import { expectCentredInWindow } from './modal-centre'

// Home against the running app: it is the launch view, it lists every terminal
// where it lives, it ends and clears away sessions, and what the operator
// writes about a session is still there after a restart. Addressed by role and
// name (contracts/ui-surfaces.md).

// Each flow launches its own app on its own profile and folder.
test.describe.configure({ mode: 'parallel' })

const BRANCH_GROUP = 'Repo One / feature-a'
const KEPT = 'Checking the ghostty keybinds'
const REMOVED = 'chasing the flaky test'

function homeRegion(page: Page) {
  return page.getByRole('region', { name: 'Home' })
}

async function opensOnHomeWithNothingOpen(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(page.getByText('No terminals are open')).toBeVisible()
}

/** Clicks a control in a dialog or menu that has just opened over the Contributions frame: the
 * browser routes the click by the last frame it drew, which may still show the frame there. */
async function clickOnceDrawn(control: Locator): Promise<void> {
  await expect(control).toBeVisible()
  await untilDrawn(control.page())
  await control.click()
}

async function branchWithATerminal(page: Page, folder: string): Promise<void> {
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
}

async function listsTerminalUnderItsBranch(page: Page, folder: string): Promise<void> {
  await branchWithATerminal(page, folder)
  const rows = page.getByRole('rowgroup', { name: BRANCH_GROUP }).getByRole('row')
  await expect(rows).toHaveCount(1)
  await expect(
    rows.first().getByRole('textbox', { name: 'What is this session doing?' })
  ).toBeVisible()
}

/** Describes the only open session in the Ledger, which an open session can close but not remove. */
async function openSessionCanCloseButNotRemove(page: Page): Promise<void> {
  const box = page.getByRole('textbox', { name: 'What is this session doing?' }).first()
  await box.fill(REMOVED)
  await box.press('Enter')
  await expect(page.getByRole('button', { name: /^Close / })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0)
}

async function endedFromHomeThenRemoved(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Close / }).click()
  // The session is history now, description and all. (The tab bar belongs to
  // the terminal view, which Home covers, so Closed is what proves it ended.)
  const closed = page.getByRole('rowgroup', { name: 'Closed' })
  await expect(closed.getByText(REMOVED)).toBeVisible()
  await page.getByRole('button', { name: /^Remove / }).click()
  await expect(closed).toHaveCount(0)
}

async function assertMenuOnScreen(page: Page, name: string): Promise<void> {
  const menu = page.getByRole('menu', { name })
  await expect(menu).toBeVisible()
  const box = (await menu.boundingBox())!
  const view =
    page.viewportSize() ??
    (await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })))
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(view.width)
  expect(box.y + box.height).toBeLessThanOrEqual(view.height)
  // Every item inside it is readable, not clipped by the panel or a scroller.
  for (const item of await menu.getByRole('menuitem').all()) {
    const label = (await item.boundingBox())!
    expect(label.x).toBeGreaterThanOrEqual(box.x)
    expect(label.x + label.width).toBeLessThanOrEqual(box.x + box.width + 1)
  }
}

/** Height, text size and corner radius of a Home control, as rendered. */
async function shapeOf(page: Page, name: string | RegExp, nth = 0) {
  return homeRegion(page)
    .getByRole('button', { name })
    .nth(nth)
    .evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        height: `${Math.round(el.getBoundingClientRect().height)}`,
        fontSize: style.fontSize,
        borderRadius: style.borderRadius,
      }
    })
}

/** With nothing open, the empty state's own New terminal sits beside Go to terminals. */
async function emptyStateMenuAndControls(page: Page): Promise<void> {
  await expect(page.getByText('No terminals are open')).toBeVisible()
  expect(await shapeOf(page, /^New terminal$/, 1)).toEqual(await shapeOf(page, /^Go to terminals$/))
  await homeRegion(page).getByRole('button', { name: 'New terminal' }).last().click()
  await assertMenuOnScreen(page, 'Start a terminal')
}

async function startFromEmptyStateOnBranch(page: Page): Promise<void> {
  await clickOnceDrawn(page.getByRole('menuitem', { name: `New terminal in ${BRANCH_GROUP}` }))
  // Starting a terminal shows it, so Home gives way to the terminal.
  await expect(page.getByRole('heading', { name: 'Home' })).toBeHidden()
  await openHome(page)
  await expect(page.getByRole('rowgroup', { name: BRANCH_GROUP }).getByRole('row')).toHaveCount(1)
}

/** Latest output off, grouped by branch alone. */
async function arrangeLedger(page: Page): Promise<void> {
  await homeRegion(page).getByRole('button', { name: 'Display' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Latest output' }).click()
  await page.getByRole('menuitemradio', { name: 'Branch', exact: true }).click()
  await expect(page.getByRole('rowgroup', { name: 'feature-a' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Display options' })).toBeHidden()
}

function layoutRadio(page: Page, name: 'Ledger' | 'Logbook') {
  return page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name })
}

async function describeInLogbook(page: Page): Promise<void> {
  await layoutRadio(page, 'Logbook').click()
  const list = page.getByRole('listbox', { name: 'Sessions' })
  await list.getByRole('option', { name: /Add a description/ }).click()
  const box = page.getByRole('textbox', { name: 'What is this session doing?' })
  await expect(box).toBeFocused()
  await box.fill(KEPT)
  await page.getByRole('button', { name: 'Save description' }).click()
  await expect(list.getByRole('option', { name: new RegExp(KEPT) })).toBeVisible()
}

/** The first run: a session ended and removed, another described, Home arranged. */
async function aDayOnHome(page: Page, folder: string): Promise<void> {
  await test.step('the app opens on Home', () => opensOnHomeWithNothingOpen(page))
  await test.step('Home lists each terminal under its workspace and branch, asking what it is for', () =>
    listsTerminalUnderItsBranch(page, folder))
  await test.step('an open session offers no way to remove it from the list', () =>
    openSessionCanCloseButNotRemove(page))
  await test.step('a session is ended from Home, then removed from the list', () =>
    endedFromHomeThenRemoved(page))
  await test.step('the empty state draws its controls as one set and opens its menu inside the window', () =>
    emptyStateMenuAndControls(page))
  await test.step('a terminal is started from Home on a branch', () =>
    startFromEmptyStateOnBranch(page))
  await test.step("the Ledger's columns and grouping are changed", () => arrangeLedger(page))
  await test.step('describing a session in the Logbook names it in the list', () =>
    describeInLogbook(page))
}

async function logbookRemembered(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(layoutRadio(page, 'Logbook')).toHaveAttribute('aria-checked', 'true')
  await layoutRadio(page, 'Ledger').click()
}

async function closedSessionFoundByDescription(page: Page): Promise<void> {
  const closed = page.getByRole('rowgroup', { name: 'Closed' })
  await expect(closed.getByText(KEPT)).toBeVisible()
  await expect(page.getByText(REMOVED)).toHaveCount(0)
  const filter = page.getByRole('searchbox', { name: 'Filter sessions' })
  await filter.fill('ghostty')
  await expect(closed.getByRole('row')).toHaveCount(1)
  await expect(page.getByRole('rowgroup')).toHaveCount(1)
  await filter.fill('nothing like this')
  await expect(page.getByText('No sessions match')).toBeVisible()
  await filter.fill('')
}

async function ledgerArrangementRemembered(page: Page): Promise<void> {
  // Terminals do not survive a restart, so give the Ledger a row to arrange.
  await selectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
  await expect(page.getByRole('columnheader', { name: 'Session' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Latest output' })).toHaveCount(0)
  await expect(page.getByRole('rowgroup', { name: 'feature-a' })).toBeVisible()
}

async function afterRestart(page: Page): Promise<void> {
  await test.step('the Logbook is remembered across a restart', () => logbookRemembered(page))
  await test.step('a description survives a restart, a closed session is found by it, and a removed one stays gone', () =>
    closedSessionFoundByDescription(page))
  await test.step("the Ledger's columns and grouping survive a restart", () =>
    ledgerArrangementRemembered(page))
}

test("a day's sessions are kept on Home, and what was written about them survives a restart", async () => {
  test.setTimeout(90_000)
  const folder = e2eTempDir('home-')
  let handle: AppHandle | undefined = await launchApp()
  try {
    const profile = handle.userDataDir
    await aDayOnHome(handle.page, folder)
    await closeApp(handle)
    handle = undefined
    handle = await launchApp(profile)
    await afterRestart(handle.page)
  } finally {
    await closeApp(handle)
  }
})

// ---------------------------------------------------------------------------
// Home's controls: starting terminals, the link dialog, the menus and the Ledger's fit.
// ---------------------------------------------------------------------------

function linkButton(page: Page) {
  return page
    .getByRole('rowgroup', { name: BRANCH_GROUP })
    .getByRole('button', { name: 'Link a work item' })
}

async function linkDialogNamesWhereToConnect(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Link a work item' })
  await linkButton(page).click()
  await expectCentredInWindow(dialog, 'Link a work item')
  await expect(dialog.getByRole('alert')).toHaveText(
    'No issue tracker is connected. Connect Linear or Jira in Settings → Integrations.'
  )
  await clickOnceDrawn(dialog.getByRole('button', { name: 'Cancel' }))
  await expect(dialog).toBeHidden()
}

async function linkDialogClosesOnEscapeAndOutside(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Link a work item' })
  await linkButton(page).click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await linkButton(page).click()
  await expect(dialog).toBeVisible()
  await page.mouse.click(40, 700)
  await expect(dialog).toBeHidden()
}

async function everyMenuInsideTheWindow(page: Page): Promise<void> {
  await homeRegion(page).getByRole('button', { name: 'Display' }).click()
  await assertMenuOnScreen(page, 'Display options')
  await page.keyboard.press('Escape')
  await page.mouse.click(600, 600)
  await homeRegion(page).getByRole('button', { name: 'New terminal' }).click()
  await assertMenuOnScreen(page, 'Start a terminal')
  await page.mouse.click(600, 600)
  await expect(page.getByRole('menu', { name: 'Start a terminal' })).toBeHidden()
}

async function barControlsAreOneSet(page: Page): Promise<void> {
  const needsYou = await shapeOf(page, /Needs you/)
  expect(await shapeOf(page, /^New terminal$/)).toEqual(needsYou)
  expect(await shapeOf(page, /^Display$/)).toEqual(needsYou)
}

async function startOnBranchThenScratch(page: Page): Promise<void> {
  const sessionTabs = page.locator('.tab-bar__tab--session')
  await homeRegion(page).getByRole('button', { name: 'New terminal' }).click()
  await clickOnceDrawn(page.getByRole('menuitem', { name: `New terminal in ${BRANCH_GROUP}` }))
  // Starting a terminal shows it, so Home gives way to the terminal.
  await expect(sessionTabs).toHaveCount(2)
  await openHome(page)
  await expect(page.getByRole('rowgroup', { name: BRANCH_GROUP }).getByRole('row')).toHaveCount(2)
  await homeRegion(page).getByRole('button', { name: 'New terminal' }).click()
  await clickOnceDrawn(page.getByRole('menuitem', { name: 'New scratch terminal' }))
  await expect(sessionTabs).toHaveCount(1)
  await openHome(page)
  await expect(page.getByRole('rowgroup', { name: 'No branch' }).getByRole('row')).toHaveCount(1)
}

/** Run in the page: sideways overflow, and the age column's gutter, for the first Ledger row. */
function ledgerFit(): { overflow: number; ageGap: number } {
  const home = document.querySelector('.home')!.getBoundingClientRect()
  const grid = document.querySelector('.ledger') as HTMLElement
  const age = document.querySelector('.ledger__row .ledger__age')!.getBoundingClientRect()
  return {
    overflow: grid.scrollWidth - grid.clientWidth,
    ageGap: Math.round(home.right - age.right),
  }
}

async function ledgerFitsEveryWidth(page: Page): Promise<void> {
  // Tags is the one column off by default; with it on the row is at its widest.
  await homeRegion(page).getByRole('button', { name: 'Display' }).click()
  await clickOnceDrawn(page.getByRole('menuitemcheckbox', { name: 'Tags' }))
  await page.mouse.click(500, 700)
  for (const width of [1440, 1100, 900, 780]) {
    await page.setViewportSize({ width, height: 800 })
    const measured = await page.evaluate(ledgerFit)
    expect(measured.overflow, `no sideways scroll at ${width}px`).toBeLessThanOrEqual(0)
    expect(measured.ageGap, `gutter at ${width}px`).toBeGreaterThanOrEqual(12)
  }
}

test.describe('Home controls', () => {
  let handle: AppHandle

  test.beforeAll(async () => {
    handle = await launchApp()
  })

  test.afterAll(() => closeApp(handle))

  test('Home starts terminals, and its dialogs, menus and Ledger stay inside the window', async () => {
    const { page } = handle
    await branchWithATerminal(page, e2eTempDir('home-controls-'))
    await test.step('linking a session says where to connect a tracker when none is', () =>
      linkDialogNamesWhereToConnect(page))
    await test.step('the link dialog closes on Escape and on a click outside it', () =>
      linkDialogClosesOnEscapeAndOutside(page))
    await test.step('every Home menu opens inside the window, wherever its button sits', () =>
      everyMenuInsideTheWindow(page))
    await test.step('Home draws its bar controls as one set', () => barControlsAreOneSet(page))
    await test.step('a terminal can be started from Home, on a branch or as a scratch', () =>
      startOnBranchThenScratch(page))
    await test.step('the Ledger fits its surface at every width, with every column on', () =>
      ledgerFitsEveryWidth(page))
  })
})
