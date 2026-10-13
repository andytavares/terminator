import { test, expect } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  workspaceRow,
  projectGroup,
} from './helpers'

let handle: AppHandle
const WS = 'Project Test Workspace'

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, WS, handle.userDataDir)
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function addBranchOpensCreateDialog(): Promise<void> {
  const { page } = handle
  await workspaceRow(page, WS).locator('.repo-header__action[aria-label^="New branch in"]').click()
  await expect(page.locator('.tmui-dialog__title')).toContainText('Create Branch')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.tmui-dialog__title')).toHaveCount(0)
}

async function createdProjectAppears(): Promise<void> {
  const { page } = handle
  await workspaceRow(page, WS).locator('.repo-header__action[aria-label^="New branch in"]').click()
  await page.waitForSelector('.tmui-dialog__title')
  await page.getByPlaceholder('My branch').fill('alpha-project')
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(projectGroup(page, 'alpha-project')).toBeVisible()
}

async function projectShowsTabbedTerminals(): Promise<void> {
  const { page } = handle
  await projectGroup(page, 'alpha-project').click()
  // A project view has a primary tab bar (Terminal/Git/…) and a session tab bar.
  await expect(page.locator('.tab-bar--sessions')).toBeVisible()
  // Selecting a project auto-creates its first terminal session.
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(1)
}

async function plusOpensSessionTab(): Promise<void> {
  const { page } = handle
  const sessionTabs = page.locator('.tab-bar__tab--session')
  const before = await sessionTabs.count()
  await page.click('.tab-bar__new-tab')
  await expect(sessionTabs).toHaveCount(before + 1)
}

async function sessionTabsTrackActiveTab(): Promise<void> {
  const { page } = handle
  const sessionTabs = page.locator('.tab-bar__tab--session')
  await page.click('.tab-bar__new-tab')
  await expect.poll(() => sessionTabs.count()).toBeGreaterThanOrEqual(2)

  await sessionTabs.first().click()
  await expect(sessionTabs.first()).toHaveClass(/tab-bar__tab--active/)

  await sessionTabs.nth(1).click()
  await expect(sessionTabs.nth(1)).toHaveClass(/tab-bar__tab--active/)
  await expect(sessionTabs.first()).not.toHaveClass(/tab-bar__tab--active/)
}

// One story: every test after the first two acts on the 'alpha-project'
// branch the second test creates. Serial keeps them running in order.
test.describe.serial('project view', () => {
  test('US2-1: clicking Add Branch shows the Create Branch dialog', addBranchOpensCreateDialog)

  test('US2-2: a created project appears under its workspace', createdProjectAppears)

  test(
    'US2-3: clicking a project switches the main area to the tabbed terminal view',
    projectShowsTabbedTerminals
  )

  test('US2-4: clicking "+" in the tab bar opens a new terminal session tab', plusOpensSessionTab)

  test('US2-5: multiple session tabs track the active tab independently', sessionTabsTrackActiveTab)
})
