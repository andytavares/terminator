// The stall detector. A pure function of (facts, thresholds, now) — no clock,
// no I/O, no mutation (Constitution XI). That is what makes every threshold
// case a table row rather than a timer, and it is why the exemption below can
// be proven rather than hoped for.

export interface StallThresholds {
  /** Silence before a stall fires. */
  readonly silenceMs: number
  /** No net change before the loop signal can fire. */
  readonly noProgressMs: number
}

export const DEFAULT_THRESHOLDS: StallThresholds = {
  silenceMs: 8 * 60_000,
  noProgressMs: 15 * 60_000,
}

export interface SessionFacts {
  readonly sessionId: string
  /** False once the run has ended, or while it is waiting on a person. */
  readonly canStall: boolean
  /**
   * When this session entered the state it is in. Silence is measured from
   * here when there is nothing else to measure from.
   *
   * Falling back to zero instead measured from 1970, so a session that had not
   * yet made its first tool call was reported as silent for fifty-six years
   * and stalled the instant it started — every time. A detector that fires on
   * every session before it has done anything is one you turn off, and then
   * the real stalls go unreported too.
   */
  readonly stateSince: number
  readonly lastToolActivityAt: number | null
  readonly lastNetChangeAt: number | null
  /** When the in-flight shell command started, or null if none is running. */
  readonly openShellStartedAt: number | null
  /** Files touched by the recent tool-call window. */
  readonly recentToolPaths: readonly string[]
  /** Net lines changed across that window. */
  readonly recentNetChange: number
}

/**
 * `revert` — thrashing on its own edits — was specified and is not here: it
 * needs a per-edit history of the working copy, and nothing records one. It was
 * removed rather than left as a threshold no input could ever cross.
 */
type StallSignal = 'silence' | 'loop'

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
    readonly shellInFlight: boolean
  }
}

export function evaluateStall(
  facts: SessionFacts,
  thresholds: StallThresholds,
  now: number
): StallFiring | null {
  // A run waiting on a person is blocked, not stuck, and one that has ended is
  // finished. Neither is a stall, and reporting them as one is how a detector
  // earns the reputation that gets it turned off.
  if (!facts.canStall) return null

  const inputs = stallInputs(facts, now)
  const fire = (signal: StallSignal): StallFiring => ({
    sessionId: facts.sessionId,
    signal,
    firedAt: now,
    inputs,
  })

  // Looping on one file with nothing to show for it. Deliberately still
  // evaluated while a command is in flight — a loop is a different failure
  // from silence, and the command being slow does not excuse it.
  if (
    inputs.diffSilenceMs > thresholds.noProgressMs &&
    inputs.distinctFiles === 1 &&
    facts.recentNetChange === 0
  ) {
    return fire('loop')
  }

  // The exemption. A session blocked inside one long command it started is
  // working, not stuck: its silence is the command's, not the agent's. Without
  // this, every test suite longer than the threshold reads as a stall — the
  // spec's named "obvious first bug", and the gate on shipping this at all.
  if (inputs.shellInFlight) return null

  if (inputs.toolSilenceMs > thresholds.silenceMs) return fire('silence')

  return null
}

/** The values a firing is judged on, at `now`. */
function stallInputs(facts: SessionFacts, now: number): StallFiring['inputs'] {
  // Silence counts from the later of the last activity and `stateSince`: a session
  // spans turns, and a new turn carried the previous turn's last call, reporting a
  // 23-second-old run silent for 21 minutes (SUPERVISION.md, "Incidents behind the code").
  const since = (at: number | null): number => Math.max(at ?? facts.stateSince, facts.stateSince)
  return {
    toolSilenceMs: now - since(facts.lastToolActivityAt),
    diffSilenceMs: now - since(facts.lastNetChangeAt),
    distinctFiles: new Set(facts.recentToolPaths).size,
    netChange: facts.recentNetChange,
    shellInFlight: facts.openShellStartedAt !== null,
  }
}
