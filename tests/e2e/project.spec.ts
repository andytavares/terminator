import { test, expect } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  expandWorkspace,
  workspaceCard,
} from './helpers'

let handle: AppHandle
const WS = 'Project Test Workspace'

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, WS, handle.userDataDir)
  await expandWorkspace(handle.page, WS)
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('US2-1: clicking Add Project shows the Create Project dialog', async () => {
  const { page } = handle
  await workspaceCard(page, WS).locator('.ws-card__add-project').click()
  await expect(page.locator('.dialog__title')).toContainText('Create Project')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.dialog__title')).toHaveCount(0)
})

test('US2-2: a created project appears under its workspace', async () => {
  const { page } = handle
  await workspaceCard(page, WS).locator('.ws-card__add-project').click()
  await page.waitForSelector('.dialog__title')
  await page.getByPlaceholder('My Project').fill('alpha-project')
  await page.click('.dialog__btn-primary')
  await expect(
    workspaceCard(page, WS).locator('.project-row').filter({ hasText: 'alpha-project' })
  ).toBeVisible()
})

test('US2-3: clicking a project switches the main area to the tabbed terminal view', async () => {
  const { page } = handle
  await workspaceCard(page, WS).locator('.project-row').filter({ hasText: 'alpha-project' }).click()
  // A project view has a primary tab bar (Terminal/Git/…) and a session tab bar.
  await expect(page.locator('.tab-bar--sessions')).toBeVisible()
  // Selecting a project auto-creates its first terminal session.
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(1)
})

test('US2-4: clicking "+" in the tab bar opens a new terminal session tab', async () => {
  const { page } = handle
  const sessionTabs = page.locator('.tab-bar__tab--session')
  const before = await sessionTabs.count()
  await page.click('.tab-bar__new-tab')
  await expect(sessionTabs).toHaveCount(before + 1)
})

test('US2-5: multiple session tabs track the active tab independently', async () => {
  const { page } = handle
  const sessionTabs = page.locator('.tab-bar__tab--session')
  await page.click('.tab-bar__new-tab')
  await expect.poll(() => sessionTabs.count()).toBeGreaterThanOrEqual(2)

  await sessionTabs.first().click()
  await expect(sessionTabs.first()).toHaveClass(/tab-bar__tab--active/)

  await sessionTabs.nth(1).click()
  await expect(sessionTabs.nth(1)).toHaveClass(/tab-bar__tab--active/)
  await expect(sessionTabs.first()).not.toHaveClass(/tab-bar__tab--active/)
})
