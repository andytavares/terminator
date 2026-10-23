import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'
import { extensionFrame } from './extension-page'
import { expectCentredInWindow } from './modal-centre'

// Leaving an extension with the keyboard (feature 036, ADR 114). The keystroke has to start
// inside the extension's frame, where the frame shim applies the double-Escape gesture and its
// guards, so none of this can be a unit test.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await createWorkspace(handle.page, 'terminator', process.cwd())
  await expect(handle.page.locator('.app-band__entry').first()).toBeVisible()
})

test.afterAll(async () => {
  await closeApp(handle)
})

interface Surface {
  id: string
  label: string
  part: string
}

const NOTES: Surface = { id: 'terminator.notepad', label: 'Notes', part: 'notepad' }
const FOUNDRY: Surface = { id: 'terminator.foundry', label: 'Foundry', part: 'foundry' }
const TASK_VAULT: Surface = { id: 'terminator.task-vault', label: 'Task Vault', part: 'task-vault' }
const REMOTE_CONTROL: Surface = {
  id: 'terminator.remote-control',
  label: 'Remote Control',
  part: 'remote-control',
}

/**
 * Moves on both clocks that pair double-Escape presses (frame-shim.ts, ExtensionPanelPortal.tsx),
 * which Playwright's page clock cannot reach, instead of waiting out DOUBLE_ESCAPE_WINDOW_MS. */
async function advanceClocks(part: string, ms: number): Promise<void> {
  const shift = (offset: number) => {
    const now = performance.now.bind(performance)
    performance.now = () => now() + offset
  }
  await handle.page.evaluate(shift, ms)
  await inView(part, `(${shift})(${ms})`)
}

/** Run `script` inside the extension frame whose URL contains `part`. */
async function inView<T>(part: string, script: string): Promise<T> {
  const frame = extensionFrame(handle, part)
  if (!frame) throw new Error(`no frame for ${part}`)
  return frame.evaluate(script) as Promise<T>
}

/** True once the extension surface's frame has finished loading. */
async function viewReady(part: string): Promise<boolean> {
  const frame = extensionFrame(handle, part)
  if (!frame) return false
  return frame.evaluate(() => document.readyState === 'complete').catch(() => false)
}

/** Sends a key into an extension's frame as a real key press. */
async function key(part: string, keyCode: string): Promise<void> {
  const frame = extensionFrame(handle, part)
  if (!frame) return
  // The frame's document must own focus for its listeners to see the key.
  await frame.evaluate(() => (document.body as HTMLElement).focus())
  await handle.page.keyboard.press(keyCode)
  // Let React commit the resulting state before the next call reads the DOM.
  // A key can legitimately exit the extension, detaching the frame mid-wait.
  await frame
    .evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    .catch(() => {})
}

/** Two Escapes inside the gesture window. */
async function pressEscapeTwice(part: string): Promise<void> {
  await key(part, 'Escape')
  await key(part, 'Escape')
}

/** The extension whose panel is on screen, or null. The panel div outlives the exit (it stays
 * mounted, hidden), so this asks which one is actually displayed. */
function activeExtensionPanel(): Promise<string | null> {
  return handle.page.evaluate(() => {
    const shown = [...document.querySelectorAll('[data-extension-panel]')].find(
      (panel) => getComputedStyle(panel).display !== 'none'
    )
    return shown?.getAttribute('data-extension-panel') ?? null
  })
}

/** Brings an extension's panel up and waits for its view to load. Idempotent: the band button
 * toggles, so clicking it when the panel is already up would put the extension away. */
async function showPanel({ id, label, part }: Surface): Promise<void> {
  if ((await activeExtensionPanel()) !== id) {
    await handle.page.locator(`button[aria-label="${label}"]`).click()
  }
  await expect.poll(activeExtensionPanel).toBe(id)
  await expect.poll(() => viewReady(part), { message: `${label} view never loaded` }).toBe(true)
}

