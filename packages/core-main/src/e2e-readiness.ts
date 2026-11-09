import type { BrowserWindow } from 'electron'

// Test-only: with TERMINATOR_E2E=1, main announces a window's first frame, its Chromium focus and
// each connected extension view, so e2e waits on the app's word, not a sleep (ADR 123). Unset,
// nothing here does anything.

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

/** Resolves once `subject` has reached `kind`; rejects outside an e2e run, where nothing announces.
 * The app hands it to e2e through the test-only global; specs import it.
 * @internal */
export function whenAnnounced(kind: Announcement, subject: string): Promise<void> {
  if (!enabled()) return Promise.reject(new Error('TERMINATOR_E2E is not set: nothing announces'))
  return pendingFor(kind, subject).promise
}

const FOCUS_EMULATION_ANSWER_MS = 30_000

/** Gives the window Chromium focus whatever the OS says, so no test depends on the active application.
 * https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled */
async function emulateFocus(window: BrowserWindow): Promise<void> {
  const session = window.webContents.debugger
  if (!session.isAttached()) session.attach('1.3')
  let timer: NodeJS.Timeout | undefined
  const unanswered = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const seconds = FOCUS_EMULATION_ANSWER_MS / 1000
      reject(new Error(`Emulation.setFocusEmulationEnabled did not answer in ${seconds} s`))
    }, FOCUS_EMULATION_ANSWER_MS)
  })
  try {
    await Promise.race([
      session.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }),
      unanswered,
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Announces `drawn` at the window's first frame and `focused` once focus emulation is on. */
export function announceWindowReadiness(window: BrowserWindow): void {
  if (!enabled()) return
  const subject = String(window.id)
  window.once('ready-to-show', () => announce('drawn', subject))
  // A command sent before the page's navigation can go unanswered (Electron's debugger.sendCommand
  // docs), so emulation starts once the page has loaded. A failure fails the wait with its reason.
  window.webContents.once('did-finish-load', () => {
    emulateFocus(window).then(
      () => announce('focused', subject),
      (error: unknown) => pendingFor('focused', subject).reject(error)
    )
  })
}

/** Lets a test's `app.evaluate` wait on an announcement from the main process. */
export function exposeReadinessToTests(): void {
  if (enabled()) Object.assign(globalThis, { __terminatorE2E: { whenAnnounced } })
}
