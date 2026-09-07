import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'

// The guards on the exit gesture (feature 036).
//
// `extension-escape-exit.spec.ts` covers the gesture itself. This covers when it
// must stand down — the rule the host window applied and the extension view did
// not. Typing into an extension field and pressing Escape twice used to close
// the extension and discard the draft; there was no confirmation and no undo.
//
// These cannot be unit tests. The keystroke has to originate inside the
// extension's own WebContentsView, which is a separate webContents the
// Playwright page can neither see nor type into.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'terminator', process.cwd())
  await handle.page.waitForTimeout(2000)
})

test.afterAll(async () => {
  await closeApp(handle)
})

const FOUNDRY_IDEA = 'input[aria-label="Describe what you want built or fixed"]'

/** Run script inside the Foundry extension view and return its result. */
function inFoundry<T>(script: string): Promise<T> {
  return handle.app.evaluate(async ({ webContents }, src) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
    if (!view) throw new Error('the Foundry view is not loaded')
    return view.executeJavaScript(src) as Promise<unknown>
  }, script) as Promise<T>
}

/** Sends Escape into Foundry's own view, bypassing the host page. */
async function pressEscape(times: number, gapMs = 100): Promise<void> {
  await handle.app.evaluate(
    async ({ webContents }, { count, gap }) => {
      const view = webContents
        .getAllWebContents()
        .find((wc) => !wc.isDestroyed() && wc.getURL().includes('foundry'))
      if (!view) throw new Error('the Foundry view is not loaded')
      for (let i = 0; i < count; i++) {
        view.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
        view.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
        if (i < count - 1) await new Promise((r) => setTimeout(r, gap))
      }
    },
    { count: times, gap: gapMs }
  )
}

/**
 * Is an extension surface still on screen?
 *
 * Deliberately NOT `getAllWebContents().some(...)`: exiting an extension calls
 * `setVisible(false)` on its WebContentsView, it does not destroy it, so the
 * webContents outlives the exit and that predicate reports true forever. Ask
 * the window what it is actually compositing instead.
 */
function extensionShowing(): Promise<boolean> {
  return handle.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const views = (
      win as unknown as {
        contentView: {
          children: { getVisible(): boolean; getBounds(): { width: number; height: number } }[]
        }
      }
    ).contentView.children
    return views.some((v) => {
      const b = v.getBounds()
      return v.getVisible() && b.width > 100 && b.height > 100
    })
  })
}

/**
 * Idempotent: the workspace tab button toggles, so clicking it when the view is
 * already up closes it. Each test asks for "Foundry is on screen", not "click
 * the Foundry button".
 */
async function openFoundry(): Promise<void> {
  if (await extensionShowing()) return
  const button = handle.page.locator('button[aria-label="Foundry"]')
  await expect(button).toBeVisible({ timeout: 15000 })
  await button.click()
  await expect.poll(extensionShowing, { timeout: 20000 }).toBe(true)
  await handle.page.waitForTimeout(500)
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
  await inFoundry(`(function () {
    var all = document.querySelectorAll('button')
    for (var i = 0; i < all.length; i++) {
      if ((all[i].textContent || '').trim() === 'Forge') { all[i].click(); return true }
    }
    return false
  })()`)
  await handle.page.waitForTimeout(600)
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
 * bridge. Setting a key on the page's own window would be invisible to the
 * preload, which runs in an isolated world.
 */
function setModalDepth(depth: number): Promise<void> {
  return inFoundry(`(() => { window.electronAPI.ui.setModalDepth(${depth}); return true })()`)
}

test('Escape twice in a text field keeps the extension open and the draft intact', async () => {
  await openFoundry()
  await openForge()
  expect(await focusIdeaAndType('my unsaved draft')).toBe('my unsaved draft')

  await pressEscape(2)
  await handle.page.waitForTimeout(1000)

  // The defect: before the guard, both of these failed — the extension closed
  // and the text went with it.
  expect(await extensionShowing()).toBe(true)
  expect(await ideaValue()).toBe('my unsaved draft')
})

test('Escape twice while a dialog is open does not exit the extension', async () => {
  await openFoundry()
  await blurEverything()
  await setModalDepth(1)

  await pressEscape(2)
  await handle.page.waitForTimeout(1000)

  expect(await extensionShowing()).toBe(true)
  await setModalDepth(0)
})

test('Escape twice with nested dialogs open does not exit the extension', async () => {
  await openFoundry()
  await blurEverything()
  await setModalDepth(3)

  await pressEscape(2)
  await handle.page.waitForTimeout(1000)

  expect(await extensionShowing()).toBe(true)
  await setModalDepth(0)
})

test('the exit gesture still works once nothing has claimed the key', async () => {
  await openFoundry()
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
  await openFoundry()
  await blurEverything()

  await pressEscape(1)
  await handle.page.waitForTimeout(900)
  await pressEscape(1)
  await handle.page.waitForTimeout(600)

  expect(await extensionShowing()).toBe(true)
})
