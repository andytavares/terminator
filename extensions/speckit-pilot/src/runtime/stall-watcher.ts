import { readTranscript, type ToolActivity } from './transcript-tailer.js'
import {
  evaluateStall,
  DEFAULT_THRESHOLDS,
  type SessionFacts,
  type StallFiring,
  type StallThresholds,
} from './evaluate-stall.js'

// Noticing a run that has stopped making progress without asking for anything.
//
// This is the failure nobody instruments. A run that is blocked tells you: it
// raises a permission request and the board lights up. A run that is looping on
// one file, reverting its own edits, or has simply gone quiet tells you nothing
// at all — it looks exactly like a run that is working, until you check on it an
// hour later.
//
// Facts come from the transcript, which is the agent's own record: it survives
// the console restarting, and it is written whether or not anything is watching.

export interface WatchedRun {
  readonly sessionId: string
  readonly featureDir: string
  readonly transcriptPath: string
  /** When the run began, so a run that has done nothing yet is measured from it. */
  readonly startedAt: number
  /** False while a run is waiting on a person — blocked is not stuck. */
  isWaiting: boolean
}

export interface StallWatcherOptions {
  /** The runs to look at. Read each tick, so a run that ends drops out. */
  runs: () => readonly WatchedRun[]
  /** Fired when one is judged stuck. Shadow mode is the caller's decision. */
  onFiring: (firing: StallFiring, featureDir: string) => void
  thresholds?: StallThresholds
  now?: () => number
  /** How often to look. Every thirty seconds, matching the spec. */
  intervalMs?: number
}

export interface StallWatcher {
  start(): void
  stop(): void
  /** One pass. Exposed so a tick can be forced rather than waited for. */
  tick(): void
}

/**
 * What the transcript says about a run, as the detector needs it.
 *
 * A shell call still in flight is the load-bearing fact here: without it every
 * test suite longer than the threshold reads as a stall, which the spec calls
 * the obvious first bug and makes the gate on shipping this at all.
 */
export function factsFrom(run: WatchedRun, activity: readonly ToolActivity[]): SessionFacts {
  const open = new Set<string>()
  let lastToolActivityAt: number | null = null
  let openShellStartedAt: number | null = null

  for (const event of activity) {
    lastToolActivityAt = event.at
    if (event.kind === 'tool_started') {
      if (event.isShell) {
        open.add(event.callId)
        openShellStartedAt = event.at
      }
    } else if (open.delete(event.callId) && open.size === 0) {
      openShellStartedAt = null
    }
  }

  return {
    sessionId: run.sessionId,
    // Waiting on a person is blocked, not stuck.
    canStall: !run.isWaiting,
    stateSince: run.startedAt,
    lastToolActivityAt,
    // The transcript records tool calls, not diffs. Until the watcher reads a
    // working copy the no-progress signal has nothing to go on, so it is left
    // inert rather than fed a zero that would make it fire on every run.
    lastNetChangeAt: lastToolActivityAt,
    openShellStartedAt,
    recentToolPaths: [],
    recentNetChange: 1,
    recentReverts: 0,
  }
}

export function createStallWatcher(options: StallWatcherOptions): StallWatcher {
  const now = options.now ?? Date.now
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS
  const intervalMs = options.intervalMs ?? 30_000
  let timer: ReturnType<typeof setInterval> | null = null

  // One firing per run. A detector that reports the same stall every thirty
  // seconds is a detector you mute, and muting it loses the next real one.
  const fired = new Set<string>()

  return {
    start(): void {
      if (timer !== null) return
      timer = setInterval(() => this.tick(), intervalMs)
      timer.unref?.()
    },

    stop(): void {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },

    tick(): void {
      const live = options.runs()
      // A run that has ended can stall again if it is started again.
      for (const sessionId of [...fired]) {
        if (!live.some((run) => run.sessionId === sessionId)) fired.delete(sessionId)
      }

      for (const run of live) {
        if (fired.has(run.sessionId)) continue
        const facts = factsFrom(run, readTranscript(run.transcriptPath))
        const firing = evaluateStall(facts, thresholds, now())
        if (firing === null) continue
        fired.add(run.sessionId)
        options.onFiring(firing, run.featureDir)
      }
    },
  }
}
