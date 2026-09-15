import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  selectProject,
} from './helpers'

// Home against the running app: it is the launch view, it lists every terminal
// where it lives, and what the operator writes about a session is still there
// after a restart. Addressed by role and name (contracts/ui-surfaces.md).

let handle: AppHandle | undefined
let folder: string

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'home-'))
})

test.afterEach(async () => {
  await closeApp(handle)
  handle = undefined
  rmSync(folder, { recursive: true, force: true })
})

async function openHome(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: /^Home/ })
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
}

test('the app opens on Home', async () => {
  handle = await launchApp()
  await expect(handle.page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(handle.page.getByText('No terminals are open')).toBeVisible()
})

test('Home lists each terminal under its workspace and branch, asking what it is for', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)

  const group = page.getByRole('rowgroup', { name: 'Repo One / feature-a' })
  await expect(group).toBeVisible()
  const rows = group.getByRole('row')
  await expect(rows).toHaveCount(1)
  await expect(
    rows.first().getByRole('textbox', { name: 'What is this session doing?' })
  ).toBeVisible()
})

test('a description survives a restart, and a closed session is found by it', async () => {
  handle = await launchApp()
  const profile = handle.userDataDir
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)

  const box = page
    .getByRole('rowgroup', { name: 'Repo One / feature-a' })
    .getByRole('textbox', { name: 'What is this session doing?' })
  await box.fill('Checking the ghostty keybinds')
  await box.press('Enter')
  await expect(page.getByText('Checking the ghostty keybinds')).toBeVisible()

  await closeApp(handle, { keepProfile: true })
  handle = await launchApp(profile)
  const restarted = handle.page
  await expect(restarted.getByRole('heading', { name: 'Home' })).toBeVisible()

  const closed = restarted.getByRole('rowgroup', { name: 'Closed' })
  await expect(closed.getByText('Checking the ghostty keybinds')).toBeVisible()

  await restarted.getByRole('searchbox', { name: 'Filter sessions' }).fill('ghostty')
  await expect(closed.getByRole('row')).toHaveCount(1)
  await expect(restarted.getByRole('rowgroup')).toHaveCount(1)
  await restarted.getByRole('searchbox', { name: 'Filter sessions' }).fill('nothing like this')
  await expect(restarted.getByText('No sessions match')).toBeVisible()
})

test('the Logbook is remembered, and describing a session there names it in the list', async () => {
  handle = await launchApp()
  const profile = handle.userDataDir
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
  await page
    .getByRole('radiogroup', { name: 'Layout' })
    .getByRole('radio', { name: 'Logbook' })
    .click()

  const list = page.getByRole('listbox', { name: 'Sessions' })
  await list.getByRole('option', { name: /Add a description/ }).click()
  const box = page.getByRole('textbox', { name: 'What is this session doing?' })
  await expect(box).toBeFocused()
  await box.fill('Trying the Logbook')
  await page.getByRole('button', { name: 'Save description' }).click()
  await expect(list.getByRole('option', { name: /Trying the Logbook/ })).toBeVisible()

  await closeApp(handle, { keepProfile: true })
  handle = await launchApp(profile)
  await expect(
    handle.page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: 'Logbook' })
  ).toHaveAttribute('aria-checked', 'true')
})

test('linking a session says where to connect a tracker when none is', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)

  await page
    .getByRole('rowgroup', { name: 'Repo One / feature-a' })
    .getByRole('button', { name: 'Link a work item' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Link a work item' })
  await expect(dialog.getByRole('alert')).toHaveText(
    'No issue tracker is connected. Connect Linear or Jira in Settings → Integrations.'
  )
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})

test('the link dialog closes on Escape and on a click outside it', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)

  const link = page
    .getByRole('rowgroup', { name: 'Repo One / feature-a' })
    .getByRole('button', { name: 'Link a work item' })
  const dialog = page.getByRole('dialog', { name: 'Link a work item' })

  await link.click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await link.click()
  await expect(dialog).toBeVisible()
  await page.mouse.click(40, 700)
  await expect(dialog).toBeHidden()
})

