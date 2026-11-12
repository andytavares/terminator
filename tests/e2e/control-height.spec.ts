import { test, expect, type Page } from '@playwright/test'
import {
  AppHandle,
  addAndSelectProject,
  closeApp,
  closeSettingsPanel,
  createWorkspace,
  e2eTempDir,
  launchApp,
  openSettingsSection,
} from './helpers'
import { offHeightFieldsOn } from './control-alignment'
import { openHome, openOverview } from './session-views'

// Every single-line field and select is one height, `--tm-control-height`, on every core screen.
// Two fields only line up when each is that height: a search box and a select beside it in the
// Inbox header were 30px and 22px, and a pairwise check missed it because the input is wrapped.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'Fields', e2eTempDir('fields-'))
  await addAndSelectProject(handle.page, 'Fields', 'one-height')
})

test.afterAll(async () => {
  await closeApp(handle)
})

async function showSidebarAs(page: Page, mode: 'inbox' | 'tree'): Promise<void> {
  await openSettingsSection(page, 'Appearance & Terminal')
  await page.locator('#sidebar-mode').selectOption(mode)
  await closeSettingsPanel(page)
}

async function screensOffHeight(page: Page): Promise<string[]> {
  await openHome(page)
  const found = await offHeightFieldsOn(page, 'Home')
  await openOverview(page)
  found.push(...(await offHeightFieldsOn(page, 'Overview')))
  await showSidebarAs(page, 'inbox')
  found.push(...(await offHeightFieldsOn(page, 'Inbox')))
  await showSidebarAs(page, 'tree')
  await page.keyboard.press('ControlOrMeta+n')
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  for (const tab of ['My tickets', 'Prompt', 'Branch', 'Terminal']) {
    await launcher.getByRole('tab', { name: tab, exact: true }).click()
    found.push(...(await offHeightFieldsOn(page, `Start work: ${tab}`)))
  }
  await page.keyboard.press('Escape')
  return found
}

async function settingsOffHeight(page: Page): Promise<string[]> {
  const found: string[] = []
  for (const section of [
    'Appearance & Terminal',
    'Workspace Settings',
    'Integrations',
    'Extensions',
  ]) {
    await openSettingsSection(page, section)
    found.push(...(await offHeightFieldsOn(page, `Settings: ${section}`)))
  }
  await closeSettingsPanel(page)
  return found
}

test('every field and select on the core screens is one height', async () => {
  const { page } = handle
  const found = [...(await screensOffHeight(page)), ...(await settingsOffHeight(page))]
  expect(found).toEqual([])
})
