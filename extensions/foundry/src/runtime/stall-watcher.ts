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
  /**
   * How much the run's working copy has grown since the previous tick.
   *
   * Injected because the watcher reads transcripts and nothing else; the
   * supervision layer is what measures diffs. Absent, it reports growth, which
   * keeps the loop signal quiet rather than firing it on every run.
   */
  netChangeSince?: (sessionId: string) => number
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
/** How many tool calls count as "recent" for the loop signal. */
const RECENT_WINDOW = 8

export function factsFrom(
  run: WatchedRun,
  activity: readonly ToolActivity[],
  netChange = 1
): SessionFacts {
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
    lastNetChangeAt: lastToolActivityAt,
    openShellStartedAt,
    // The files the recent window touched. Eight calls against one file, with
    // the working copy no bigger than it was, is the loop signal — and until
    // this was read from the transcript that signal could never fire.
    recentToolPaths: activity
      .filter((event) => event.kind === 'tool_started' && event.path !== null)
      .slice(-RECENT_WINDOW)
      .map((event) => event.path as string),
    // How much the working copy grew since the last look. Supplied by the
    // caller, which is the only thing that measures diffs.
    recentNetChange: netChange,
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
        // Growth since the last look. Without it the loop signal cannot tell
        // "going round in circles" from "working steadily on one file".
        const facts = factsFrom(
          run,
          readTranscript(run.transcriptPath),
          options.netChangeSince?.(run.sessionId) ?? 1
        )
        const firing = evaluateStall(facts, thresholds, now())
        if (firing === null) continue
        fired.add(run.sessionId)
        options.onFiring(firing, run.featureDir)
      }
    },
  }
}
