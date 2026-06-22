import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace, workspaceCard } from './helpers'

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
  const card = workspaceCard(page, 'My Test Workspace')
  await expect(card.locator('.ws-card__name')).toContainText('My Test Workspace')
  await expect(card.locator('.ws-card__band')).toBeVisible()
})

test('US1-3: right-clicking a workspace shows a context menu with Edit and Remove', async () => {
  const { page } = handle
  await workspaceCard(page, 'My Test Workspace')
    .locator('.ws-card__header')
    .click({ button: 'right' })
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
  await workspaceCard(page, 'My Test Workspace')
    .locator('.ws-card__header')
    .click({ button: 'right' })
  await page.locator('.ctx-menu__item').filter({ hasText: 'Edit workspace' }).click()
  await expect(page.locator('.dialog__title')).toContainText('Edit Workspace')
  const nameInput = page.locator('.dialog__input').first()
  await nameInput.fill('Renamed Workspace')
  await page.click('.dialog__btn-primary')
  await expect(
    page.locator('.ws-card__name').filter({ hasText: 'Renamed Workspace' })
  ).toBeVisible()
})

test('US1-5: removing a workspace removes it from the sidebar (in-app confirm)', async () => {
  const { page, userDataDir } = handle
  await createWorkspace(page, 'Temp Workspace', userDataDir)
  const before = await page.locator('.ws-card').count()

  await workspaceCard(page, 'Temp Workspace').locator('.ws-card__header').click({ button: 'right' })
  await page.locator('.ctx-menu__item').filter({ hasText: 'Remove workspace' }).click()
  // In-app ConfirmDialog (no native browser dialog)
  await expect(page.locator('.dialog__title')).toContainText('Remove workspace')
  await page.locator('.dialog__btn-primary').filter({ hasText: 'Remove' }).click()

  await expect(page.locator('.ws-card')).toHaveCount(before - 1)
  await expect(page.locator('.ws-card__name').filter({ hasText: 'Temp Workspace' })).toHaveCount(0)
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
