import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, createWorkspace, addAndSelectProject } from './helpers'

// Home against the running app: it is the launch view, it lists every terminal
// where it lives, and what the operator writes about a session is still there
// after a restart. Addressed by role and name (contracts/ui-surfaces.md).

let handle: AppHandle | undefined
let folder: string

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'home-'))
})

test.afterEach(async () => {
  await closeApp(handle)
  handle = undefined
  rmSync(folder, { recursive: true, force: true })
})

async function openHome(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: /^Home/ })
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
}

test('the app opens on Home', async () => {
  handle = await launchApp()
  await expect(handle.page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(handle.page.getByText('No terminals are open')).toBeVisible()
})

test('Home lists each terminal under its workspace and branch, asking what it is for', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)

  const group = page.getByRole('rowgroup', { name: 'Repo One / feature-a' })
  await expect(group).toBeVisible()
  const rows = group.getByRole('row')
  await expect(rows).toHaveCount(1)
  await expect(
    rows.first().getByRole('textbox', { name: 'What is this session doing?' })
  ).toBeVisible()
})

test('a description survives a restart, and a closed session is found by it', async () => {
  handle = await launchApp()
  const profile = handle.userDataDir
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)

  const box = page
    .getByRole('rowgroup', { name: 'Repo One / feature-a' })
    .getByRole('textbox', { name: 'What is this session doing?' })
  await box.fill('Checking the ghostty keybinds')
  await box.press('Enter')
  await expect(page.getByText('Checking the ghostty keybinds')).toBeVisible()

  await closeApp(handle, { keepProfile: true })
  handle = await launchApp(profile)
  const restarted = handle.page
  await expect(restarted.getByRole('heading', { name: 'Home' })).toBeVisible()

  const closed = restarted.getByRole('rowgroup', { name: 'Closed' })
  await expect(closed.getByText('Checking the ghostty keybinds')).toBeVisible()

  await restarted.getByRole('searchbox', { name: 'Filter sessions' }).fill('ghostty')
  await expect(closed.getByRole('row')).toHaveCount(1)
  await expect(restarted.getByRole('rowgroup')).toHaveCount(1)
  await restarted.getByRole('searchbox', { name: 'Filter sessions' }).fill('nothing like this')
  await expect(restarted.getByText('No sessions match')).toBeVisible()
})

test('the Logbook is remembered, and describing a session there names it in the list', async () => {
  handle = await launchApp()
  const profile = handle.userDataDir
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
  await page
    .getByRole('radiogroup', { name: 'Layout' })
    .getByRole('radio', { name: 'Logbook' })
    .click()

  const list = page.getByRole('listbox', { name: 'Sessions' })
  await list.getByRole('option', { name: /Add a description/ }).click()
  const box = page.getByRole('textbox', { name: 'What is this session doing?' })
  await expect(box).toBeFocused()
  await box.fill('Trying the Logbook')
  await page.getByRole('button', { name: 'Save description' }).click()
  await expect(list.getByRole('option', { name: /Trying the Logbook/ })).toBeVisible()

  await closeApp(handle, { keepProfile: true })
  handle = await launchApp(profile)
  await expect(
    handle.page.getByRole('radiogroup', { name: 'Layout' }).getByRole('radio', { name: 'Logbook' })
  ).toHaveAttribute('aria-checked', 'true')
})

test('linking a session says where to connect a tracker when none is', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)

  await page
    .getByRole('rowgroup', { name: 'Repo One / feature-a' })
    .getByRole('button', { name: 'Link a work item' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Link a work item' })
  await expect(dialog.getByRole('alert')).toHaveText(
    'No issue tracker is connected. Connect Linear or Jira in Settings → Integrations.'
  )
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})
