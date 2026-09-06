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
  phase: string
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

/** How a phase of work stopped being live. */
export type RunOutcome = 'approved' | 'stopped' | 'discarded' | 'ended'

/**
 * A phase of work that is over, kept so it can be looked back at.
 *
 * The run list used to be the only record there was, which forced it to be
 * both: it stacked every finished run forever so nothing would be lost, and
 * "what is happening right now" became unreadable by the third card. Splitting
 * them lets the list answer its own question and gives the answer to "what did
 * this card actually do" somewhere to live.
 */
export interface RunHistoryEntry {
  readonly sessionId: string
  readonly featureDir: string
  readonly phase: string
  readonly branch: string
  readonly outcome: RunOutcome
  readonly startedAt: number
  readonly endedAt: number
  readonly turns: number
  readonly diff: DiffSummary
  /** How many tool calls it was asked about, which is how noisy it was. */
  readonly asked: number
}

/** Enough to look back over a working day; bounded because it is in memory. */
const HISTORY_LIMIT = 200

export interface RunRegistry {
  add(run: Omit<Run, 'state' | 'stateSince' | 'turns' | 'diff' | 'asked'>): Run
  /**
   * This phase of the run is over: record it and take it out of the live list.
   *
   * Not `forget`. The session may well continue — a card keeps one conversation
   * across all its phases — so the record stays and only its state changes;
   * `notePhase` brings it back to `working` when the next phase starts.
   */
  archive(sessionId: string, outcome: RunOutcome, at: number): RunHistoryEntry | null
  /** What is over, newest first. */
  history(): RunHistoryEntry[]
  get(sessionId: string): Run | null
  list(): Run[]
  /** Everything still consuming time — what "3 running" counts. */
  live(): Run[]
  /** Finished with changes nobody has looked at yet. */
  awaitingReview(): Run[]
  setState(sessionId: string, state: RunState, at: number): void
  /**
   * The card has moved on to the next phase in the same conversation.
   *
   * Without it the run list keeps naming the phase the session opened with, so
   * a card three phases in still reads `specify` — and `stateSince`, which is
   * how the stall detector and the panel both measure "how long like this",
   * would still be counting from the first phase's start.
   */
  notePhase(sessionId: string, phase: string, at: number): void
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
  const past: RunHistoryEntry[] = []

  return {
    archive(sessionId, outcome, at): RunHistoryEntry | null {
      const run = runs.get(sessionId)
      if (run === undefined) return null
      const entry: RunHistoryEntry = {
        sessionId: run.sessionId,
        featureDir: run.featureDir,
        phase: run.phase,
        branch: run.branch,
        outcome,
        startedAt: run.stateSince,
        endedAt: at,
        turns: run.turns,
        diff: { ...run.diff },
        asked: run.asked,
      }
      // Newest first, matching how it is read: the last thing that happened is
      // the thing you are looking for.
      past.unshift(entry)
      if (past.length > HISTORY_LIMIT) past.length = HISTORY_LIMIT
      run.state = 'finished'
      run.stateSince = at
      return entry
    },

    history(): RunHistoryEntry[] {
      return [...past]
    },

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

    notePhase(sessionId, phase, at): void {
      const run = runs.get(sessionId)
      if (run === undefined || run.phase === phase) return
      run.phase = phase
      run.state = 'working'
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
