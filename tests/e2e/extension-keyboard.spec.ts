import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'

/**
 * SC-003: every scenario in this feature can be completed with a keyboard.
 *
 * The criterion was asserted by inference until now — the shared components
 * trap focus, therefore keyboard works. That reasoning skips the part that
 * actually breaks: whether focus lands somewhere useful when the surface
 * opens, whether Tab stays inside it, and whether the thing under focus can be
 * activated without a mouse. This drives the real app.
 */

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'terminator', process.cwd())
  await handle.page.waitForTimeout(2000)
})

test.afterAll(async () => {
  await closeApp(handle)
})

function inView<T>(part: string, script: string): Promise<T> {
  return handle.app.evaluate(
    async ({ webContents }, { p, src }) => {
      const v = webContents
        .getAllWebContents()
        .find((w) => !w.isDestroyed() && w.getURL().includes(p))
      if (!v) throw new Error(`no view for ${p}`)
      return v.executeJavaScript(src) as Promise<unknown>
    },
    { p: part, src: script }
  ) as Promise<T>
}

/** Send real key events into an extension's own webContents. */
async function key(part: string, keyCode: string, modifiers: string[] = []): Promise<void> {
  await handle.app.evaluate(
    async ({ webContents }, { p, k, mods }) => {
      const v = webContents
        .getAllWebContents()
        .find((w) => !w.isDestroyed() && w.getURL().includes(p))
      if (!v) return
      v.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods as never })
      v.sendInputEvent({ type: 'char', keyCode: k, modifiers: mods as never })
      v.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods as never })
    },
    { p: part, k: keyCode, mods: modifiers }
  )
  await handle.page.waitForTimeout(150)
}

test('a dialog puts focus inside itself, keeps Tab there, and closes on Escape', async () => {
  await handle.page.locator('button[aria-label="Notes"]').click()
  await handle.page.waitForTimeout(2500)

  // Open the composer without touching it with a mouse afterwards.
  await inView(
    'notepad',
    `(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /new note/i.test(x.textContent || ''))
      if (b) b.click()
      return !!b
    })()`
  )
  await handle.page.waitForTimeout(800)

  // Focus is inside the surface, not left behind it.
  const focusedInside = await inView<boolean>(
    'notepad',
    `(() => {
      const s = document.querySelector('[data-tmui-surface]')
      return !!s && s.contains(document.activeElement)
    })()`
  )
  expect(focusedInside, 'focus should move into the surface when it opens').toBe(true)

  // Tab several times; focus must never escape the surface.
  for (let i = 0; i < 8; i++) await key('notepad', 'Tab')
  const stillInside = await inView<boolean>(
    'notepad',
    `(() => {
      const s = document.querySelector('[data-tmui-surface]')
      return !!s && s.contains(document.activeElement)
    })()`
  )
  expect(stillInside, 'Tab should not leave an open surface').toBe(true)

  // Escape closes the surface — and only the surface.
  await key('notepad', 'Escape')
  const closed = await inView<boolean>('notepad', `!document.querySelector('[data-tmui-surface]')`)
  expect(closed, 'Escape should close the surface').toBe(true)

  const stillOpen = await handle.page.evaluate(
    () =>
      document.querySelector('[data-extension-panel]')?.getAttribute('data-extension-panel') ?? null
  )
  expect(stillOpen, 'closing a dialog must not close the extension').toBe('terminator.notepad')
})

test('every focusable control in an extension view shows a focus ring', async () => {
  const missing = await inView<string[]>(
    'notepad',
    `(() => {
      const bad = []
      const controls = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      for (const el of controls.slice(0, 40)) {
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        el.focus()
        if (document.activeElement !== el) continue
        const cs = getComputedStyle(el)
        const ring =
          (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
          cs.boxShadow !== 'none'
        if (!ring) bad.push((el.className || el.tagName).toString().split(' ')[0])
      }
      return bad
    })()`
  )
  expect(missing, `controls with no visible focus indicator: ${missing.join(', ')}`).toHaveLength(0)
})
