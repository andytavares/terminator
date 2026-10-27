import type { ToolActivity } from './transcript-tailer.js'
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
// Facts come from the ACP tool-call updates the runner keeps for each run, in memory:
// no file is read, and a run the console did not start is not watched.

export interface WatchedRun {
  readonly sessionId: string
  readonly featureDir: string
  /** The run's tool starts and finishes so far, from its ACP updates. */
  readonly activity: readonly ToolActivity[]
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
  /**
   * Everything a tick saw of a run's tool calls, fired or not.
   *
   * The watcher is the one thing already looking at every live run on a clock,
   * so the Factory view's recording rides on it.
   */
  onActivity?: (run: WatchedRun, activity: readonly ToolActivity[]) => void
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

/** How many tool calls count as "recent" for the loop signal. */
const RECENT_WINDOW = 8

/**
 * What a run's tool calls say about it, as the detector needs it.
 *
 * A shell call still in flight is the load-bearing fact here: without it every
 * test suite longer than the threshold reads as a stall, which the spec calls
 * the obvious first bug and makes the gate on shipping this at all.
 * @internal
 */
export function factsFrom(run: WatchedRun, activity: readonly ToolActivity[]): SessionFacts {
  const { lastToolActivityAt, openShellStartedAt } = shellActivity(activity)
  return {
    sessionId: run.sessionId,
    // Waiting on a person is blocked, not stuck.
    canStall: !run.isWaiting,
    stateSince: run.startedAt,
    lastToolActivityAt,
    // Not measured: the diff is read once per turn (supervision.ts `finishTurn`), never
    // while one runs, so "no net change" cannot be told from "not looked at yet".
    lastNetChangeAt: null,
    openShellStartedAt,
    // The files the recent window touched.
    recentToolPaths: activity
      .filter((event) => event.kind === 'tool_started' && event.path !== null)
      .slice(-RECENT_WINDOW)
      .map((event) => event.path as string),
    // Reported as growth, which keeps the loop signal quiet until the diff is measured.
    recentNetChange: 1,
  }
}

/** When a tool was last used, and since when a shell call has been open, if one is. */
function shellActivity(activity: readonly ToolActivity[]): {
  lastToolActivityAt: number | null
  openShellStartedAt: number | null
} {
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
  return { lastToolActivityAt, openShellStartedAt }
}

export function createStallWatcher(options: StallWatcherOptions): StallWatcher {
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

    tick: () => checkRunsOnce(options, fired),
  }
}

/** A run that has ended can stall again if it is started again. */
function forgetEnded(fired: Set<string>, live: readonly WatchedRun[]): void {
  for (const sessionId of [...fired]) {
    if (!live.some((run) => run.sessionId === sessionId)) fired.delete(sessionId)
  }
}

/** One pass over the live runs, firing once for each that has newly stalled. */
function checkRunsOnce(options: StallWatcherOptions, fired: Set<string>): void {
  const live = options.runs()
  forgetEnded(fired, live)

  const now = options.now ?? Date.now
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS
  for (const run of live) {
    options.onActivity?.(run, run.activity)
    if (fired.has(run.sessionId)) continue
    const facts = factsFrom(run, run.activity)
    const firing = evaluateStall(facts, thresholds, now())
    if (firing === null) continue
    fired.add(run.sessionId)
    options.onFiring(firing, run.featureDir)
  }
}
