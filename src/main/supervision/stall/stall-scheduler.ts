import {
  evaluateStall,
  DEFAULT_THRESHOLDS,
  type SessionFacts,
  type StallFiring,
} from './evaluate-stall.js'
import type { SupervisedSession } from '../../../shared/types/supervision.js'

// Drives the detector on a fixed tick (FR-011). All the judgement lives in
// evaluateStall, which is pure; this only decides when to ask and what to ask
// about.

export const TICK_MS = 30_000

export interface SchedulerThresholds {
  silenceMs: number
  noProgressMs: number
}

export interface StallSchedulerOptions {
  listSessions: () => readonly SupervisedSession[]
  /** Per-repository overrides, falling back to defaults (FR-016). */
  thresholdsFor: (repoPath: string) => SchedulerThresholds
  onFiring: (firing: StallFiring) => void
  now: () => number
}

export interface StallScheduler {
  start(): void
  stop(): void
  /** Runs one evaluation pass. Exposed so a tick can be forced in a test. */
  tick(): void
}

function toFacts(session: SupervisedSession, now: number): SessionFacts {
  return {
    sessionId: session.id,
    runtimeState: session.runtimeState,
    lastToolActivityAt: session.lastToolActivityAt,
    lastNetChangeAt: session.lastNetChangeAt,
    // The registry tracks only whether a shell call is open, not when it began.
    // Treating "open" as "started now" is enough: the exemption is a boolean —
    // a command in flight is never silence, however long it has run.
    openShellStartedAt: session.openShellCallId === null ? null : now,
    // Recent-window facts come from the transcript once the tailer is wired in;
    // until then the loop and revert signals stay inert rather than guessing.
    recentToolPaths: [],
    recentNetChange: 1,
    recentReverts: 0,
  }
}

export function createStallScheduler(options: StallSchedulerOptions): StallScheduler {
  const { listSessions, thresholdsFor, onFiring, now } = options
  let timer: ReturnType<typeof setInterval> | null = null

  function tick(): void {
    const at = now()
    for (const session of listSessions()) {
      const repoThresholds = thresholdsFor(session.repoPath)
      const firing = evaluateStall(
        toFacts(session, at),
        { ...DEFAULT_THRESHOLDS, ...repoThresholds },
        at
      )
      if (firing === null) continue
      try {
        onFiring(firing)
      } catch {
        // One session's handler failing must not stop the others being
        // evaluated, or a single bad session would silence the whole detector.
      }
    }
  }

  return {
    start(): void {
      // Idempotent: starting twice must not double the tick rate.
      if (timer !== null) return
      timer = setInterval(tick, TICK_MS)
    },

    stop(): void {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },

    tick,
  }
}
