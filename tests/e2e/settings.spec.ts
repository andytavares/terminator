import { test, expect, Page } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  openSettingsSection,
  closeSettingsPanel,
  projectGroup,
  readTerminalRows,
} from './helpers'
import { openExtensionSettings } from './extension-settings-page'
import { expectCentredInWindow } from './modal-centre'

// An operator tunes the app from Settings and sees each change take: the theme at once, a
// workspace's own theme and shell, an extension's list setting, and a prompt that survives a
// restart.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  // A workspace must be *active* (a branch selected) for the Workspace Settings
  // tab to appear — clicking the card header only toggles collapse.
  await createWorkspace(handle.page, 'Settings Test Workspace', handle.userDataDir)
  await addAndSelectProject(handle.page, 'Settings Test Workspace', 'Proj')
})

test.afterAll(async () => {
  await closeApp(handle)
})

const settingsPanel = (page: Page) => page.locator('.settings-panel')
const content = (page: Page) => page.locator('.settings-panel__content')

function themeAttr(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-theme'))
}

async function settingsOpensCentredWithCategories(): Promise<void> {
  const { page } = handle
  await page.keyboard.press('ControlOrMeta+,')
  await expectCentredInWindow(page.getByRole('dialog', { name: 'Settings' }), 'Settings')
  await expect(
    page.locator('.settings-panel__nav-item').filter({ hasText: 'Appearance & Terminal' })
  ).toBeVisible()
}

async function themeSwitchesAtOnce(): Promise<void> {
  const { page } = handle
  await openSettingsSection(page, 'Appearance & Terminal')
  await content(page).locator('input[value="dark"]').check()
  await expect.poll(() => themeAttr(page)).toBe('dark')
  await content(page).locator('input[value="light"]').check()
  await expect.poll(() => themeAttr(page)).toBe('light')
}

async function workspaceThemeOverridesGlobal(): Promise<void> {
  const { page } = handle
  await openSettingsSection(page, 'Appearance & Terminal')
  await content(page).locator('input[value="dark"]').check()
  await expect.poll(() => themeAttr(page)).toBe('dark')
  await openSettingsSection(page, 'Workspace Settings')
  await content(page).locator('input[value="light"]').check()
  await expect.poll(() => themeAttr(page)).toBe('light')
}

async function scrollbackIsConfigurable(): Promise<void> {
  const { page } = handle
  await openSettingsSection(page, 'Appearance & Terminal')
  const scrollback = content(page).locator('input[type="number"]').first()
  await scrollback.fill('5000')
  await expect(scrollback).toHaveValue('5000')
}

async function listSettingIsStoredAsList(): Promise<void> {
  const { page } = handle
  const label = 'Critical paths, one glob per line'
  const foundry = await openExtensionSettings(page, 'Foundry')
  const box = foundry.getByRole('textbox', { name: label })
  await expect(box).toHaveJSProperty('tagName', 'TEXTAREA')
  await box.fill('src/auth/**\n\n  migrations/** ')
  await closeSettingsPanel(page)
  const stored = () =>
    page.evaluate(async (key) => {
      const { values } = await window.electronAPI.extension.getSettingsValues()
      return values[key]
    }, 'terminator.foundry.criticalPaths')
  await expect.poll(stored).toEqual(['src/auth/**', 'migrations/**'])
  const reopened = await openExtensionSettings(page, 'Foundry')
  await expect(reopened.getByRole('textbox', { name: label })).toHaveValue(
    'src/auth/**\nmigrations/**'
  )
}

async function escapeClosesSettings(): Promise<void> {
  const { page } = handle
  await expect(settingsPanel(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settingsPanel(page)).toHaveCount(0)
}

async function workspaceShellOpensNewTerminals(): Promise<void> {
  const { page } = handle
  await openSettingsSection(page, 'Workspace Settings')
  const shell = page.getByRole('textbox', { name: 'Default Shell' })
  await shell.fill('/bin/bash')
  await shell.blur()
  await closeSettingsPanel(page)
  await page.keyboard.press('ControlOrMeta+t')
  await page.keyboard.type('echo "shell:$0"\n')
  await expect
    .poll(async () => (await readTerminalRows(page)).join('\n'))
    .toContain('shell:/bin/bash')
}

async function namePromptOpensCentred(): Promise<void> {
  const { page } = handle
  await openSettingsSection(page, 'Appearance & Terminal')
  await page.getByLabel('Prompt for session name on creation').check()
  await closeSettingsPanel(page)
  const tabsBefore = await page.locator('.tab-bar__tab--session').count()
  await page.keyboard.press('ControlOrMeta+t')
  const dialog = page.getByRole('dialog', { name: 'Name this terminal' })
  await expectCentredInWindow(dialog, 'Name this terminal')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(tabsBefore)
}

/** Run in the page: how the focused field is painted, and the tokens it should use. */
function fieldPaint(): Record<string, string> {
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Terminal name"]')!
  const style = getComputedStyle(field)
  const swatch = document.body.appendChild(document.createElement('div'))
  const token = (name: string) => {
    swatch.style.color = `var(${name})`
    return getComputedStyle(swatch).color
  }
  return {
    background: style.backgroundColor,
    backgroundToken: token('--tm-bg-input'),
    ring: style.outlineColor,
    ringToken: token('--tm-accent-glow'),
    paddingLeft: style.paddingLeft,
  }
}

async function nameFieldThemedAfterRestart(): Promise<void> {
  // The prompt setting survives the restart; Settings, and its sheet, stay unloaded.
  const { userDataDir } = handle
  await closeApp(handle)
  handle = await launchApp(userDataDir)
  const { page } = handle
  await projectGroup(page, 'Proj').click()
  await page.keyboard.press('ControlOrMeta+t')
  await expect(page.getByRole('textbox', { name: 'Terminal name' })).toBeVisible()
  const paint = await page.evaluate(fieldPaint)
  expect(paint.background).toBe(paint.backgroundToken)
  expect(paint.ring, 'the field ring, not the white app-wide one').toBe(paint.ringToken)
  expect(paint.paddingLeft, 'the text clears the edge').not.toBe('0px')
  await page.keyboard.press('Escape')
}

async function theLookChanges(): Promise<void> {
  await test.step(
    '⌘, opens Settings in the middle of the window, with its categories',
    settingsOpensCentredWithCategories
  )
  await test.step('the theme switches the UI at once', themeSwitchesAtOnce)
  await test.step(
    "a workspace's theme override takes precedence over the global theme",
    workspaceThemeOverridesGlobal
  )
  await test.step('the scrollback limit is configurable', scrollbackIsConfigurable)
}

async function extensionsAndWorkspacesChange(): Promise<void> {
  await test.step(
    "a list setting is edited one item per line and stored as a list (Foundry's critical paths)",
    listSettingIsStoredAsList
  )
  await test.step('Escape closes Settings', escapeClosesSettings)
  await test.step(
    "a workspace's own Default Shell is the shell its new terminals open in",
    workspaceShellOpensNewTerminals
  )
}

async function aPromptSurvivesARestart(): Promise<void> {
  await test.step(
    'with naming on, a new terminal asks for its name in the middle of the window',
    namePromptOpensCentred
  )
  await test.step(
    'after a restart, the name field is themed before Settings has ever been opened',
    nameFieldThemedAfterRestart
  )
}

test('settings change the theme, a workspace, an extension and the terminal, and survive a restart', async () => {
  await theLookChanges()
  await extensionsAndWorkspacesChange()
  await aPromptSurvivesARestart()
})
