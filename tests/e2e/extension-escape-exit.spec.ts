import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp } from './helpers'

// Proves the double-Escape exit against the real app, including the part unit
// tests cannot reach: the keystroke originates inside an extension's own
// WebContentsView, which is a separate webContents the Playwright page cannot
// see or type into.

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

/** True once the extension's WebContentsView exists and has finished loading. */
function extensionViewReady(): Promise<boolean> {
  return handle.app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .some((wc) => !wc.isDestroyed() && wc.getURL().startsWith('ext://') && !wc.isLoading())
  )
}

/** Sends Escape into the extension's own WebContentsView, bypassing the host page. */
async function pressEscapeInExtensionView(times: number): Promise<void> {
  await handle.app.evaluate(async ({ webContents }, count) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().startsWith('ext://'))
    if (!view) throw new Error('no extension WebContentsView is loaded')
    for (let i = 0; i < count; i++) {
      view.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      view.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    }
  }, times)
}

// Named explicitly: the first rail tab is the core Overview screen, which
// renders no extension panel and is deliberately not exitable.
const EXTENSION_TAB_TITLE = 'Notes'

async function openExtensionGlobalTab(): Promise<void> {
  const tab = handle.page.locator(`.sidebar-header__tab[title="${EXTENSION_TAB_TITLE}"]`)
  await expect(tab).toBeVisible({ timeout: 15000 })
  await tab.click()
  await expect(handle.page.locator('[data-extension-panel]')).toHaveCount(1, { timeout: 10000 })
  // The host renderer only reports bounds; main creates and loads the view
  // afterwards, so the placeholder existing does not mean it can take input yet.
  await expect
    .poll(extensionViewReady, { timeout: 20000, message: 'extension view never finished loading' })
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
  await handle.page.waitForTimeout(1000)

  expect(await activeGlobalTab()).not.toBeNull()

  // Leave the app on the terminal for any later spec.
  await pressEscapeInExtensionView(2)
  await expect.poll(activeGlobalTab, { timeout: 5000 }).toBeNull()
})

test('two Escapes further apart than the gesture window do not exit', async () => {
  await openExtensionGlobalTab()

  await pressEscapeInExtensionView(1)
  await handle.page.waitForTimeout(900)
  await pressEscapeInExtensionView(1)
  await handle.page.waitForTimeout(500)

  expect(await activeGlobalTab()).not.toBeNull()

  await pressEscapeInExtensionView(2)
  await expect.poll(activeGlobalTab, { timeout: 5000 }).toBeNull()
})
