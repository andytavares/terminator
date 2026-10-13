import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  createWorkspace,
  launchApp,
  projectGroup,
  runQuickAction,
} from './helpers'
import { recordShellOpens, shellOpens } from './main-stubs'

// The application menu. Playwright cannot open a native menu, so each test
// clicks the item itself, through the same MenuItem the menu bar would call
// (https://www.electronjs.org/docs/latest/api/menu-item#menuitemclick), and
// asserts what the window then shows.

/**
 * Clicks the menu item at `path`, e.g. ['View', 'Open Settings'], each label
 * matched by its start: "About" is named after the app, which differs by build.
 */
async function clickMenuItem(app: ElectronApplication, path: string[]): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, labels) => {
    let items = Menu.getApplicationMenu()?.items ?? []
    let item: Electron.MenuItem | undefined
    for (const label of labels) {
      item = items.find((candidate) => candidate.label.startsWith(label))
      if (!item) throw new Error(`no menu item ${labels.join(' → ')}`)
      items = item.submenu?.items ?? []
    }
    const window = BrowserWindow.getAllWindows()[0]
    item!.click(undefined, window, window.webContents)
  }, path)
}

function menuItemChecked(app: ElectronApplication, path: string[]): Promise<boolean> {
  return app.evaluate(({ Menu }, labels) => {
    let items = Menu.getApplicationMenu()?.items ?? []
    let item: Electron.MenuItem | undefined
    for (const label of labels) {
      item = items.find((candidate) => candidate.label.startsWith(label))
      items = item?.submenu?.items ?? []
    }
    return item?.checked === true
  }, path)
}

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await recordShellOpens(handle.app)
  await createWorkspace(handle.page, 'Menus', mkdtempSync(join(tmpdir(), 'terminator-e2e-menu-')))
  await addAndSelectProject(handle.page, 'Menus', 'menu-branch')
})

test.afterAll(async () => closeApp(handle))

test('View → Toggle Sidebar hides the sidebar, and shows it again', async () => {
  const { app, page } = handle
  await clickMenuItem(app, ['View', 'Toggle Sidebar'])
  await expect(page.locator('.unified-sidebar')).toHaveClass(/unified-sidebar--hidden/)
  await clickMenuItem(app, ['View', 'Toggle Sidebar'])
  await expect(page.locator('.unified-sidebar')).not.toHaveClass(/unified-sidebar--hidden/)
})

test('View → Open Settings opens Settings', async () => {
  const { app, page } = handle
  await clickMenuItem(app, ['View', 'Open Settings'])
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.locator('.settings-panel__close').click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
})

test('Window → Home opens Home', async () => {
  const { app, page } = handle
  await projectGroup(page, 'menu-branch').click()
  const home = page.getByRole('heading', { name: 'Home', exact: true })
  await expect(home).toBeHidden()
  await clickMenuItem(app, ['Window', 'Home'])
  await expect(home).toBeVisible()
})

test('Window → Close Tab closes the active terminal tab', async () => {
  const { app, page } = handle
  await projectGroup(page, 'menu-branch').click()
  await runQuickAction(page, 'New tab')
  const tabs = page.locator('.tab-bar__tab--session')
  await expect(tabs).toHaveCount(2)
  await clickMenuItem(app, ['Window', 'Close Tab'])
  await expect(tabs).toHaveCount(1)
})

test('Help → About shows the versions and that the database is healthy', async () => {
  const { app, page } = handle
  await clickMenuItem(app, ['Help', 'About'])
  const about = page.getByRole('dialog', { name: 'About' })
  await expect(about).toBeVisible()
  const dbRow = about.locator('.about-dialog__row', { hasText: 'DB' })
  await expect(dbRow.locator('dd')).toHaveText('OK')
  await about.locator('.tmui-button--primary', { hasText: 'Close' }).click()
  await expect(about).toBeHidden()
})

test("View → Toggle Vault Calendar opens Task Vault's sidebar panel and ticks the item", async () => {
  const { app, page } = handle
  await projectGroup(page, 'menu-branch').click()
  const panel = page.locator('[data-extension-panel="terminator.task-vault"]')
  await expect(panel).toHaveCount(0)
  await clickMenuItem(app, ['View', 'Toggle Vault Calendar'])
  await expect(panel).toHaveCount(1, { timeout: 15000 })
  await expect.poll(() => menuItemChecked(app, ['View', 'Toggle Vault Calendar'])).toBe(true)
  await clickMenuItem(app, ['View', 'Toggle Vault Calendar'])
  await expect(panel).toHaveCount(0)
  await expect.poll(() => menuItemChecked(app, ['View', 'Toggle Vault Calendar'])).toBe(false)
})

test('Help → View on GitHub hands the repository URL to the browser', async () => {
  const { app } = handle
  await clickMenuItem(app, ['Help', 'View on GitHub'])
  await expect.poll(() => shellOpens(app)).toContain('https://github.com/anthropics/terminator')
})
