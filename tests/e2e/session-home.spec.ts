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

// Home against the running app: it is the launch view, a terminal is listed under In flight by
// the work it serves, and what the operator writes about a session names that work. Addressed by
// role and name (contracts/ui-surfaces.md).

const BRANCH = 'feature-a'
const DESCRIPTION = 'Checking the ghostty keybinds'

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(() => closeApp(handle))

const inFlight = (page: Page) => page.getByRole('region', { name: 'In flight' })
const sessionTab = (page: Page) => page.locator('.tab-bar__tab--session').first()

/** Clicks a control in a dialog or menu that has just opened over the Contributions frame: the
 * browser routes the click by the last frame it drew, which may still show the frame there. */
async function clickOnceDrawn(control: Locator): Promise<void> {
  await expect(control).toBeVisible()
  await untilDrawn(control.page())
  await control.click()
}

async function opensOnHomeWithNothingOpen(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(page.getByText('Nothing needs you.')).toBeVisible()
  await expect(inFlight(page).getByText('0 work items')).toBeVisible()
}

async function listsTerminalUnderItsWork(page: Page): Promise<void> {
  await createWorkspace(page, 'Repo One', e2eTempDir('home-'))
  await addAndSelectProject(page, 'Repo One', BRANCH)
  await openHome(page)
  await expect(inFlight(page).getByText('1 work item')).toBeVisible()
  await expect(inFlight(page).getByRole('button', { name: BRANCH })).toBeVisible()
}

async function tabMenuItem(page: Page, name: string): Promise<void> {
  await sessionTab(page).click({ button: 'right' })
  await clickOnceDrawn(page.locator('.ctx-menu').getByRole('button', { name }))
}

async function descriptionNamesTheWork(page: Page): Promise<void> {
  await selectProject(page, 'Repo One', BRANCH)
  await tabMenuItem(page, 'Add description…')
  const box = page.getByRole('textbox', { name: 'What is this session doing?' })
  await box.fill(DESCRIPTION)
  await box.press('Enter')
  await openHome(page)
  await expect(inFlight(page).getByRole('button', { name: DESCRIPTION })).toBeVisible()
}

async function openLinkDialog(page: Page): Promise<Locator> {
  await selectProject(page, 'Repo One', BRANCH)
  await tabMenuItem(page, 'Link issue…')
  return page.getByRole('dialog', { name: 'Link a work item' })
}

async function linkDialogNamesWhereToConnect(page: Page): Promise<void> {
  const dialog = await openLinkDialog(page)
  await expectCentredInWindow(dialog, 'Link a work item')
  await expect(dialog.getByRole('alert')).toHaveText(
    'No issue tracker is connected. Connect Linear or Jira in Settings → Integrations.'
  )
  await clickOnceDrawn(dialog.getByRole('button', { name: 'Cancel' }))
  await expect(dialog).toBeHidden()
}

async function linkDialogClosesOnEscape(page: Page): Promise<void> {
  const dialog = await openLinkDialog(page)
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}

async function groupMenuOpensInsideTheWindow(page: Page): Promise<void> {
  await openHome(page)
  await inFlight(page)
    .getByRole('button', { name: /^Group:/ })
    .click()
  const menu = page.getByRole('menu', { name: 'Group by' })
  await expect(menu).toBeVisible()
  const box = (await menu.boundingBox())!
  const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(view.width)
  expect(box.y + box.height).toBeLessThanOrEqual(view.height)
  await menu.getByRole('menuitemradio', { name: 'repo' }).click()
  await expect(menu).toBeHidden()
  await expect(inFlight(page).getByRole('button', { name: 'Group: repo' })).toBeVisible()
}

test('a session is kept on Home under the work it serves, and what is written about it names that work', async () => {
  test.setTimeout(90_000)
  const { page } = handle
  await test.step('the app opens on Home with nothing open', () => opensOnHomeWithNothingOpen(page))
  await test.step('Home lists a terminal under In flight, as the branch it runs on', () =>
    listsTerminalUnderItsWork(page))
  await test.step('describing a session from its tab names the work on Home', () =>
    descriptionNamesTheWork(page))
  await test.step('linking a session says where to connect a tracker when none is', () =>
    linkDialogNamesWhereToConnect(page))
  await test.step('the link dialog closes on Escape', () => linkDialogClosesOnEscape(page))
  await test.step("Home's group menu opens inside the window", () =>
    groupMenuOpensInsideTheWindow(page))
})
