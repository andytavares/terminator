import type { DiffSummary } from './review/diff-summary.js'

// Every supervised run, and what is true of it right now.
//
// Deliberately keyed by the card's feature directory rather than being a
// session registry of its own. A run belongs to a card; the board, the phases
// and the worktree already identify one that way, and a parallel identity is
// what made the console and this extension two systems instead of one.
//
// Held in memory. A run does not outlive the application: its terminal is a
// child of this process, so a registry reloaded from disk would describe runs
// that no longer exist — which is exactly the "session stuck working forever"
// state the old console kept getting into.

export type RunState =
  | 'working'
  /** Held on a tool call the operator has to decide. */
  | 'waiting'
  /** Stopped making progress without asking for anything. */
  | 'stalled'
  /** Finished, with changes worth looking at. */
  | 'ready'
  /** Finished having changed nothing, or failed outright. */
  | 'finished'

export interface Run {
  readonly sessionId: string
  readonly featureDir: string
  readonly phase: string
  readonly worktreePath: string
  readonly branch: string
  /**
   * What it was cut from, so its diff is the work it did.
   *
   * Measuring every card against a fixed `main` reported the difference
   * between two branches rather than this run's change, which then graded the
   * risk and filled the review queue.
   */
  readonly baseBranch: string | null
  readonly terminalSessionId: string
  readonly transcriptPath: string
  readonly startedAt: number
  state: RunState
  stateSince: number
  turns: number
  diff: DiffSummary
  /** How many tool calls it has been asked about, for the record. */
  asked: number
}

export interface RunRegistry {
  add(run: Omit<Run, 'state' | 'stateSince' | 'turns' | 'diff' | 'asked'>): Run
  get(sessionId: string): Run | null
  list(): Run[]
  /** Everything still consuming time — what "3 running" counts. */
  live(): Run[]
  /** Finished with changes nobody has looked at yet. */
  awaitingReview(): Run[]
  setState(sessionId: string, state: RunState, at: number): void
  noteTurns(sessionId: string, turns: number): void
  noteDiff(sessionId: string, diff: DiffSummary): void
  noteAsked(sessionId: string): void
  /** Takes it off the register — reviewed, discarded, or the card removed. */
  forget(sessionId: string): void
  forgetCard(featureDir: string): void
}

const LIVE: ReadonlySet<RunState> = new Set<RunState>(['working', 'waiting', 'stalled'])

export function createRunRegistry(): RunRegistry {
  const runs = new Map<string, Run>()

  return {
    add(input): Run {
      const run: Run = {
        ...input,
        state: 'working',
        stateSince: input.startedAt,
        turns: 0,
        diff: { files: 0, added: 0, removed: 0 },
        asked: 0,
      }
      runs.set(run.sessionId, run)
      return run
    },

    get(sessionId): Run | null {
      return runs.get(sessionId) ?? null
    },

    list(): Run[] {
      return [...runs.values()]
    },

    live(): Run[] {
      return [...runs.values()].filter((run) => LIVE.has(run.state))
    },

    awaitingReview(): Run[] {
      return [...runs.values()].filter((run) => run.state === 'ready')
    },

    setState(sessionId, state, at): void {
      const run = runs.get(sessionId)
      // Recorded only on a change: `stateSince` is how long it has been like
      // this, and rewriting it every tick would make everything look new.
      if (run === undefined || run.state === state) return
      run.state = state
      run.stateSince = at
    },

    noteTurns(sessionId, turns): void {
      const run = runs.get(sessionId)
      if (run !== undefined) run.turns = turns
    },

    noteDiff(sessionId, diff): void {
      const run = runs.get(sessionId)
      if (run !== undefined) run.diff = diff
    },

    noteAsked(sessionId): void {
      const run = runs.get(sessionId)
      if (run !== undefined) run.asked += 1
    },

    forget(sessionId): void {
      runs.delete(sessionId)
    },

    forgetCard(featureDir): void {
      for (const [sessionId, run] of runs) {
        if (run.featureDir === featureDir) runs.delete(sessionId)
      }
    },
  }
}
