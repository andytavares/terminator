import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, createWorkspace, addAndSelectProject } from './helpers'

// Ending a session, and clearing away what is left of one, from the surfaces
// that draw it — without going to the sidebar or the tab bar.

let handle: AppHandle | undefined
let folder: string

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'close-session-'))
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

/** A described session, so it leaves a record to find under Closed. */
async function describeSession(page: Page): Promise<void> {
  const box = page.getByRole('textbox', { name: 'What is this session doing?' }).first()
  await box.fill('chasing the flaky test')
  await box.press('Enter')
}

test('a session is ended from Home, then removed from the list', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
  await describeSession(page)

  await page.getByRole('button', { name: /^Close / }).click()

  // The session is history now, description and all. (The tab bar belongs to
  // the terminal view, which Home covers, so Closed is what proves it ended.)
  const closed = page.getByRole('rowgroup', { name: 'Closed' })
  await expect(closed).toBeVisible()
  await expect(closed.getByText('chasing the flaky test')).toBeVisible()

  // Thirty days is a long time to keep something you are done with.
  await page.getByRole('button', { name: /^Remove / }).click()
  await expect(page.getByRole('rowgroup', { name: 'Closed' })).toHaveCount(0, { timeout: 15_000 })
})

test('a removed session stays gone across a restart', async () => {
  handle = await launchApp()
  const profile = handle.userDataDir
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
  await describeSession(page)
  await page.getByRole('button', { name: /^Close / }).click()
  await expect(page.getByRole('rowgroup', { name: 'Closed' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /^Remove / }).click()
  await expect(page.getByRole('rowgroup', { name: 'Closed' })).toHaveCount(0, { timeout: 15_000 })

  await closeApp(handle, { keepProfile: true })
  handle = await launchApp(profile)
  await openHome(handle.page)
  await expect(handle.page.getByRole('rowgroup', { name: 'Closed' })).toHaveCount(0)
})

test('an open session offers no way to remove it from the list', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Repo One', folder)
  await addAndSelectProject(page, 'Repo One', 'feature-a')
  await openHome(page)
  await describeSession(page)
  await expect(page.getByRole('button', { name: /^Close / })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0)
})
