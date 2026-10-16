import { test, expect, Page } from '@playwright/test'
import { AppHandle, launchApp, closeApp, openSettingsSection } from './helpers'

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function openExtensionsSettings(pg: Page): Promise<void> {
  await openSettingsSection(pg, 'Extensions')
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

/** Clicks a toggle and waits for the reload it causes, which comes only once main has
 * finished (seconds): `domcontentloaded` right after the click is answered by the old page. */
async function toggleAndReload(pg: Page, extensionName: string): Promise<void> {
  const reloaded = pg.waitForEvent('load')
  await extensionRow(pg, extensionName)
    .getByRole('button', { name: /^(Disable|Enable)$/ })
    .click()
  await reloaded
  await pg.waitForSelector('.unified-sidebar', { timeout: 15000 })
}

function extensionRow(pg: Page, extensionName: string) {
  return pg.locator('.extension-item').filter({
    has: pg.locator('.extension-item__name', { hasText: extensionName }),
  })
}

test('US6-4: toggling an extension off and on keeps the app stable', async () => {
  const { page } = handle
  const notesButton = page.getByRole('button', { name: 'Notes', exact: true })
  await expect(notesButton).toBeVisible()

  await openExtensionsSettings(page)
  await toggleAndReload(page, 'Notepad')
  await expect(notesButton).toHaveCount(0)
  await openExtensionsSettings(page)
  await expect(extensionRow(page, 'Notepad').locator('.extension-item__status')).toHaveText(
    'disabled'
  )

  await toggleAndReload(page, 'Notepad')
  await expect(notesButton).toBeVisible({ timeout: 15000 })
  await openExtensionsSettings(page)
  await expect(extensionRow(page, 'Notepad').locator('.extension-item__status')).toHaveText(
    'enabled'
  )
  await closeSettings(page)
  await expect(page.locator('.unified-sidebar')).toBeVisible()
})
