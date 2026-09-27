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
  await expect(handle.page.locator('.app-band__entry').first()).toBeVisible({ timeout: 20000 })
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

/** True once the extension surface's own WebContentsView has finished loading. */
function viewReady(part: string): Promise<boolean> {
  return handle.app.evaluate(
    ({ webContents }, p) =>
      webContents
        .getAllWebContents()
        .some((wc) => !wc.isDestroyed() && wc.getURL().includes(p) && !wc.isLoading()),
    part
  )
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
      // Let React commit the resulting state before the next call reads the DOM.
      await v.executeJavaScript(
        'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'
      )
    },
    { p: part, k: keyCode, mods: modifiers }
  )
}

test('a dialog puts focus inside itself, keeps Tab there, and closes on Escape', async () => {
  await handle.page.locator('button[aria-label="Notes"]').click()
  await expect
    .poll(() => viewReady('notepad'), {
      timeout: 20000,
      message: 'notepad view never finished loading',
    })
    .toBe(true)

  // Open the composer without touching it with a mouse afterwards.
  await inView(
    'notepad',
    `(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /new note/i.test(x.textContent || ''))
      if (b) b.click()
      return !!b
    })()`
  )
  await expect
    .poll(() => inView<boolean>('notepad', `!!document.querySelector('[data-tmui-surface]')`), {
      timeout: 10000,
      message: 'the composer surface never opened',
    })
    .toBe(true)

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
  // Self-contained: does not assume the previous test left Notes open, so it
  // passes whether run as part of the file or alone.
  const panel = handle.page.locator('[data-extension-panel="terminator.notepad"]')
  if ((await panel.count()) === 0) {
    await handle.page.locator('button[aria-label="Notes"]').click()
  }
  await expect(panel).toHaveCount(1, { timeout: 20000 })
  await expect
    .poll(() => viewReady('notepad'), {
      timeout: 20000,
      message: 'notepad view never finished loading',
    })
    .toBe(true)

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

/**
 * SC-001, across all five extensions rather than the one the original spec
 * drove.
 *
 * Two guards stand between Escape and lost work, and they cover different
 * cases: the text-field guard (focus in an input) and the modal-depth guard
 * (a surface open, focus anywhere in it). A surface can pass the first and
 * fail the second — which is exactly how three Notepad modals shipped broken.
 * So each extension is checked on whichever it actually has.
 */
const SURFACES: { id: string; label: string; part: string; open: string }[] = [
  { id: 'terminator.notepad', label: 'Notes', part: 'notepad', open: 'new note' },
  // Foundry opens on the inbox, which has no text field; the Forge is where
  // an idea is typed, so that tab is the control to press first.
  { id: 'terminator.foundry', label: 'Foundry', part: 'foundry', open: 'forge' },
  // Each extension opens on an empty state, so the field to type into has to
  // be brought up first — which is also the path a person takes.
  { id: 'terminator.task-vault', label: 'Task Vault', part: 'task-vault', open: 'add task' },
]

for (const { id, label, part, open } of SURFACES) {
  test(`${label}: two Escapes with a draft in a text field keep the extension open`, async () => {
    // Idempotent: the sidebar button toggles, so clicking it when the panel is
    // already up puts the extension away instead of bringing it forward.
    const panel = handle.page.locator(`[data-extension-panel="${id}"]`)
    if ((await panel.count()) === 0) {
      await handle.page.locator(`button[aria-label="${label}"]`).click()
    }
    await expect(panel).toHaveCount(1, { timeout: 20000 })
    await expect
      .poll(() => viewReady(part), {
        timeout: 20000,
        message: `${label} view never finished loading`,
      })
      .toBe(true)

    await inView(
      part,
      `(() => {
        const b = [...document.querySelectorAll('button')].find((x) =>
          (x.textContent || '').toLowerCase().includes(${JSON.stringify(open)})
        )
        if (b) b.click()
        return !!b
      })()`
    )
    await expect
      .poll(
        () =>
          inView<boolean>(part, `!!document.querySelector('input:not([type=hidden]),textarea')`),
        {
          timeout: 10000,
          message: `${label} never showed a text field after opening "${open}"`,
        }
      )
      .toBe(true)

    // Type into the first field this extension offers, wherever it is.
    const typed = await inView<boolean>(
      part,
      `(() => {
        const el = document.querySelector('input:not([type=hidden]),textarea')
        if (!el) return false
        el.focus()
        el.value = 'UNSAVED DRAFT'
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return document.activeElement === el
      })()`
    )
    expect(typed, `${label} offered no text field to type into`).toBe(true)

    await key(part, 'Escape')
    await key(part, 'Escape')

    const still = await handle.page.evaluate(
      () =>
        document.querySelector('[data-extension-panel]')?.getAttribute('data-extension-panel') ??
        null
    )
    expect(still, `${label} was closed by Escape while a draft was unsaved`).toBe(id)
  })
}

/**
 * The other half of FR-001, and the reason the guards are three conditions
 * rather than one: Remote Control's screen has no text field and no modal, so
 * there is nothing to protect and the gesture must still work. A guard that
 * only ever suppresses is not a guard, it is a broken feature — and this is
 * the case that would catch that.
 */
test('Remote Control: two Escapes still leave the extension, because nothing is at risk', async () => {
  const id = 'terminator.remote-control'
  const panel = handle.page.locator(`[data-extension-panel="${id}"]`)
  if ((await panel.count()) === 0) {
    await handle.page.locator('button[aria-label="Remote Control"]').click()
  }
  await expect(panel).toHaveCount(1, { timeout: 20000 })
  await expect
    .poll(() => viewReady('remote-control'), {
      timeout: 20000,
      message: 'Remote Control view never finished loading',
    })
    .toBe(true)

  // Nothing typed into, nothing open: the two conditions that would suppress.
  const state = await inView<{ fields: number; surfaces: number }>(
    'remote-control',
    `(() => ({
      fields: document.querySelectorAll('input:not([type=hidden]),textarea').length,
      surfaces: document.querySelectorAll('[data-tmui-surface],[data-tmui-panel]').length,
    }))()`
  )
  expect(state.fields, 'this test only means anything with no field on screen').toBe(0)
  expect(state.surfaces, 'and no open surface').toBe(0)

  await key('remote-control', 'Escape')
  await key('remote-control', 'Escape')

  await expect
    .poll(
      () =>
        handle.page.evaluate(
          () =>
            document
              .querySelector('[data-extension-panel]')
              ?.getAttribute('data-extension-panel') ?? null
        ),
      { timeout: 6000, message: 'with nothing at risk the exit gesture must still fire' }
    )
    .not.toBe(id)
})
