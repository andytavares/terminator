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

// These share one app instance, so each opens from a known state rather than
// inheriting whatever the previous test left on screen.
async function openConsole(): Promise<void> {
  if ((await handle.page.locator('.sv-screen').count()) === 0) {
    await handle.page.locator('.sv-statusbar').click()
  }
  await expect(handle.page.locator('.sv-screen')).toBeVisible()
}

async function closeConsole(): Promise<void> {
  if ((await handle.page.locator('.sv-screen').count()) > 0) {
    await handle.page.locator('.sv-statusbar').click()
  }
  await expect(handle.page.locator('.sv-screen')).toHaveCount(0)
}

test('the console opens from the status bar and answers the question', async () => {
  await closeConsole()
  await handle.page.locator('.sv-statusbar').click()
  // A view like any other, not a drawer over whatever you were doing.
  const view = handle.page.locator('.sv-screen')
  await expect(view).toBeVisible()
  // Nothing needs the operator, so it says so in words rather than rendering
  // an ambiguous blank (FR-024).
  await expect(view).toContainText('Nothing needs you')
})

test('Escape leaves it, as it does any full-screen view', async () => {
  await openConsole()
  await handle.page.keyboard.press('Escape')
  await expect(handle.page.locator('.sv-screen')).toHaveCount(0)
})

test('Cmd+Shift+A opens it — the shifted key a real keypress sends', async () => {
  await closeConsole()
  await handle.page.keyboard.press('Meta+Shift+A')
  await expect(handle.page.locator('.sv-screen')).toBeVisible()
  await handle.page.keyboard.press('Escape')
})

test('the status bar closes it again', async () => {
  await openConsole()
  await handle.page.locator('.sv-statusbar').click()
  await expect(handle.page.locator('.sv-screen')).toHaveCount(0)
})
