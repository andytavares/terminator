import { test, expect, type Frame } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'
import { extensionFrame, findExtensionFrame } from './extension-page'
import { expectCentredInWindow } from './modal-centre'

// Working an extension from the keyboard (feature 036, ADR 114). The double-Escape exit and its
// guards are unit tests: packages/core-shared/tests/unit/extension-frame/frame-shim.spec.ts and
// packages/core-shared/tests/unit/shared/double-escape.spec.ts.

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
const TASK_VAULT: Surface = { id: 'terminator.task-vault', label: 'Task Vault', part: 'task-vault' }
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

/** The extension's frame, once its document owns the keyboard: a key pressed before then
 * lands on the host page, where the frame's listeners never see it. */
async function focusedFrame(part: string): Promise<Frame> {
  const frame = await findExtensionFrame(handle, part)
  await frame.evaluate(() => window.focus())
  await expect.poll(() => frame.evaluate(() => document.hasFocus())).toBe(true)
  return frame
}

/** What the frame shim decided for the last Escape it read: 'pending', 'exit' or 'suppressed'. */
function escapeDecision(frame: Frame): Promise<string | null> {
  return frame.evaluate(() => document.documentElement.getAttribute('data-escape-gesture'))
}

/** Sends a key into an extension's frame as a real key press. */
async function key(part: string, keyCode: string): Promise<void> {
  await focusedFrame(part)
  await handle.page.keyboard.press(keyCode)
}

/** Presses Escape in an extension's frame, and waits until the frame shim has decided on it. */
async function pressEscape(part: string): Promise<void> {
  const frame = await focusedFrame(part)
  await frame.evaluate(() => document.documentElement.removeAttribute('data-escape-gesture'))
  await handle.page.keyboard.press('Escape')
  await expect.poll(() => escapeDecision(frame)).not.toBeNull()
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

/** The last key asked for no exit, so the panel that shows now stays. */
async function stillShowing(surface: Surface, why: string): Promise<void> {
  const frame = await findExtensionFrame(handle, surface.part)
  expect(await escapeDecision(frame), why).not.toBe('exit')
  expect(await activeExtensionPanel(), why).toBe(surface.id)
}

/** A flow's steps in order, each titled for the behaviour it checks. */
type Steps = Array<[title: string, body: () => Promise<void>]>
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
  await pressEscape(NOTES.part)
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
