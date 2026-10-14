import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace, workspaceRow } from './helpers'
import { expectCentredInWindow } from './modal-centre'

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
  await expect(page.locator('.tmui-dialog__title')).toContainText('Create Workspace')
  await expectCentredInWindow(
    page.getByRole('dialog', { name: 'Create Workspace' }),
    'Create Workspace'
  )
  await expect(page.getByPlaceholder('My Workspace')).toBeVisible()
  await expect(page.getByPlaceholder('/path/to/folder')).toBeVisible()
  await expect(page.locator('.dialog__colors')).toBeVisible()
  // CreateWorkspaceDialog closes via Cancel/overlay (no Escape handler).
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.tmui-dialog__title')).toHaveCount(0)
})

async function createdWorkspaceAppears(): Promise<void> {
  const { page, userDataDir } = handle
  await createWorkspace(page, 'My Test Workspace', userDataDir)
  const card = workspaceRow(page, 'My Test Workspace')
  await expect(card.locator('.repo-header__name')).toContainText('My Test Workspace')
  await expect(card.locator('.repo-header__swatch')).toBeVisible()
}

async function contextMenuOffersEditAndRemove(): Promise<void> {
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
}

async function renameShowsImmediately(): Promise<void> {
  const { page } = handle
  await workspaceRow(page, 'My Test Workspace').click({ button: 'right' })
  await page.locator('.ctx-menu__item').filter({ hasText: 'Edit workspace' }).click()
  await expect(page.locator('.tmui-dialog__title')).toContainText('Edit Workspace')
  await expectCentredInWindow(
    page.getByRole('dialog', { name: 'Edit Workspace' }),
    'Edit Workspace'
  )
  const nameInput = page.locator('.dialog__input').first()
  await nameInput.fill('Renamed Workspace')
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(
    page.locator('.repo-header__name').filter({ hasText: 'Renamed Workspace' })
  ).toBeVisible()
}

async function removeTakesWorkspaceAway(): Promise<void> {
  const { page, userDataDir } = handle
  await createWorkspace(page, 'Temp Workspace', userDataDir)
  const before = await page.locator('.repo-header').count()

  await workspaceRow(page, 'Temp Workspace').click({ button: 'right' })
  await page.locator('.ctx-menu__item').filter({ hasText: 'Remove workspace' }).click()
  // The in-app ConfirmDialog, by role rather than class, so a refactor that changes
  // nothing a user sees does not break it.
  const confirm = page.getByRole('dialog')
  await expect(confirm).toContainText('Remove workspace')
  await expectCentredInWindow(confirm, 'Confirm: Remove workspace')
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click()

  await expect(page.locator('.repo-header')).toHaveCount(before - 1)
  await expect(
    page.locator('.repo-header__name').filter({ hasText: 'Temp Workspace' })
  ).toHaveCount(0)
}

async function duplicateNameShowsError(): Promise<void> {
  const { page } = handle
  await page.click('.sidebar-header__add')
  await page.waitForSelector('.tmui-dialog__title')
  await page.getByPlaceholder('My Workspace').fill('Renamed Workspace')
  // Moving focus to the folder field blurs the name field, which validates and
  // surfaces the duplicate-name error (the submit button stays disabled).
  await page.getByPlaceholder('/path/to/folder').fill(handle.userDataDir)
  await expect(page.locator('.dialog__error')).toContainText('already exists')
  await expect(page.locator('.tmui-dialog__actions .tmui-button--primary')).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()
}

// One story from here: each test acts on the workspace the previous one
// created or renamed ('My Test Workspace' → 'Renamed Workspace'). Serial
// keeps them running together, in order.
test.describe.serial('workspace lifecycle', () => {
  test(
    'US1-2: created workspace appears in sidebar with name and color band',
    createdWorkspaceAppears
  )

  test(
    'US1-3: right-clicking a workspace shows a context menu with Edit and Remove',
    contextMenuOffersEditAndRemove
  )

  test('US1-4: editing a workspace name updates the sidebar immediately', renameShowsImmediately)

  test(
    'US1-5: removing a workspace removes it from the sidebar (in-app confirm)',
    removeTakesWorkspaceAway
  )

  test(
    'US1-bonus: duplicate workspace name shows an inline error on submit',
    duplicateNameShowsError
  )
})

test('SC-004: app renders the sidebar within 3000ms', async () => {
  const { page } = handle
  const start = Date.now()
  await page.waitForSelector('.unified-sidebar', { timeout: 3000 })
  expect(Date.now() - start).toBeLessThan(3000)
})
