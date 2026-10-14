import { test, expect, type Page } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  e2eTempDir,
  openSettingsSection,
  closeSettingsPanel,
} from './helpers'
import { openVault, goToSection } from './task-vault-harness'
import { openNotepad } from './notepad-harness'
import { openFromAppBand } from './extension-page'
import { misalignedOn } from './control-alignment'

// Controls side by side are one height and share a centre, on every screen a person reaches:
// a field and the button that acts on it once differed by 6px (the design system sized fields
// by a token and buttons by padding). The Git, review, merge and Foundry specs check their own.

let handle: AppHandle
let page: Page

test.beforeAll(async () => {
  handle = await launchApp()
  page = handle.page
  await createWorkspace(page, 'Align', e2eTempDir('align-'))
  await addAndSelectProject(page, 'Align', 'main')
})

test.afterAll(async () => closeApp(handle))

test('Home, Overview and the terminal line up', async () => {
  const found = await misalignedOn(page, 'terminal')
  await page.getByRole('button', { name: 'Home' }).click()
  found.push(...(await misalignedOn(page, 'Home ledger')))
  await page.getByRole('radio', { name: 'Logbook' }).click()
  found.push(...(await misalignedOn(page, 'Home logbook')))
  await page.getByRole('button', { name: 'Overview' }).click()
  found.push(...(await misalignedOn(page, 'Overview')))
  expect(found).toEqual([])
})

test('every Settings section lines up', async () => {
  const found: string[] = []
  for (const section of [
    'Appearance & Terminal',
    'Workspace Settings',
    'Integrations',
    'Extensions',
  ]) {
    await openSettingsSection(page, section)
    found.push(...(await misalignedOn(page, `Settings: ${section}`)))
  }
  await closeSettingsPanel(page)
  expect(found).toEqual([])
})

/** A project with a task, its card open, as the project card's add row is seen. */
async function projectCardWithATask(vault: Page): Promise<string[]> {
  await goToSection(vault, 'Projects')
  await vault.getByRole('button', { name: '+ New project' }).click()
  const found = await misalignedOn(vault, 'Task Vault: new project form')
  const form = vault.locator('.create-project-form')
  await form.getByPlaceholder('Project name').fill('Launch the website')
  await form.getByRole('button', { name: 'Create project' }).click()
  const card = vault.locator('.projects-browser__card').first()
  await card.getByRole('button', { name: /Show tasks tagged/ }).click()
  await card.getByPlaceholder(/Add task to/).fill('Write the landing copy')
  await card.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(card.locator('.projects-browser__task-text')).toHaveCount(1)
  return [...found, ...(await misalignedOn(vault, 'Task Vault: project card'))]
}

/** Today with a task, its add row open, then the task in edit. */
async function todayWithATask(vault: Page): Promise<string[]> {
  await goToSection(vault, 'Today')
  await vault.getByRole('button', { name: 'Add task', exact: true }).click()
  const input = vault.locator('.daily-log__add-row input')
  await input.fill('Call the printer')
  await input.press('Enter')
  await expect(vault.locator('.daily-log__task-text')).toHaveCount(1)
  const found = await misalignedOn(vault, 'Task Vault: today')
  await vault.locator('.daily-log__task-text').dblclick({ position: { x: 4, y: 4 } })
  await expect(vault.locator('.daily-log__task-edit')).toBeVisible()
  found.push(...(await misalignedOn(vault, 'Task Vault: editing a task')))
  await vault.keyboard.press('Escape')
  return found
}

test('every Task Vault section lines up, with content in it', async () => {
  const vault = await openVault(handle)
  const found = [...(await projectCardWithATask(vault)), ...(await todayWithATask(vault))]
  for (const section of ['Inbox', 'Areas', 'History', 'Weekly review']) {
    await goToSection(vault, section)
    found.push(...(await misalignedOn(vault, `Task Vault: ${section}`)))
  }
  expect(found).toEqual([])
})

test('Notepad and Remote Control line up', async () => {
  const notepad = await openNotepad(handle)
  const found = await misalignedOn(notepad, 'Notepad')
  await notepad.getByRole('button', { name: /^New/ }).first().click()
  found.push(...(await misalignedOn(notepad, 'Notepad: new item')))
  await notepad.keyboard.press('Escape')
  const remote = await openFromAppBand(handle, 'Remote Control', 'remote-control')
  found.push(...(await misalignedOn(remote, 'Remote Control')))
  expect(found).toEqual([])
})
