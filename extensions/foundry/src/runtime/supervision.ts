import * as path from 'node:path'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import {
  createRunRegistry,
  type Run,
  type RunHistoryEntry,
  type RunRegistry,
} from './run-registry.js'
import { createReviewQueue, type ReviewQueue } from './review/review-queue.js'
import { createBackpressureGate, type BackpressureGate } from './review/backpressure.js'
import { createFeedLog, type FeedLog } from './feed/feed-log.js'
import { readDiffSummary, readChangedFiles, type RunCommand } from './diff-metrics.js'
import type { CheckState } from './review/risk-grader.js'
import { gradeInWords } from './review/risk-grader.js'

// The supervision layer: what is running, what it changed, what needs looking
// at, and what must not start yet.
//
// Assembled here rather than in the extension's entry point so it can be built
// without an Electron host and exercised as one thing — the closed branch's
// worst bugs were all in wiring that each unit tested fine on its own.

export interface Supervision {
  readonly runs: RunRegistry
  readonly review: ReviewQueue
  readonly backpressure: BackpressureGate
  readonly feed: FeedLog
  /**
   * Reads what a run's working copy has changed and records it.
   *
   * Nothing reported this in the closed branch, so the diff stayed at zero for
   * a run's whole life — which made `ready` unreachable, the review queue
   * permanently empty, and the gate below a thing that counted nothing.
   */
  measure(sessionId: string): Promise<void>
  /**
   * A run has finished a turn. With changes, that is something to review: in a
   * terminal the agent does not exit when it is done, it sits at its prompt, so
   * waiting for the conversation to end would mean work was never offered.
   */
  finishTurn(sessionId: string, turns: number, at: number): Promise<void>
  /** The run ended for good. */
  finish(sessionId: string, at: number): void
  /** Everything a surface needs in one read. */
  snapshot(): {
    runs: Run[]
    review: ReturnType<ReviewQueue['list']>
    backpressure: ReturnType<BackpressureGate['check']>
    /** What is over, so the live list does not have to be the record too. */
    history: RunHistoryEntry[]
  }
}

export interface SupervisionOptions {
  api: ExtensionAPI
  stateDir: string
  /** Injected so the whole layer can be exercised without a repository. */
  run?: RunCommand
  /** How many unreviewed diffs before a new run is refused. */
  reviewLimit?: number
  /** The branch a card's work is measured against. */
  baseBranch?: string
}

/**
 * Three unreviewed diffs.
 *
 * The constraint is one person's capacity to review, which does not scale with
 * the number of cards. Starting a fourth agent while three diffs are waiting is
 * how a backlog nobody can review gets built.
 */
const DEFAULT_REVIEW_LIMIT = 3

export function createSupervision(options: SupervisionOptions): Supervision {
  const { api, stateDir } = options
  // Whatever the card was actually branched from. Measuring against a fixed
  // `main` reported the difference between two branches rather than the work
  // this run did, which then graded the risk and filled the review queue.
  const baseBranch = options.baseBranch ?? 'main'
  const runCommand: RunCommand =
    options.run ??
    (async (command, args, cwd) => {
      const result = await api.shell.exec({ command: command as 'git', args, cwd })
      return { ok: result.exitCode === 0, stdout: result.stdout }
    })

  const runs = createRunRegistry()
  const review = createReviewQueue()
  const feed = createFeedLog(path.join(stateDir, 'feed.jsonl'))

  const backpressure = createBackpressureGate({
    limit: options.reviewLimit ?? DEFAULT_REVIEW_LIMIT,
    // Counted across every card: the limit is the operator's attention, and
    // that does not partition by card.
    countUnreviewed: () => review.count(),
    overrideLogPath: path.join(stateDir, 'backpressure-overrides.jsonl'),
  })

  async function measure(sessionId: string): Promise<void> {
    const run = runs.get(sessionId)
    if (run === null || run.worktreePath === '') return
    runs.noteDiff(
      sessionId,
      await readDiffSummary(run.worktreePath, run.baseBranch ?? baseBranch, runCommand)
    )
  }

  return {
    runs,
    review,
    backpressure,
    feed,
    measure,

    async finishTurn(sessionId, turns, at): Promise<void> {
      const run = runs.get(sessionId)
      if (run === null) return
      runs.noteTurns(sessionId, turns)
      await measure(sessionId)

      const changed = runs.get(sessionId)?.diff ?? { files: 0, added: 0, removed: 0 }
      if (changed.files === 0) {
        // Nothing to look at, and nothing is over: in a terminal the session
        // stays open and the next turn may well change something. Calling it
        // `finished` retired a run that was still going, and took it off every
        // surface that reads live runs.
        runs.setState(sessionId, 'waiting', at)
        return
      }

      runs.setState(sessionId, 'ready', at)

      // Without the file list the grader cannot see auth, payments, migrations
      // or a critical path, so everything would grade as ordinary work.
      const files = await readChangedFiles(
        run.worktreePath,
        run.baseBranch ?? baseBranch,
        runCommand
      )
      const queued = review.enqueue({
        sessionId,
        repoPath: run.worktreePath,
        branch: run.branch,
        diffSummary: changed,
        change: {
          files,
          linesChanged: changed.added + changed.removed,
          // The extension does not poll a code host, so checks are unknown
          // rather than assumed to be passing — assuming passing would let a
          // change auto-merge on evidence nobody has.
          checkState: 'unavailable' as CheckState,
          sharedContractFiles: [],
          criticalPaths: [],
        },
        queuedAt: at,
      })

      feed.post({
        at,
        sessionId,
        author: 'agent',
        summary:
          queued === null
            ? `finished a turn in ${path.basename(run.featureDir)}`
            : `${path.basename(run.featureDir)} is ready to review — ${gradeInWords(queued.grade)}, ${changed.files} file${changed.files === 1 ? '' : 's'} +${changed.added} −${changed.removed}`,
      })
    },

    finish(sessionId, at): void {
      const run = runs.get(sessionId)
      if (run === null) return
      // Left on the register rather than removed: a finished run with a diff is
      // exactly what the review queue is about, and forgetting it here would
      // empty the queue the moment the agent exited.
      runs.setState(sessionId, run.diff.files > 0 ? 'ready' : 'finished', at)
    },

    snapshot() {
      return {
        runs: runs.list(),
        review: review.list(),
        backpressure: backpressure.check(),
        history: runs.history(),
      }
    },
  }
}
