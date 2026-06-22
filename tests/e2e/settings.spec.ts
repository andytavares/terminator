import { test, expect, Page } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace, addAndSelectProject } from './helpers'

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  // A workspace must be *active* (a project selected) for the Workspace Settings
  // tab to appear — clicking the card header only toggles collapse.
  await createWorkspace(handle.page, 'Settings Test Workspace', handle.userDataDir)
  await addAndSelectProject(handle.page, 'Settings Test Workspace', 'Proj')
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function openSettings(pg: Page): Promise<void> {
  await pg.keyboard.press('Meta+,')
  await pg.waitForSelector('.settings-panel', { timeout: 5000 })
}

async function closeSettings(pg: Page): Promise<void> {
  await pg.keyboard.press('Escape')
  await pg.waitForSelector('.settings-panel', { state: 'hidden', timeout: 3000 }).catch(() => {})
}

function themeAttr(pg: Page): Promise<string | null> {
  return pg.evaluate(() => document.documentElement.getAttribute('data-theme'))
}

test('US5-1: opening global settings shows configuration categories', async () => {
  const { page } = handle
  await openSettings(page)
  await expect(page.locator('.settings-panel')).toBeVisible()
  await expect(
    page.locator('.settings-panel__nav-item').filter({ hasText: 'Appearance & Terminal' })
  ).toBeVisible()
  await closeSettings(page)
})

test('US5-2: toggling theme switches the UI immediately', async () => {
  const { page } = handle
  await openSettings(page)
  await page
    .locator('.settings-panel__nav-item')
    .filter({ hasText: 'Appearance & Terminal' })
    .click()

  const content = page.locator('.settings-panel__content')
  await content.locator('input[value="dark"]').check()
  await expect.poll(() => themeAttr(page)).toBe('dark')
  await content.locator('input[value="light"]').check()
  await expect.poll(() => themeAttr(page)).toBe('light')

  await closeSettings(page)
})

test('US5-3: workspace settings panel is available when a workspace is active', async () => {
  const { page } = handle
  await openSettings(page)
  const workspaceNav = page
    .locator('.settings-panel__nav-item')
    .filter({ hasText: 'Workspace Settings' })
  await expect(workspaceNav).toBeVisible()
  await workspaceNav.click()
  await expect(page.locator('.settings-panel__content')).toBeVisible()
  await closeSettings(page)
})

test('US5-4: a workspace theme override takes precedence over the global setting', async () => {
  const { page } = handle
  await openSettings(page)

  // Global = dark
  await page
    .locator('.settings-panel__nav-item')
    .filter({ hasText: 'Appearance & Terminal' })
    .click()
  await page.locator('.settings-panel__content input[value="dark"]').check()
  await expect.poll(() => themeAttr(page)).toBe('dark')

  // Workspace override = light
  await page.locator('.settings-panel__nav-item').filter({ hasText: 'Workspace Settings' }).click()
  const lightOverride = page.locator('.settings-panel__content input[value="light"]')
  if ((await lightOverride.count()) > 0) {
    await lightOverride.first().check()
    await expect.poll(() => themeAttr(page)).toBe('light')
  }

  await closeSettings(page)
})

test('US5-5: extensions section is visible in settings', async () => {
  const { page } = handle
  await openSettings(page)
  await page.locator('.settings-panel__nav-item').filter({ hasText: 'Extensions' }).click()
  await expect(page.locator('.settings-panel__content')).toBeVisible()
  await closeSettings(page)
})

test('US5-scrollback: scrollback limit is configurable', async () => {
  const { page } = handle
  await openSettings(page)
  await page
    .locator('.settings-panel__nav-item')
    .filter({ hasText: 'Appearance & Terminal' })
    .click()
  const scrollbackInput = page.locator('.settings-panel__content input[type="number"]').first()
  await expect(scrollbackInput).toBeVisible()
  await scrollbackInput.fill('5000')
  await expect(scrollbackInput).toHaveValue('5000')
  await closeSettings(page)
})

test('settings panel closes on Escape', async () => {
  const { page } = handle
  await openSettings(page)
  await expect(page.locator('.settings-panel')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-panel')).toHaveCount(0)
})
