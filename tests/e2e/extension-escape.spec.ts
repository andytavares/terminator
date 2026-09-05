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

const SPECKIT_SEARCH = 'input[aria-label="Search workspace knowledge"]'

/** Run script inside the SpecKit extension view and return its result. */
function inSpecKit<T>(script: string): Promise<T> {
  return handle.app.evaluate(async ({ webContents }, src) => {
    const view = webContents
      .getAllWebContents()
      .find((wc) => !wc.isDestroyed() && wc.getURL().includes('speckit'))
    if (!view) throw new Error('the SpecKit view is not loaded')
    return view.executeJavaScript(src) as Promise<unknown>
  }, script) as Promise<T>
}

/** Sends Escape into SpecKit's own view, bypassing the host page. */
async function pressEscape(times: number, gapMs = 100): Promise<void> {
  await handle.app.evaluate(
    async ({ webContents }, { count, gap }) => {
      const view = webContents
        .getAllWebContents()
        .find((wc) => !wc.isDestroyed() && wc.getURL().includes('speckit'))
      if (!view) throw new Error('the SpecKit view is not loaded')
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
 * already up closes it. Each test asks for "SpecKit is on screen", not "click
 * the SpecKit button".
 */
async function openSpecKit(): Promise<void> {
  if (await extensionShowing()) return
  const button = handle.page.locator('button[aria-label="SpecKit"]')
  await expect(button).toBeVisible({ timeout: 15000 })
  await button.click()
  await expect.poll(extensionShowing, { timeout: 20000 }).toBe(true)
  await handle.page.waitForTimeout(500)
}

/** Move focus off any text field, so the text-field guard is not what is being tested. */
function blurEverything(): Promise<void> {
  return inSpecKit(`(() => {
    const el = document.activeElement
    if (el && typeof el.blur === 'function') el.blur()
    return true
  })()`)
}

async function focusSearchAndType(value: string): Promise<string> {
  return inSpecKit<string>(`(() => {
    const el = document.querySelector(${JSON.stringify(SPECKIT_SEARCH)})
    if (!el) return 'no input'
    el.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return document.activeElement === el ? el.value : 'not focused'
  })()`)
}

function searchValue(): Promise<string> {
  return inSpecKit<string>(`(() => {
    const el = document.querySelector(${JSON.stringify(SPECKIT_SEARCH)})
    return el ? el.value : '<gone>'
  })()`)
}

/**
 * Report an open dialog the way @terminator/extension-ui does — across the
 * bridge. Setting a key on the page's own window would be invisible to the
 * preload, which runs in an isolated world.
 */
function setModalDepth(depth: number): Promise<void> {
  return inSpecKit(`(() => { window.electronAPI.ui.setModalDepth(${depth}); return true })()`)
}

test('Escape twice in a text field keeps the extension open and the draft intact', async () => {
  await openSpecKit()
  expect(await focusSearchAndType('my unsaved draft')).toBe('my unsaved draft')

  await pressEscape(2)
  await handle.page.waitForTimeout(1000)

  // The defect: before the guard, both of these failed — the extension closed
  // and the text went with it.
  expect(await extensionShowing()).toBe(true)
  expect(await searchValue()).toBe('my unsaved draft')
})

test('Escape twice while a dialog is open does not exit the extension', async () => {
  await openSpecKit()
  await blurEverything()
  await setModalDepth(1)

  await pressEscape(2)
  await handle.page.waitForTimeout(1000)

  expect(await extensionShowing()).toBe(true)
  await setModalDepth(0)
})

test('Escape twice with nested dialogs open does not exit the extension', async () => {
  await openSpecKit()
  await blurEverything()
  await setModalDepth(3)

  await pressEscape(2)
  await handle.page.waitForTimeout(1000)

  expect(await extensionShowing()).toBe(true)
  await setModalDepth(0)
})

test('the exit gesture still works once nothing has claimed the key', async () => {
  await openSpecKit()
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
  await openSpecKit()
  await blurEverything()

  await pressEscape(1)
  await handle.page.waitForTimeout(900)
  await pressEscape(1)
  await handle.page.waitForTimeout(600)

  expect(await extensionShowing()).toBe(true)
})
