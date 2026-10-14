import { test, expect } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  openSettingsSection,
  closeSettingsPanel,
} from './helpers'
import { expectCentredInWindow } from './modal-centre'

// The modals no other spec opens. Every other one is measured where its own spec opens it,
// with the same helper (ADR 110).

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'Centre', handle.userDataDir)
  await addAndSelectProject(handle.page, 'Centre', 'main')
})

test.afterAll(async () => closeApp(handle))

test('Move to branch opens in the middle of the window', async () => {
  const { page } = handle
  await page.locator('.tab-bar__tab--session').first().click({ button: 'right' })
  await page.locator('.ctx-menu__item', { hasText: 'Move to branch…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Move to branch' })
  await expectCentredInWindow(dialog, 'Move to branch')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('Name this terminal opens in the middle of the window', async () => {
  const { page } = handle
  await openSettingsSection(page, 'Appearance & Terminal')
  await page.getByLabel('Prompt for session name on creation').check()
  await closeSettingsPanel(page)

  await page.keyboard.press('ControlOrMeta+t')
  const dialog = page.getByRole('dialog', { name: 'Name this terminal' })
  await expectCentredInWindow(dialog, 'Name this terminal')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(1)
})