test("the Ledger's columns and grouping survive a restart", async () => {
  handle = await launchApp()
  const profile = handle.userDataDir
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)

  await page.getByRole('region', { name: 'Home' }).getByRole('button', { name: 'Display' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Latest output' }).click()
  await page.getByRole('menuitemradio', { name: 'Branch', exact: true }).click()
  await expect(page.getByRole('rowgroup', { name: 'feature-a' })).toBeVisible()

  await closeApp(handle, { keepProfile: true })
  handle = await launchApp(profile)
  const restarted = handle.page
  // Terminals do not survive a restart, so give the Ledger a row to arrange.
  await selectProject(restarted, 'Repo One', 'feature-a')
  await openHome(restarted)
  await expect(restarted.getByRole('columnheader', { name: 'Session' })).toBeVisible()
  await expect(restarted.getByRole('columnheader', { name: 'Latest output' })).toHaveCount(0)
  await expect(restarted.getByRole('rowgroup', { name: 'feature-a' })).toBeVisible()
})

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

test('every Home menu opens inside the window, wherever its button sits', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)

  const home = page.getByRole('region', { name: 'Home' })
  await home.getByRole('button', { name: 'Display' }).click()
  await assertMenuOnScreen(page, 'Display options')
  await page.keyboard.press('Escape')
  await page.mouse.click(600, 600)

  await home.getByRole('button', { name: 'New terminal' }).click()
  await assertMenuOnScreen(page, 'Start a terminal')
})

test('the empty state opens its menu inside the window too', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  // Close the only terminal, so Home shows its empty state.
  await page.locator('.tab-bar__close').first().click()
  await openHome(page)
  await expect(page.getByText('No terminals are open')).toBeVisible()

  await page
    .getByRole('region', { name: 'Home' })
    .getByRole('button', { name: 'New terminal' })
    .last()
    .click()
  await assertMenuOnScreen(page, 'Start a terminal')
})

test('a terminal can be started from Home, on a branch or as a scratch', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
  await expect(
    page.getByRole('rowgroup', { name: 'Repo One / feature-a' }).getByRole('row')
  ).toHaveCount(1)

  const home = page.getByRole('region', { name: 'Home' })
  await home.getByRole('button', { name: 'New terminal' }).click()
  await page.getByRole('menuitem', { name: 'New terminal in Repo One / feature-a' }).click()
  // Starting a terminal shows it, so Home gives way to the terminal.
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(2)

  await openHome(page)
  await expect(
    page.getByRole('rowgroup', { name: 'Repo One / feature-a' }).getByRole('row')
  ).toHaveCount(2)

  await home.getByRole('button', { name: 'New terminal' }).click()
  await page.getByRole('menuitem', { name: 'New scratch terminal' }).click()
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(1)
  await openHome(page)
  await expect(page.getByRole('rowgroup', { name: 'No branch' }).getByRole('row')).toHaveCount(1)
})

/** Height, text size and corner radius of a control, as rendered. */
async function shapeOf(
  scope: ReturnType<Page['getByRole']>,
  name: string | RegExp,
  nth = 0
): Promise<Record<string, string>> {
  return scope
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

test('Home draws its controls as one set, in the bar and in the empty state', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)

  const home = page.getByRole('region', { name: 'Home' })
  const needsYou = await shapeOf(home, /Needs you/)
  expect(await shapeOf(home, /^New terminal$/)).toEqual(needsYou)
  expect(await shapeOf(home, /^Display$/)).toEqual(needsYou)

  // Close the only terminal, so the empty state's two buttons sit side by side.
  await page.getByRole('button', { name: /^Home/ }).click()
  await page.locator('.tab-bar__close').first().click()
  await openHome(page)
  await expect(page.getByText('No terminals are open')).toBeVisible()
  expect(await shapeOf(home, /^New terminal$/, 1)).toEqual(await shapeOf(home, /^Go to terminals$/))
})

test('the Ledger fits its surface at every width, with every column on', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)

  // Tags is the one column off by default; with it on the row is at its widest.
  await page.getByRole('region', { name: 'Home' }).getByRole('button', { name: 'Display' }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Tags' }).click()
  await page.mouse.click(500, 700)

  for (const width of [1440, 1100, 900, 780]) {
    await page.setViewportSize({ width, height: 800 })
    const measured = await page.evaluate(() => {
      const home = document.querySelector('.home')!.getBoundingClientRect()
      const grid = document.querySelector('.ledger') as HTMLElement
      const age = document.querySelector('.ledger__row .ledger__age')!.getBoundingClientRect()
      return {
        overflow: grid.scrollWidth - grid.clientWidth,
        ageGap: Math.round(home.right - age.right),
      }
    })
    expect(measured.overflow, `no sideways scroll at ${width}px`).toBeLessThanOrEqual(0)
    expect(measured.ageGap, `gutter at ${width}px`).toBeGreaterThanOrEqual(12)
  }
})
