import { test, expect, Page } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function openExtensionsSettings(pg: Page): Promise<void> {
  await pg.keyboard.press('Meta+,')
  await pg.waitForSelector('.settings-panel', { timeout: 5000 })
  await pg.locator('.settings-panel__nav-item').filter({ hasText: 'Extensions' }).click()
}

async function closeSettings(pg: Page): Promise<void> {
  await pg.keyboard.press('Escape')
  await pg.waitForSelector('.settings-panel', { state: 'hidden', timeout: 3000 }).catch(() => {})
}

test('US6-1: the Extensions settings section renders the bundled extensions', async () => {
  const { page } = handle
  await openExtensionsSettings(page)
  await expect(page.locator('.settings-panel__content')).toBeVisible()
  // Bundled extensions (git-integration, notepad, task-vault, …) load at startup.
  await expect(page.locator('.extension-item').first()).toBeVisible()
  await closeSettings(page)
})

test('US6-2: the Extensions nav item becomes active when selected', async () => {
  const { page } = handle
  await openExtensionsSettings(page)
  await expect(
    page.locator('.settings-panel__nav-item').filter({ hasText: 'Extensions' })
  ).toHaveClass(/settings-panel__nav-item--active/)
  await closeSettings(page)
})

test('US6-3: each extension row shows a name and a toggle action', async () => {
  const { page } = handle
  await openExtensionsSettings(page)
  const firstItem = page.locator('.extension-item').first()
  await expect(firstItem.locator('.extension-item__name')).toBeVisible()
  await expect(firstItem.locator('.extension-item__actions')).toBeVisible()
  await closeSettings(page)
})

test('US6-4: toggling an extension off and on keeps the app stable', async () => {
  const { page } = handle
  await openExtensionsSettings(page)
  const toggle = page
    .locator('.extension-item__actions button, .extension-item__actions input')
    .first()
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click()
    await toggle.click()
  }
  // App and settings panel remain functional.
  await expect(page.locator('.settings-panel__content')).toBeVisible()
  await closeSettings(page)
  await expect(page.locator('.unified-sidebar')).toBeVisible()
})
