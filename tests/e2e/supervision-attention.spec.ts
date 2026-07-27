import { test, expect } from '@playwright/test'
import { launchApp, closeApp, type AppHandle } from './helpers'

// SC-003: after time away, the state of every session is determinable from one
// surface. The status bar is that surface, and it is on every screen — this
// asserts it is actually mounted and rendering, which unit tests cannot.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('the supervision status bar is mounted on the main surface', async () => {
  const statusBar = handle.page.locator('.sv-statusbar')
  await expect(statusBar).toBeVisible({ timeout: 15_000 })
})

test('it states all clear rather than showing nothing (FR-024)', async () => {
  // With no supervised sessions the console must assert that everything is
  // fine. Silence is what a crashed console also looks like.
  const statusBar = handle.page.locator('.sv-statusbar')
  await expect(statusBar).toContainText('all clear')
})

test('it reports every count the operator needs, without opening anything', async () => {
  const statusBar = handle.page.locator('.sv-statusbar')
  await expect(statusBar).toContainText('need you')
  await expect(statusBar).toContainText('working')
  await expect(statusBar).toContainText('to review')
  await expect(statusBar).toContainText('failed')
})

test('the attention queue opens from the status bar and answers the question', async () => {
  await handle.page.locator('.sv-statusbar').click()
  const queue = handle.page.locator('.app-supervision-panel')
  await expect(queue).toBeVisible()
  // Nothing needs the operator, so the panel says so in words rather than
  // rendering an ambiguous blank (FR-024).
  await expect(queue).toContainText('Nothing needs you')
})

test('the attention queue closes again', async () => {
  await handle.page.locator('.sv-statusbar').click()
  await expect(handle.page.locator('.app-supervision-panel')).toHaveCount(0)
})
