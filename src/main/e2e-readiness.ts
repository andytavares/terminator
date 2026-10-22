import type { BrowserWindow } from 'electron'

// A test-only channel: with TERMINATOR_E2E=1 the main process announces that a window has
// drawn its first frame, that it has Chromium focus, and that an extension view is connected, so
// an e2e test waits on the app's own word instead of a sleep or a screenshot (ADR 123).
// Unset, every function here does nothing.

export type Announcement = 'drawn' | 'focused' | 'ready'

interface Pending {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

const pending = new Map<string, Pending>()

function enabled(): boolean {
  return process.env.TERMINATOR_E2E === '1'
}

function pendingFor(kind: Announcement, subject: string): Pending {
  const key = `${kind}:${subject}`
  const existing = pending.get(key)
  if (existing) return existing
  let resolve = (): void => {}
  let reject = (_error: unknown): void => {}
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  // A failure nobody has waited for yet is not unhandled: the wait that comes reads it.
  promise.catch(() => {})
  const created = { promise, resolve, reject }
  pending.set(key, created)
  return created
}

/** Records that `subject` reached `kind`; a wait that began earlier or begins later is answered. */
export function announce(kind: Announcement, subject: string): void {
  if (enabled()) pendingFor(kind, subject).resolve()
}

/** Resolves once `subject` has reached `kind`; rejects outside an e2e run, where nothing announces. */
export function whenAnnounced(kind: Announcement, subject: string): Promise<void> {
  if (!enabled()) return Promise.reject(new Error('TERMINATOR_E2E is not set: nothing announces'))
  return pendingFor(kind, subject).promise
}

/** Forgets every announcement, for a spec that needs a clean slate. */
export function resetAnnouncements(): void {
  pending.clear()
}

/** Gives the window Chromium focus whatever the OS says, so no test depends on the active application.
 * https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled */
async function emulateFocus(window: BrowserWindow): Promise<void> {
  const session = window.webContents.debugger
  if (!session.isAttached()) session.attach('1.3')
  await session.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
}

/** Announces `drawn` at the window's first frame and `focused` once focus emulation is on. */
export function announceWindowReadiness(window: BrowserWindow): void {
  if (!enabled()) return
  const subject = String(window.id)
  window.once('ready-to-show', () => announce('drawn', subject))
  // A failure fails the wait for focus with its reason, rather than leaving it to hang.
  emulateFocus(window).then(
    () => announce('focused', subject),
    (error: unknown) => pendingFor('focused', subject).reject(error)
  )
}

/** Lets a test's `app.evaluate` wait on an announcement from the main process. */
export function exposeReadinessToTests(): void {
  if (enabled()) Object.assign(globalThis, { __terminatorE2E: { whenAnnounced } })
}