/** Neither a text field nor a dialog holds the key, so only the gesture itself is tested. */
async function nothingClaimsTheKey(part: string): Promise<void> {
  await inView(
    part,
    `(() => {
      const el = document.activeElement
      if (el && typeof el.blur === 'function') el.blur()
      window.electronAPI.ui.setModalDepth(0)
      return true
    })()`
  )
}

async function stillShowing(surface: Surface, why: string): Promise<void> {
  // Two frames on the host: an exit the key requested would have reached the panel by now.
  await handle.page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  await expect.poll(() => activeExtensionPanel(), { message: why }).toBe(surface.id)
}

async function exitsToTheTerminal(surface: Surface, why: string): Promise<void> {
  await expect.poll(activeExtensionPanel, { message: why }).not.toBe(surface.id)
}

// ── Leaving with two Escapes ─────────────────────────────────────────────────

async function singleAndSlowEscapesStay(): Promise<void> {
  await showPanel(NOTES)
  await nothingClaimsTheKey(NOTES.part)
  await key(NOTES.part, 'Escape')
  await advanceClocks(NOTES.part, 900)
  await stillShowing(NOTES, 'a single Escape closed the extension')
  await key(NOTES.part, 'Escape')
  await advanceClocks(NOTES.part, 600)
  await stillShowing(NOTES, 'two Escapes further apart than the gesture window paired')
}

async function doubleEscapeReturnsToTerminal(): Promise<void> {
  await showPanel(NOTES)
  await pressEscapeTwice(NOTES.part)
  await exitsToTheTerminal(NOTES, 'the extension panel should be gone')
}

/** Reports an open dialog the way @terminator/extension-ui does — across the bridge. */
function setModalDepth(part: string, depth: number): Promise<void> {
  return inView(part, `(() => { window.electronAPI.ui.setModalDepth(${depth}); return true })()`)
}

async function openDialogsHoldTheKey(): Promise<void> {
  await showPanel(FOUNDRY)
  for (const depth of [1, 3]) {
    await nothingClaimsTheKey(FOUNDRY.part)
    await setModalDepth(FOUNDRY.part, depth)
    await pressEscapeTwice(FOUNDRY.part)
    await stillShowing(FOUNDRY, `two Escapes with ${depth} dialog(s) open exited the extension`)
  }
  await setModalDepth(FOUNDRY.part, 0)
}

async function gestureWorksOnceNothingClaimsTheKey(): Promise<void> {
  await showPanel(FOUNDRY)
  await nothingClaimsTheKey(FOUNDRY.part)
  await pressEscapeTwice(FOUNDRY.part)
  await exitsToTheTerminal(FOUNDRY, 'the extension should have exited')
}

// ── A draft in a text field keeps the extension open ─────────────────────────

/** Each extension opens on an empty state, so the field to type into is brought up first —
 * which is also the path a person takes. Foundry's is on the Forge, and Foundry goes last: its
 * dialog steps follow once the Forge has settled, as a fresh view re-reports its depth. */
/** `inline`: the field is on the screen itself, not in a dialog Escape rightly closes, so the
 * draft must still be in it afterwards. */
interface DraftSurface extends Surface {
  open: string
  inline?: boolean
}

const DRAFT_SURFACES: DraftSurface[] = [
  { ...NOTES, open: 'new note' },
  { ...TASK_VAULT, open: 'add task' },
  { ...FOUNDRY, open: 'forge', inline: true },
]

const FIELD = `document.querySelector('input:not([type=hidden]),textarea')`

/** Presses the control named `open`, and waits for a text field to show. */
async function bringUpTextField({ label, part, open }: DraftSurface): Promise<void> {
  // Polled: the view reports loaded before React has drawn the button.
  const pressOpen = `(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      (x.textContent || '').toLowerCase().includes(${JSON.stringify(open)}))
    if (b) b.click()
    return !!b
  })()`
  await expect
    .poll(() => inView<boolean>(part, pressOpen), { message: `${label} never offered "${open}"` })
    .toBe(true)
  await expect
    .poll(() => inView<boolean>(part, `!!${FIELD}`), {
      message: `${label} never showed a text field after opening "${open}"`,
    })
    .toBe(true)
}

