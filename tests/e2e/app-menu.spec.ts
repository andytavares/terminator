import { test, expect, type ElectronApplication } from '@playwright/test'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  createWorkspace,
  e2eTempDir,
  launchApp,
  projectGroup,
  runQuickActionFromPanel,
} from './helpers'
import { recordShellOpens, shellOpens } from './main-stubs'
import { expectCentredInWindow } from './modal-centre'

// Playwright cannot open a native menu, so each test clicks the MenuItem the menu bar
// would call (https://www.electronjs.org/docs/latest/api/menu-item#menuitemclick).

/** Clicks the menu item at `path`, e.g. ['View', 'Open Settings'], each label
 * matched by its start: "About" is named after the app, which differs by build. */
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
  await createWorkspace(handle.page, 'Menus', e2eTempDir('terminator-e2e-menu-'))
  await addAndSelectProject(handle.page, 'Menus', 'menu-branch')
})

test.afterAll(async () => closeApp(handle))

async function toggleSidebarHidesAndShows(): Promise<void> {
  const { app, page } = handle
  await clickMenuItem(app, ['View', 'Toggle Sidebar'])
  await expect(page.locator('.unified-sidebar')).toHaveClass(/unified-sidebar--hidden/)
  await clickMenuItem(app, ['View', 'Toggle Sidebar'])
  await expect(page.locator('.unified-sidebar')).not.toHaveClass(/unified-sidebar--hidden/)
}

async function openSettingsOpensSettings(): Promise<void> {
  const { app, page } = handle
  await clickMenuItem(app, ['View', 'Open Settings'])
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await page.locator('.settings-panel__close').click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeHidden()
}

async function homeOpensHome(): Promise<void> {
  const { app, page } = handle
  await projectGroup(page, 'menu-branch').click()
  const home = page.getByRole('heading', { name: 'Home', exact: true })
  await expect(home).toBeHidden()
  await clickMenuItem(app, ['Window', 'Home'])
  await expect(home).toBeVisible()
}

async function closeTabClosesActiveTab(): Promise<void> {
  const { app, page } = handle
  await projectGroup(page, 'menu-branch').click()
  await runQuickActionFromPanel(page, 'New tab')
  const tabs = page.locator('.tab-bar__tab--session')
  await expect(tabs).toHaveCount(2)
  await clickMenuItem(app, ['Window', 'Close Tab'])
  await expect(tabs).toHaveCount(1)
}

async function aboutShowsHealthyDatabase(): Promise<void> {
  const { app, page } = handle
  await clickMenuItem(app, ['Help', 'About'])
  const about = page.getByRole('dialog', { name: 'About' })
  await expect(about).toBeVisible()
  await expectCentredInWindow(about, 'About')
  const dbRow = about.locator('.about-dialog__row', { hasText: 'DB' })
  await expect(dbRow.locator('dd')).toHaveText('OK')
  await about.locator('.tmui-button--primary', { hasText: 'Close' }).click()
  await expect(about).toBeHidden()
}

async function vaultCalendarTogglesItsPanel(): Promise<void> {
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
}

async function viewOnGitHubOpensRepository(): Promise<void> {
  const { app } = handle
  await clickMenuItem(app, ['Help', 'View on GitHub'])
  await expect.poll(() => shellOpens(app)).toContain('https://github.com/anthropics/terminator')
}

test('the app menu drives the sidebar, Settings, Home, tabs, About, an extension and the browser', async () => {
  test.setTimeout(90_000)
  await test.step(
    'View → Toggle Sidebar hides the sidebar, and shows it again',
    toggleSidebarHidesAndShows
  )
  await test.step('View → Open Settings opens Settings', openSettingsOpensSettings)
  await test.step('Window → Home opens Home', homeOpensHome)
  await test.step('Window → Close Tab closes the active terminal tab', closeTabClosesActiveTab)
  await test.step(
    'Help → About shows the versions and that the database is healthy',
    aboutShowsHealthyDatabase
  )
  await test.step(
    "View → Toggle Vault Calendar opens Task Vault's sidebar panel and ticks the item",
    vaultCalendarTogglesItsPanel
  )
  await test.step(
    'Help → View on GitHub hands the repository URL to the browser',
    viewOnGitHubOpensRepository
  )
})
