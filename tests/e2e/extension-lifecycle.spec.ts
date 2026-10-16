import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  closeSettingsPanel,
  createWorkspace,
  inExtensionView,
  launchApp,
  openSettingsSection,
  projectGroup,
  quickActionsPanel,
  runQuickActionFromPanel,
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

async function installListsItAcrossRestart(): Promise<void> {
  await answerFolderPicker(handle.app, PROBE)
  await openSettingsSection(handle.page, 'Extensions')
  await handle.page.getByRole('button', { name: 'Install from Directory' }).click()
  await expect(probeRow().locator('.extension-item__status')).toHaveText('enabled')
  await relaunch()
  await openSettingsSection(handle.page, 'Extensions')
  await expect(probeRow().locator('.extension-item__status')).toHaveText('enabled')
  await closeSettingsPanel(handle.page)
}

async function tabAndQuickActionsGroupShow(): Promise<void> {
  const { page, app } = handle
  await projectGroup(page, 'probe-branch').click()
  await expect(probeTab()).toBeVisible()
  await page.locator('.app-band__entry[aria-label="Quick actions (⌘P)"]').click()
  const group = quickActionsPanel(page)
    .locator('.qa-row')
    .filter({ has: page.locator('.qa-row__label', { hasText: /^Probe$/ }) })
  await expect(group.locator('.qa-key').first()).toHaveText('p')
  await page.keyboard.press('Escape')
  await runQuickActionFromPanel(page, 'Toggle log window')
  await expect(page.getByRole('region', { name: 'Application Logs' })).toContainText(CLASH)
  await page.locator('.log-window__btn--close').click()
  const logFile = join(await app.evaluate(({ app: a }) => a.getPath('logs')), 'terminator.log')
  await expect.poll(() => readFileSync(logFile, 'utf8')).toContain(CLASH)
}

async function commandBringsTabForward(): Promise<void> {
  const { page } = handle
  await expect(probeTab()).not.toHaveClass(/tab-bar__tab--active/)
  await runQuickActionFromPanel(page, 'Show the probe tab')
  await expect(probeTab()).toHaveClass(/tab-bar__tab--active/)
}

async function viewRunsCommandById(): Promise<void> {
  const { page } = handle
  await expect(page.locator('[data-extension-panel="e2e.probe"]')).toHaveCount(1)
  await expect
    .poll(() =>
      inExtensionView<boolean>(
        handle,
        'e2e.probe',
        `typeof window.electronAPI?.extension?.runCommand === 'function'`
      ).catch(() => false)
    )
    .toBe(true)
  // The view's frame exists only while its tab is on screen, so the command
  // runs from there and the leaving click comes after the call resolves.
  const ran = await inExtensionView<{ ok: boolean }>(
    handle,
    'e2e.probe',
    `window.electronAPI.extension.runCommand('e2e.probe.command.show-tab')`
  )
  expect(ran).toEqual({ ok: true })
  await expect(probeTab()).toHaveClass(/tab-bar__tab--active/)
}

async function reloadReactivatesAndTellsViews(): Promise<void> {
  const { page } = handle
  await expect(probeTab()).toHaveClass(/tab-bar__tab--active/)
  const marker = `before-reload-${Date.now()}`
  await inExtensionView(handle, 'e2e.probe', `window.__beforeReload = '${marker}'`)
  await openSettingsSection(page, 'Extensions')
  await probeRow().getByRole('button', { name: 'Reload' }).click()
  await expect(
    page.locator('.tmui-toast__message', { hasText: 'Extension reloaded' })
  ).toBeVisible()
  await closeSettingsPanel(page)
  // The open view is told to reload: its document is a new one, and its electronAPI
  // answers through the re-activated backend.
  await expect
    .poll(() =>
      inExtensionView<string>(
        handle,
        'e2e.probe',
        `String(window.__beforeReload ?? 'reloaded')`
      ).catch(() => 'detached')
    )
    .toBe('reloaded')
  await expect
    .poll(() =>
      inExtensionView<boolean>(
        handle,
        'e2e.probe',
        `window.electronAPI.extension.hasCommand('e2e.probe.command.show-tab')`
      ).catch(() => false)
    )
    .toBe(true)
}

async function uninstallRemovesItAcrossRestart(): Promise<void> {
  const { page } = handle
  page.once('dialog', (dialog) => void dialog.accept())
  await openSettingsSection(page, 'Extensions')
  await probeRow().getByRole('button', { name: 'Uninstall' }).click()
  await expect(probeRow()).toHaveCount(0)
  await relaunch()
  await openSettingsSection(handle.page, 'Extensions')
  await expect(handle.page.locator('.extension-item').first()).toBeVisible()
  await expect(probeRow()).toHaveCount(0)
  await closeSettingsPanel(handle.page)
  await projectGroup(handle.page, 'probe-branch').click()
  await expect(probeTab()).toHaveCount(0)
}

test.describe.serial('an extension installed from a folder', () => {
  test(
    'Install from Directory lists it as enabled, and it is still there after a restart',
    installListsItAcrossRestart
  )

  test(
    'its project tab shows, and its Quick Actions group gets a free key, logged',
    tabAndQuickActionsGroupShow
  )

  test('its command brings its project tab forward', commandBringsTabForward)

  test('its view can run a command by id, as one extension runs another', viewRunsCommandById)

  test('Reload re-activates it and tells its open views', reloadReactivatesAndTellsViews)

  test('Uninstall removes it, and it stays gone after a restart', uninstallRemovesItAcrossRestart)
})
