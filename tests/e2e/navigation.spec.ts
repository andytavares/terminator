import { test, expect } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  e2eTempDir,
} from './helpers'
import { openHome, openOverview } from './session-views'

// Back through what the main area showed (Cmd+Option+Left). Addressed by role and name
// (contracts/ui-surfaces.md).

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(() => closeApp(handle))

test('Cmd+Option+Left returns from a terminal to Overview, and Cmd+Option+Right to the terminal', async () => {
  const { page } = handle
  await createWorkspace(page, 'Repo One', e2eTempDir('navigation-'))
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
  await openOverview(page)
  await page.getByRole('button', { name: 'feature-a' }).first().click()
  await expect(page.locator('.terminal-pane').filter({ visible: true })).toBeVisible()

  await page.keyboard.press('Meta+Alt+ArrowLeft')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  await page.keyboard.press('Meta+Alt+ArrowRight')
  await expect(page.locator('.terminal-pane').filter({ visible: true })).toBeVisible()
})
