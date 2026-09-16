import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, createWorkspace, addAndSelectProject } from './helpers'

// The Overview tab as a Monitor wall, against the running app: a tile shows its
// terminal's output as it arrives, and the wall's arrangement survives a restart.
// Addressed by role and name (contracts/ui-surfaces.md).

let handle: AppHandle | undefined
let folder: string

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'wall-'))
})

test.afterEach(async () => {
  await closeApp(handle)
  handle = undefined
  rmSync(folder, { recursive: true, force: true })
})

async function openWall(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: 'Overview' })
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
}

test('the wall says when no terminal is open', async () => {
  handle = await launchApp()
  await openWall(handle.page)
  await expect(handle.page.getByText('No terminals are open')).toBeVisible()
})

test("a tile shows its terminal's output as it arrives", async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Wall', folder)
  await addAndSelectProject(page, 'Wall', 'live')
  await page.locator('.terminal-pane').click()
  await page.keyboard.type('for i in $(seq 1 80); do echo tick-$i; sleep 0.1; done')
  await page.keyboard.press('Enter')

  await openWall(page)
  const tile = page.getByRole('article', { name: /Wall \/ live/ })
  await expect(tile).toBeVisible()
  const preview = tile.locator('.live-preview')
  await expect(preview).toContainText('tick-', { timeout: 10000 })
  const first = await preview.innerText()
  await expect.poll(async () => preview.innerText(), { timeout: 10000 }).not.toBe(first)

  await page.screenshot({ path: 'test-results/054/monitor-wall.png' })
})

test("the wall's size and pinning survive a restart", async () => {
  handle = await launchApp()
  const profile = handle.userDataDir
  await openWall(handle.page)
  await handle.page
    .getByRole('radiogroup', { name: 'Tile size' })
    .getByRole('radio', { name: 'Large' })
    .click()
  await handle.page.getByRole('switch', { name: 'Pin sessions that need you' }).click()

  await closeApp(handle, { keepProfile: true })
  handle = await launchApp(profile)
  await openWall(handle.page)
  await expect(
    handle.page.getByRole('radiogroup', { name: 'Tile size' }).getByRole('radio', { name: 'Large' })
  ).toHaveAttribute('aria-checked', 'true')
  await expect(
    handle.page.getByRole('switch', { name: 'Pin sessions that need you' })
  ).toHaveAttribute('aria-checked', 'false')
})