/** Run in a view: types an unsaved draft into its first text field, and says whether it has focus. */
const TYPE_DRAFT = `(() => {
  const el = ${FIELD}
  if (!el) return false
  el.focus()
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, 'UNSAVED DRAFT')
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return document.activeElement === el
})()`

async function draftKeepsItOpen(surface: DraftSurface): Promise<void> {
  const { label, part } = surface
  await showPanel(surface)
  await bringUpTextField(surface)
  await expect
    .poll(() => inView<boolean>(part, TYPE_DRAFT), {
      message: `${label} offered no field to type in`,
    })
    .toBe(true)
  await key(part, 'Escape')
  await key(part, 'Escape')
  await stillShowing(surface, `${label} was closed by Escape while a draft was unsaved`)
  if (!surface.inline) return
  await expect.poll(() => inView<string>(part, `${FIELD}?.value ?? '<gone>'`)).toBe('UNSAVED DRAFT')
}

/** Remote Control's screen has no text field and no dialog: nothing to protect, so the gesture
 * must still fire. A guard that only ever suppresses is a broken feature. */
async function remoteControlLeavesOnTwoEscapes(): Promise<void> {
  await showPanel(REMOTE_CONTROL)
  const state = await inView<{ fields: number; surfaces: number }>(
    REMOTE_CONTROL.part,
    `(() => ({
      fields: document.querySelectorAll('input:not([type=hidden]),textarea').length,
      surfaces: document.querySelectorAll('[data-tmui-surface],[data-tmui-panel]').length,
    }))()`
  )
  expect(state, 'this only means anything with no field and no surface open').toEqual({
    fields: 0,
    surfaces: 0,
  })
  await pressEscapeTwice(REMOTE_CONTROL.part)
  await exitsToTheTerminal(REMOTE_CONTROL, 'with nothing at risk the exit gesture must fire')
}

/** A flow's steps in order, each titled for the behaviour it checks. */
type Steps = Array<[title: string, body: () => Promise<void>]>

const LEAVING_STEPS: Steps = [
  [
    'a single Escape, or two further apart than the gesture window, leave Notes open',
    singleAndSlowEscapesStay,
  ],
  ['two quick Escapes inside Notes return to the terminal', doubleEscapeReturnsToTerminal],
  ...DRAFT_SURFACES.map((surface): Steps[number] => [
    `${surface.label}: two Escapes with a draft in a text field keep it open${surface.inline ? ', the draft intact' : ''}`,
    () => draftKeepsItOpen(surface),
  ]),
  [
    'two Escapes while a dialog, or nested dialogs, are open do not exit Foundry',
    openDialogsHoldTheKey,
  ],
  [
    'the exit gesture still works once nothing has claimed the key',
    gestureWorksOnceNothingClaimsTheKey,
  ],
  [
    'Remote Control: two Escapes still leave, because nothing is at risk',
    remoteControlLeavesOnTwoEscapes,
  ],
]

test('an extension is left with two quick Escapes, and only when nothing is at risk', async () => {
  for (const [title, body] of LEAVING_STEPS) await test.step(title, body)
})

// ── Working an extension from the keyboard ───────────────────────────────────

/** Run in a view: whether focus is inside its open dialog. */
const FOCUS_IN_SURFACE = `(() => {
  const s = document.querySelector('dialog[open]')
  return !!s && s.contains(document.activeElement)
})()`

