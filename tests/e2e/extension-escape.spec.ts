import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace, inExtensionView } from './helpers'
import { openFoundry as openFoundryPanel } from './foundry-harness'

// The guards on the exit gesture (feature 036).
//
// `extension-escape-exit.spec.ts` covers the gesture itself. This covers when it
// must stand down — the rule the host window applied and the extension view did
// not. Typing into an extension field and pressing Escape twice used to close
// the extension and discard the draft; there was no confirmation and no undo.
//
// These cannot be unit tests. The keystroke has to originate inside the
// extension's frame, where the frame shim (ADR 114) applies the guards.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'terminator', process.cwd())
  await expect(handle.page.locator('.app-band__entry').first()).toBeVisible({ timeout: 20000 })
})

test.afterAll(async () => {
  await closeApp(handle)
})

const FOUNDRY_IDEA = 'input[aria-label="Describe what you want built or fixed"]'

/**
 * Waits out real wall-clock time. The double-Escape gesture is timed against
 * `Date.now()` inside the extension's frame, which Playwright cannot attach a
 * fake clock to, so proving presses fall inside or outside
 * `DOUBLE_ESCAPE_WINDOW_MS` genuinely requires that much time to elapse.
 */
async function realDelay(ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

/** Run script inside the Foundry extension frame and return its result. */
function inFoundry<T>(script: string): Promise<T> {
  return inExtensionView<T>(handle, 'foundry', script)
}

/** Sends Escape into Foundry's frame as real key presses. */
async function pressEscape(times: number, gapMs = 100): Promise<void> {
  const frame = handle.page.frames().find((f) => f.url().includes('foundry'))
  if (!frame) throw new Error('the Foundry frame is not loaded')
  // The frame's document must own focus for the shim to see the key.
  await frame.evaluate(() => (document.body as HTMLElement).focus())
  for (let i = 0; i < times; i++) {
    await handle.page.keyboard.press('Escape')
    if (i < times - 1) await realDelay(gapMs)
  }
}

/** Is an extension surface still on screen? The panel div outlives the exit
 * (it stays mounted, hidden), so ask whether it is actually displayed. */
function extensionShowing(): Promise<boolean> {
  return handle.page.evaluate(() => {
    const panel = document.querySelector('[data-extension-panel]')
    return !!panel && getComputedStyle(panel).display !== 'none'
  })
}

/** Foundry on screen, unless it already is (its band button toggles). */
async function showFoundry(): Promise<void> {
  if (await extensionShowing()) return
  await openFoundryPanel(handle)
}

/** Move focus off any text field, so the text-field guard is not what is being tested. */
function blurEverything(): Promise<void> {
  return inFoundry(`(() => {
    const el = document.activeElement
    if (el && typeof el.blur === 'function') el.blur()
    return true
  })()`)
}

/**
 * Put the Forge on screen.
 *
 * The inbox is home, and the text field this spec needs is on the Forge — so
 * "open Foundry" is not enough to reach a text field any more.
 */
async function openForge(): Promise<void> {
  await expect
    .poll(() =>
      inFoundry<boolean>(`(function () {
    var all = document.querySelectorAll('button')
    for (var i = 0; i < all.length; i++) {
      if ((all[i].textContent || '').trim() === 'Forge') { all[i].click(); return true }
    }
    return false
  })()`)
    )
    .toBe(true)
  await expect
    .poll(() => inFoundry<boolean>(`!!document.querySelector(${JSON.stringify(FOUNDRY_IDEA)})`), {
      timeout: 10000,
    })
    .toBe(true)
}

async function focusIdeaAndType(value: string): Promise<string> {
  return inFoundry<string>(`(() => {
    const el = document.querySelector(${JSON.stringify(FOUNDRY_IDEA)})
    if (!el) return 'no input'
    el.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return document.activeElement === el ? el.value : 'not focused'
  })()`)
}

function ideaValue(): Promise<string> {
  return inFoundry<string>(`(() => {
    const el = document.querySelector(${JSON.stringify(FOUNDRY_IDEA)})
    return el ? el.value : '<gone>'
  })()`)
}

/**
 * Report an open dialog the way @terminator/extension-ui does — across the
 * bridge.
 */
function setModalDepth(depth: number): Promise<void> {
  return inFoundry(`(() => { window.electronAPI.ui.setModalDepth(${depth}); return true })()`)
}

test('Escape twice in a text field keeps the extension open and the draft intact', async () => {
  await showFoundry()
  await openForge()
  expect(await focusIdeaAndType('my unsaved draft')).toBe('my unsaved draft')

  await pressEscape(2)
  await realDelay(50)

  // The defect: before the guard, both of these failed — the extension closed
  // and the text went with it.
  expect(await extensionShowing()).toBe(true)
  expect(await ideaValue()).toBe('my unsaved draft')
})

test('Escape twice while a dialog is open does not exit the extension', async () => {
  await showFoundry()
  await blurEverything()
  await setModalDepth(1)

  await pressEscape(2)
  await realDelay(50)

  expect(await extensionShowing()).toBe(true)
  await setModalDepth(0)
})

test('Escape twice with nested dialogs open does not exit the extension', async () => {
  await showFoundry()
  await blurEverything()
  await setModalDepth(3)

  await pressEscape(2)
  await realDelay(50)

  expect(await extensionShowing()).toBe(true)
  await setModalDepth(0)
})

test('the exit gesture still works once nothing has claimed the key', async () => {
  await showFoundry()
  // Neither a text field nor a terminal, and nothing open — the one case where
  // the gesture is supposed to fire.
  await blurEverything()
  await setModalDepth(0)

  await pressEscape(2)

  // The preserved behaviour: a deliberate double press with nothing claiming
  // the key still returns the user to their terminal.
  await expect
    .poll(extensionShowing, { timeout: 6000, message: 'the extension should have exited' })
    .toBe(false)
})

test('two Escapes further apart than the gesture window never pair', async () => {
  await showFoundry()
  await blurEverything()

  await pressEscape(1)
  await realDelay(900)
  await pressEscape(1)
  await realDelay(600)

  expect(await extensionShowing()).toBe(true)
})
