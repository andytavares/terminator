import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace, workspaceRow } from './helpers'

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('US1-1: clicking New workspace opens a dialog with name, folder, and color fields', async () => {
  const { page } = handle
  await page.click('.sidebar-header__add')
  await expect(page.locator('.dialog__title')).toContainText('Create Workspace')
  await expect(page.getByPlaceholder('My Workspace')).toBeVisible()
  await expect(page.getByPlaceholder('/path/to/folder')).toBeVisible()
  await expect(page.locator('.dialog__colors')).toBeVisible()
  // CreateWorkspaceDialog closes via Cancel/overlay (no Escape handler).
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.dialog__title')).toHaveCount(0)
})

test('US1-2: created workspace appears in sidebar with name and color band', async () => {
  const { page, userDataDir } = handle
  await createWorkspace(page, 'My Test Workspace', userDataDir)
  const card = workspaceRow(page, 'My Test Workspace')
  await expect(card.locator('.repo-header__name')).toContainText('My Test Workspace')
  await expect(card.locator('.repo-header__swatch')).toBeVisible()
})

test('US1-3: right-clicking a workspace shows a context menu with Edit and Remove', async () => {
  const { page } = handle
  await workspaceRow(page, 'My Test Workspace').click({ button: 'right' })
  await expect(page.locator('.ctx-menu')).toBeVisible()
  await expect(page.locator('.ctx-menu__item').filter({ hasText: 'Edit workspace' })).toBeVisible()
  await expect(
    page.locator('.ctx-menu__item').filter({ hasText: 'Remove workspace' })
  ).toBeVisible()
  // The context menu closes on any window click (no Escape handler).
  await page.getByPlaceholder('Search…').click()
  await expect(page.locator('.ctx-menu')).toHaveCount(0)
})

test('US1-4: editing a workspace name updates the sidebar immediately', async () => {
  const { page } = handle
  await workspaceRow(page, 'My Test Workspace').click({ button: 'right' })
  await page.locator('.ctx-menu__item').filter({ hasText: 'Edit workspace' }).click()
  await expect(page.locator('.dialog__title')).toContainText('Edit Workspace')
  const nameInput = page.locator('.dialog__input').first()
  await nameInput.fill('Renamed Workspace')
  await page.click('.dialog__btn-primary')
  await expect(
    page.locator('.repo-header__name').filter({ hasText: 'Renamed Workspace' })
  ).toBeVisible()
})

test('US1-5: removing a workspace removes it from the sidebar (in-app confirm)', async () => {
  const { page, userDataDir } = handle
  await createWorkspace(page, 'Temp Workspace', userDataDir)
  const before = await page.locator('.repo-header').count()

  await workspaceRow(page, 'Temp Workspace').click({ button: 'right' })
  await page.locator('.ctx-menu__item').filter({ hasText: 'Remove workspace' }).click()
  // In-app ConfirmDialog (no native browser dialog). Addressed by role and
  // accessible name rather than by class: the implementation moved into
  // @terminator/extension-ui with this feature, and a test that names a CSS
  // class breaks on a refactor that changed nothing a user can see.
  const confirm = page.getByRole('dialog')
  await expect(confirm).toContainText('Remove workspace')
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click()

  await expect(page.locator('.repo-header')).toHaveCount(before - 1)
  await expect(
    page.locator('.repo-header__name').filter({ hasText: 'Temp Workspace' })
  ).toHaveCount(0)
})

test('US1-bonus: duplicate workspace name shows an inline error on submit', async () => {
  const { page } = handle
  await page.click('.sidebar-header__add')
  await page.waitForSelector('.dialog__title')
  await page.getByPlaceholder('My Workspace').fill('Renamed Workspace')
  // Moving focus to the folder field blurs the name field, which validates and
  // surfaces the duplicate-name error (the submit button stays disabled).
  await page.getByPlaceholder('/path/to/folder').fill(handle.userDataDir)
  await expect(page.locator('.dialog__error')).toContainText('already exists')
  await expect(page.locator('.dialog__btn-primary')).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()
})

test('SC-004: app renders the sidebar within 3000ms', async () => {
  const { page } = handle
  const start = Date.now()
  await page.waitForSelector('.unified-sidebar', { timeout: 3000 })
  expect(Date.now() - start).toBeLessThan(3000)
})