/** Opens Notes' composer, then uses no mouse on it. */
async function openNotesComposer(): Promise<void> {
  await showPanel(NOTES)
  await expect
    .poll(() =>
      inView<boolean>(
        NOTES.part,
        `(() => {
          const b = [...document.querySelectorAll('button')].find((x) => /new note/i.test(x.textContent || ''))
          if (b) b.click()
          return !!b
        })()`
      )
    )
    .toBe(true)
  await expect
    .poll(() => inView<boolean>(NOTES.part, `!!document.querySelector('dialog[open]')`), {
      message: 'the composer never opened',
    })
    .toBe(true)
}

async function dialogTrapsFocusAndClosesOnEscape(): Promise<void> {
  await openNotesComposer()
  await expect
    .poll(() => inView<boolean>(NOTES.part, FOCUS_IN_SURFACE), {
      message: 'focus moves into the dialog',
    })
    .toBe(true)
  for (let i = 0; i < 8; i++) await key(NOTES.part, 'Tab')
  await expect
    .poll(() => inView<boolean>(NOTES.part, FOCUS_IN_SURFACE), {
      message: 'Tab never leaves the dialog',
    })
    .toBe(true)
  await key(NOTES.part, 'Escape')
  await expect
    .poll(() => inView<boolean>(NOTES.part, `!document.querySelector('dialog[open]')`))
    .toBe(true)
  await stillShowing(NOTES, 'closing a dialog must not close the extension')
}

/** Run in a view: the focusable controls, of the first 40, that show no focus ring. */
const CONTROLS_WITHOUT_RING = `(() => {
  const bad = []
  const controls = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
  for (const el of controls.slice(0, 40)) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    el.focus()
    if (document.activeElement !== el) continue
    const cs = getComputedStyle(el)
    const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none'
    if (!ring) bad.push((el.className || el.tagName).toString().split(' ')[0])
  }
  return bad
})()`

async function everyControlShowsAFocusRing(): Promise<void> {
  await showPanel(NOTES)
  const missing = await inView<string[]>(NOTES.part, CONTROLS_WITHOUT_RING)
  expect(missing, `controls with no visible focus indicator: ${missing.join(', ')}`).toHaveLength(0)
}

/** The frame's box, which a modal drawn over it must leave alone. */
function taskVaultFrameBox() {
  return handle.page.locator(`[data-extension-panel="${TASK_VAULT.id}"] iframe`).boundingBox()
}

/** ADR 114: the view is a frame in the window, so a modal draws over it instead of hiding it. */
async function quickActionsDrawsOverTheFrame(): Promise<void> {
  const { page } = handle
  await showPanel(TASK_VAULT)
  const frameBox = await taskVaultFrameBox()
  expect(frameBox, 'the Task Vault iframe has no box').not.toBeNull()
  await page.keyboard.press('ControlOrMeta+p')
  const dialog = page.getByRole('dialog', { name: 'Quick actions' })
  await expect(dialog).toBeVisible()
  await expectCentredInWindow(dialog, 'Quick actions over Task Vault')
  await expect
    .poll(() => taskVaultFrameBox(), { message: 'the frame was resized or hidden for the modal' })
    .toEqual(frameBox)
  const hit = await page.evaluate(() => {
    const el = document.querySelector('dialog[open]')
    const r = el?.getBoundingClientRect()
    const atCentre = r && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!atCentre && el!.contains(atCentre)
  })
  expect(hit, 'something else paints over Quick Actions').toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.locator(`[data-extension-panel="${TASK_VAULT.id}"] iframe`)).toBeVisible()
}

const KEYBOARD_STEPS: Steps = [
  [
    'a dialog puts focus inside itself, keeps Tab there, and closes on Escape',
    dialogTrapsFocusAndClosesOnEscape,
  ],
  ['every focusable control in an extension view shows a focus ring', everyControlShowsAFocusRing],
  [
    'Quick Actions draws over the extension frame, centred, and the frame stays up',
    quickActionsDrawsOverTheFrame,
  ],
]

test('an extension is worked from the keyboard, with Quick Actions drawn over it', async () => {
  for (const [title, body] of KEYBOARD_STEPS) await test.step(title, body)
})
