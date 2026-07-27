import type { SessionState } from './state-machine.js'

// FR-006. Two sources observe the same session: the driver, which holds live
// callbacks, and the transcript tailer, which reads the agent's own durable
// record. They can disagree — the driver process can die or lag, and the
// transcript survives it. The transcript wins on anything it can observe.

function later(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

export function reconcile(driver: SessionState, transcript: SessionState | null): SessionState {
  if (transcript === null) return driver

  return {
    ...driver,
    // The durable record is authoritative for what the agent actually did.
    runtimeState: transcript.runtimeState,
    stateSince: transcript.stateSince,
    lastToolActivityAt: later(driver.lastToolActivityAt, transcript.lastToolActivityAt),
    lastNetChangeAt: later(driver.lastNetChangeAt, transcript.lastNetChangeAt),
    // Both only ever grow, so the larger value is the more current one
    // regardless of which source saw it.
    turns: Math.max(driver.turns, transcript.turns),
    costUsd: Math.max(driver.costUsd, transcript.costUsd),
    transcriptPath: transcript.transcriptPath ?? driver.transcriptPath,

    // A permission request is a live callback the driver holds; it is never
    // written to the transcript, so the driver stays authoritative for it —
    // and for the state that request implies.
    ...(driver.pendingPermission !== null
      ? {
          pendingPermission: driver.pendingPermission,
          runtimeState: driver.runtimeState,
          stateSince: driver.stateSince,
        }
      : {}),
  }
}
