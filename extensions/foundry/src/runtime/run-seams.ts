import type { SupervisedRunner } from './supervised-runner.js'
import type { PendingAsk } from './pending-permissions.js'
import type { PermissionOutcome } from './permission-bridge.js'

// The seams between the extension's wiring and a supervised run.
//
// These were module-level setters inside the phase runner, which is now gone:
// the Line drives the supervised runner directly from its own scheduler, so
// there is no phase dispatcher left to hang them off. They are injected rather
// than imported so nothing down here reaches into the extension's state, and
// so a test can watch them.

let supervised: SupervisedRunner | null = null

/**
 * The supervised path, when one is available.
 *
 * Absent in a build with no window, and in a test. Everything that runs an
 * agent asks for it rather than assuming it, because the alternative — falling
 * back to a hidden process that approves its own tool calls — is the thing
 * this whole design replaced.
 */
export function setSupervisedRunner(runner: SupervisedRunner | null): void {
  supervised = runner
}

export function supervisedRunner(): SupervisedRunner | null {
  return supervised
}

let onPermissionPending: ((ask: PendingAsk) => void) | null = null
let onPermissionResolved: ((requestId: string, decision: PermissionOutcome) => void) | null = null

/** Where a held tool call is put so a surface can show it, and cleared again. */
export function setPermissionSink(
  sink: {
    onPending: (ask: PendingAsk) => void
    onResolved: (requestId: string, decision: PermissionOutcome) => void
  } | null
): void {
  onPermissionPending = sink?.onPending ?? null
  onPermissionResolved = sink?.onResolved ?? null
}

export function notePermissionPending(ask: PendingAsk): void {
  onPermissionPending?.(ask)
}

export function notePermissionResolved(requestId: string, decision: PermissionOutcome): void {
  onPermissionResolved?.(requestId, decision)
}

/**
 * What a run reports back while it works.
 *
 * Structurally the subset of `Supervision` a running agent actually calls, so
 * the seam does not drag the whole review layer in behind it.
 */
export interface RunSupervision {
  measure(sessionId: string): Promise<void>
  finishTurn(sessionId: string, turns: number, at: number): Promise<void>
  finish(sessionId: string, at: number): void
}

let supervision: RunSupervision | null = null

/** What is running, what it changed, and what needs looking at. */
export function setRunSupervision(next: RunSupervision | null): void {
  supervision = next
}

export function runSupervision(): RunSupervision | null {
  return supervision
}

let readOnlyStateDir: string | null = null

/**
 * Where the read-only policy lives on disk.
 *
 * Null when it cannot be written, which callers turn into a refusal rather
 * than a fallback: a check that did not run must not pass.
 */
export function setReadOnlyStateDir(dir: string | null): void {
  readOnlyStateDir = dir
}

export function readOnlyStateDirectory(): string | null {
  return readOnlyStateDir
}
