import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'
import { extensionFrame } from './extension-page'

// Proves the double-Escape exit against the real app, with the keystroke
// originating inside the extension's frame: the frame shim (ADR 114) detects
// the gesture in the page and posts it over the port.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

/** Which extension global tab, if any, the host renderer is currently showing. */
async function activeGlobalTab(): Promise<string | null> {
  return handle.page.evaluate(() => {
    const el = document.querySelector('[data-extension-panel]')
    return el?.getAttribute('data-extension-panel') ?? null
  })
}

/** Sends Escape into the extension's frame as real key presses. */
async function pressEscapeInExtensionView(times: number): Promise<void> {
  const frame = extensionFrame(handle, 'dist/index.html')
  if (!frame) throw new Error('no extension frame is loaded')
  // The frame's document must own focus for the shim to see the key; focusing
  // its body is what a click into the view does.
  await frame.evaluate(() => (document.body as HTMLElement).focus())
  for (let i = 0; i < times; i++) {
    await handle.page.keyboard.press('Escape')
  }
}

// Named explicitly: the first rail tabs are the core Home and Overview screens, which
// render no extension panel and are deliberately not exitable.
const EXTENSION_TAB_TITLE = 'Notes'

/**
 * Waits out real wall-clock time. The double-Escape gesture is timed against
 * `Date.now()` inside the extension's frame, which Playwright cannot attach a
 * fake clock to, so proving a press falls outside `DOUBLE_ESCAPE_WINDOW_MS`
 * genuinely requires that much time to elapse.
 */
async function realDelay(ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

async function openExtensionGlobalTab(): Promise<void> {
  // Global tabs now live in the labelled app band, addressed by accessible name.
  const tab = handle.page.locator(`.app-band__entry[aria-label="${EXTENSION_TAB_TITLE}"]`)
  await expect(tab).toBeVisible({ timeout: 15000 })
  await tab.click()
  await expect(handle.page.locator('[data-extension-panel]')).toHaveCount(1, { timeout: 10000 })
  // The host renderer draws the panel placeholder first; the frame attaches and
  // loads afterwards, so the placeholder existing does not mean the frame can
  // take input yet.
  await expect
    .poll(
      async () => {
        const frame = extensionFrame(handle, 'dist/index.html')
        if (!frame) return false
        return frame.evaluate(() => document.readyState === 'complete').catch(() => false)
      },
      { timeout: 20000, message: 'extension frame never finished loading' }
    )
    .toBe(true)
}

test('double-Escape inside an extension view returns to the terminal', async () => {
  await openExtensionGlobalTab()
  expect(await activeGlobalTab()).not.toBeNull()

  await pressEscapeInExtensionView(2)

  await expect
    .poll(activeGlobalTab, { timeout: 5000, message: 'extension panel should be gone' })
    .toBeNull()
})

test('a single Escape leaves the extension open', async () => {
  await openExtensionGlobalTab()

  await pressEscapeInExtensionView(1)
  await realDelay(1000)

  expect(await activeGlobalTab()).not.toBeNull()

  // Leave the app on the terminal for any later spec.
  await pressEscapeInExtensionView(2)
  await expect.poll(activeGlobalTab, { timeout: 5000 }).toBeNull()
})

test('two Escapes further apart than the gesture window do not exit', async () => {
  await openExtensionGlobalTab()

  await pressEscapeInExtensionView(1)
  await realDelay(900)
  await pressEscapeInExtensionView(1)
  await realDelay(500)

  expect(await activeGlobalTab()).not.toBeNull()

  await pressEscapeInExtensionView(2)
  await expect.poll(activeGlobalTab, { timeout: 5000 }).toBeNull()
})
