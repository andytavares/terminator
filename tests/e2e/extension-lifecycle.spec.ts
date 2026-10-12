import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  closeSettings,
  createWorkspace,
  inExtensionView,
  launchApp,
  openSettings,
  projectGroup,
  quickActionsPanel,
  runQuickAction,
} from './helpers'
import { answerFolderPicker } from './main-stubs'

// An extension's life from outside the bundle: installed from a folder in
// Settings, its tab and Quick Actions appearing, its command run, reloaded,
// uninstalled; across restarts. The extension is tests/e2e/fixtures/extensions/probe.

const PROBE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'extensions', 'probe')
const CLASH = '"e2e.probe" wanted mnemonic "g" but it was taken by "terminator.git-integration"'

let handle: AppHandle

const probeRow = () =>
  handle.page.locator('.extension-item').filter({
    has: handle.page.locator('.extension-item__name', { hasText: 'E2E Probe' }),
  })
const probeTab = () => handle.page.locator('.tab-bar--primary .tab-bar__tab', { hasText: 'Probe' })

async function relaunch(): Promise<void> {
  const { userDataDir } = handle
  await closeApp(handle)
  handle = await launchApp(userDataDir)
}

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'Ext', mkdtempSync(join(tmpdir(), 'terminator-e2e-ext-')))
  await addAndSelectProject(handle.page, 'Ext', 'probe-branch')
})

test.afterAll(async () => closeApp(handle))

test.describe.serial('an extension installed from a folder', () => {
  test('Install from Directory lists it as enabled, and it is still there after a restart', async () => {
    await answerFolderPicker(handle.app, PROBE)
    await openSettings(handle.page, 'Extensions')
    await handle.page.getByRole('button', { name: 'Install from Directory' }).click()
    await expect(probeRow().locator('.extension-item__status')).toHaveText('enabled')
    await relaunch()
    await openSettings(handle.page, 'Extensions')
    await expect(probeRow().locator('.extension-item__status')).toHaveText('enabled')
    await closeSettings(handle.page)
  })

  test('its project tab shows, and its Quick Actions group gets a free key, logged', async () => {
    const { page, app } = handle
    await projectGroup(page, 'probe-branch').click()
    await expect(probeTab()).toBeVisible()
    await page.locator('.app-band__entry[aria-label="Quick actions (⌘P)"]').click()
    const group = quickActionsPanel(page)
      .locator('.qa-row')
      .filter({ has: page.locator('.qa-row__label', { hasText: /^Probe$/ }) })
    await expect(group.locator('.qa-key').first()).toHaveText('p')
    await page.keyboard.press('Escape')
    await runQuickAction(page, 'Toggle log window')
    await expect(page.getByRole('dialog', { name: 'Application Logs' })).toContainText(CLASH)
    await page.locator('.log-window__btn--close').click()
    const logFile = join(await app.evaluate(({ app: a }) => a.getPath('logs')), 'terminator.log')
    await expect.poll(() => readFileSync(logFile, 'utf8')).toContain(CLASH)
  })

  test('its command brings its project tab forward', async () => {
    const { page } = handle
    await expect(probeTab()).not.toHaveClass(/tab-bar__tab--active/)
    await runQuickAction(page, 'Show the probe tab')
    await expect(probeTab()).toHaveClass(/tab-bar__tab--active/)
  })

  test('its view can run a command by id, as one extension runs another', async () => {
    const { page } = handle
    await expect(page.locator('[data-extension-panel="e2e.probe"]')).toHaveCount(1)
    await expect
      .poll(() => inExtensionView<string>(handle, 'e2e.probe', 'document.title').catch(() => ''))
      .toBe('E2E Probe')
    await page.locator('.tab-bar--primary .tab-bar__tab', { hasText: 'Terminal' }).click()
    await expect(probeTab()).not.toHaveClass(/tab-bar__tab--active/)
    const result = await inExtensionView<{ ok: boolean }>(
      handle,
      'e2e.probe',
      `window.electronAPI.extension.runCommand('e2e.probe.command.show-tab')`
    )
    expect(result).toEqual({ ok: true })
    await expect(probeTab()).toHaveClass(/tab-bar__tab--active/)
  })

  test('Reload re-activates it and tells its open views', async () => {
    const { page } = handle
    await openSettings(page, 'Extensions')
    await probeRow().getByRole('button', { name: 'Reload' }).click()
    await expect(
      page.locator('.tmui-toast__message', { hasText: 'Extension reloaded' })
    ).toBeVisible()
    await expect
      .poll(() => inExtensionView<string>(handle, 'e2e.probe', `document.body.innerText`))
      .toContain('reloads: 1')
    await closeSettings(page)
    await runQuickAction(page, 'Show the probe tab')
    await expect(probeTab()).toHaveClass(/tab-bar__tab--active/)
  })

  test('Uninstall removes it, and it stays gone after a restart', async () => {
    const { page } = handle
    page.once('dialog', (dialog) => void dialog.accept())
    await openSettings(page, 'Extensions')
    await probeRow().getByRole('button', { name: 'Uninstall' }).click()
    await expect(probeRow()).toHaveCount(0)
    await relaunch()
    await openSettings(handle.page, 'Extensions')
    await expect(handle.page.locator('.extension-item').first()).toBeVisible()
    await expect(probeRow()).toHaveCount(0)
    await closeSettings(handle.page)
    await projectGroup(handle.page, 'probe-branch').click()
    await expect(probeTab()).toHaveCount(0)
  })
})
