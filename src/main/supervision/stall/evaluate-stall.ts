import type { RuntimeState } from '../../../shared/types/supervision.js'

// The stall detector. A pure function of (facts, thresholds, now) — no clock,
// no I/O, no mutation (Constitution XI). That is what makes every threshold
// case a table row rather than a timer, and it is why the exemption below can
// be proven rather than hoped for.

export interface StallThresholds {
  /** Silence before a stall fires. */
  readonly silenceMs: number
  /** No net change before the loop signal can fire. */
  readonly noProgressMs: number
  /** Reverts within the recent-edit window that constitute thrashing. */
  readonly revertThreshold: number
}

export const DEFAULT_THRESHOLDS: StallThresholds = {
  silenceMs: 8 * 60_000,
  noProgressMs: 15 * 60_000,
  revertThreshold: 2,
}

export interface SessionFacts {
  readonly sessionId: string
  readonly runtimeState: RuntimeState
  readonly lastToolActivityAt: number | null
  readonly lastNetChangeAt: number | null
  /** When the in-flight shell command started, or null if none is running. */
  readonly openShellStartedAt: number | null
  /** Files touched by the recent tool-call window. */
  readonly recentToolPaths: readonly string[]
  /** Net lines changed across that window. */
  readonly recentNetChange: number
  /** Self-reverts within the recent-edit window. */
  readonly recentReverts: number
}

export type StallSignal = 'silence' | 'loop' | 'revert'

export interface StallFiring {
  readonly sessionId: string
  readonly signal: StallSignal
  readonly firedAt: number
  /** The values that satisfied the condition, so a firing can be re-judged later (FR-017). */
  readonly inputs: {
    readonly toolSilenceMs: number
    readonly diffSilenceMs: number
    readonly distinctFiles: number
    readonly netChange: number
    readonly reverts: number
    readonly shellInFlight: boolean
  }
}

/** Only a session actively doing work can be stuck. */
const CAN_STALL: ReadonlySet<RuntimeState> = new Set<RuntimeState>(['working'])

export function evaluateStall(
  facts: SessionFacts,
  thresholds: StallThresholds,
  now: number
): StallFiring | null {
  // `needs_input` is blocked on the operator, not stuck. The terminal states
  // are finished. `stalled` has already fired.
  if (!CAN_STALL.has(facts.runtimeState)) return null

  const shellInFlight = facts.openShellStartedAt !== null
  const toolSilenceMs = now - (facts.lastToolActivityAt ?? 0)
  const diffSilenceMs = now - (facts.lastNetChangeAt ?? 0)
  const distinctFiles = new Set(facts.recentToolPaths).size

  const inputs = {
    toolSilenceMs,
    diffSilenceMs,
    distinctFiles,
    netChange: facts.recentNetChange,
    reverts: facts.recentReverts,
    shellInFlight,
  }

  const fire = (signal: StallSignal): StallFiring => ({
    sessionId: facts.sessionId,
    signal,
    firedAt: now,
    inputs,
  })

  // Most specific diagnosis first: thrashing on its own edits is a distinct
  // failure from simply going quiet, and more useful to report.
  if (facts.recentReverts >= thresholds.revertThreshold) return fire('revert')

  // Looping on one file with nothing to show for it. Deliberately still
  // evaluated while a command is in flight — a loop is a different failure
  // from silence, and the command being slow does not excuse it.
  if (
    diffSilenceMs > thresholds.noProgressMs &&
    distinctFiles === 1 &&
    facts.recentNetChange === 0
  ) {
    return fire('loop')
  }

  // The exemption. A session blocked inside one long command it started is
  // working, not stuck: its silence is the command's, not the agent's. Without
  // this, every test suite longer than the threshold reads as a stall — the
  // spec's named "obvious first bug", and the gate on shipping this at all.
  if (shellInFlight) return null

  if (toolSilenceMs > thresholds.silenceMs) return fire('silence')

  return null
}
