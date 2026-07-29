import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import { createRunRegistry, type Run, type RunRegistry } from './run-registry.js'
import { createReviewQueue, type ReviewQueue } from './review/review-queue.js'
import { createBackpressureGate, type BackpressureGate } from './review/backpressure.js'
import { createFeedLog, type FeedLog } from './feed/feed-log.js'
import { readDiffSummary, readChangedFiles, type RunCommand } from './diff-metrics.js'
import type { CheckState } from './review/risk-grader.js'
import { parseHunks } from './review/parse-hunks.js'
import { createDecisionSet, type DecisionSet, type HunkDecision } from './review/hunk-decisions.js'
import { reviewIntent, type IntentReview } from './review/intent-diff.js'
import { revertRejected, type ApplyResult } from './review/apply-decisions.js'
import { laneViews, mayMergeLane, type CardLanes } from './lane-coordination.js'

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
  /**
   * The hunks of a run's diff, with whatever has been decided about them.
   *
   * The unit of review is the hunk rather than the file: one file routinely
   * holds both the change you asked for and the one you did not, and accepting
   * a file wholesale is how the second one ships.
   */
  hunksFor(sessionId: string): Promise<DecisionSet | null>
  decideHunk(sessionId: string, hunkId: string, decision: HunkDecision): Promise<boolean>
  /**
   * Makes the rejections real: the rejected hunks come back out of the working
   * copy and the accepted ones stay.
   *
   * Without this the review was decision-only — you rejected a change, the
   * queue recorded it, and every line the agent wrote stayed exactly where it
   * was. A reject that changes nothing is worse than no review, because you
   * believe the change is gone.
   */
  applyDecisions(sessionId: string): Promise<ApplyResult>
  /**
   * The request set against the agent's own account of what it did.
   *
   * The step every diff viewer skips, and the one that catches work that is
   * defensible in isolation and was never asked for.
   */
  intentFor(sessionId: string, request: string, agentAccount: string): Promise<IntentReview | null>
  /**
   * Whether a lane may merge yet, and what it would collide with.
   *
   * A card with one lane costs nothing here: every rule collapses to a no-op,
   * so single-repository work never sees any of this.
   */
  lanes(card: CardLanes): ReturnType<typeof laneViews>
  mayMerge(card: CardLanes, ord: number, merged: readonly number[]): ReturnType<typeof mayMergeLane>
  /** Everything a surface needs in one read. */
  snapshot(): {
    runs: Run[]
    review: ReturnType<ReviewQueue['list']>
    backpressure: ReturnType<BackpressureGate['check']>
  }
}

export interface SupervisionOptions {
  api: ExtensionAPI
  stateDir: string
  /** Injected so the whole layer can be exercised without a repository. */
  run?: RunCommand
  /** Likewise for reverting a rejected hunk, which needs a patch on disk. */
  applyReverse?: (worktreePath: string, patch: string) => Promise<{ ok: boolean; stderr: string }>
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

  /**
   * File paths named in a request.
   *
   * Deliberately conservative: a token has to look like a path with an
   * extension before it counts, because a false expectation reads as "the agent
   * missed something" and that is worse than saying nothing.
   */
  function pathsIn(text: string): string[] {
    const matches = text.match(/[A-Za-z0-9_.@/-]+\.[A-Za-z0-9]{1,6}\b/g) ?? []
    return [...new Set(matches.filter((token) => token.includes('/')))]
  }

  // Built on first read and kept while the run is being reviewed, so decisions
  // survive scrolling away from it.
  const decisions = new Map<string, DecisionSet>()

  /**
   * Hands a patch to git.
   *
   * Via a file, because the host's sandboxed shell has no stdin. Written beside
   * the runtime's other state rather than in the worktree, so a review never
   * shows up as a change of its own.
   */
  const applyReverse =
    options.applyReverse ??
    (async (worktreePath: string, patch: string): Promise<{ ok: boolean; stderr: string }> => {
      const patchPath = path.join(stateDir, `revert-${Date.now()}.patch`)
      try {
        await fs.promises.mkdir(stateDir, { recursive: true })
        await fs.promises.writeFile(patchPath, patch, 'utf8')
        const result = await api.shell.exec({
          command: 'git',
          args: ['apply', '--reverse', '--recount', patchPath],
          cwd: worktreePath,
        })
        return { ok: result.exitCode === 0, stderr: result.stderr }
      } catch (error) {
        return { ok: false, stderr: String(error) }
      } finally {
        await fs.promises.rm(patchPath, { force: true }).catch(() => {})
      }
    })

  async function measure(sessionId: string): Promise<void> {
    const run = runs.get(sessionId)
    if (run === null || run.worktreePath === '') return
    runs.noteDiff(sessionId, await readDiffSummary(run.worktreePath, baseBranch, runCommand))
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
        // Nothing to look at. Still a turn ending, so the run is no longer
        // working, but it does not take a slot in a queue about diffs.
        runs.setState(sessionId, 'finished', at)
        return
      }

      runs.setState(sessionId, 'ready', at)

      // Without the file list the grader cannot see auth, payments, migrations
      // or a critical path, so everything would grade as ordinary work.
      const files = await readChangedFiles(run.worktreePath, baseBranch, runCommand)
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
            : `${path.basename(run.featureDir)} is ready to review — ${queued.grade}, ${changed.files} file${changed.files === 1 ? '' : 's'} +${changed.added} −${changed.removed}`,
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

    async hunksFor(sessionId): Promise<DecisionSet | null> {
      const held = decisions.get(sessionId)
      if (held !== undefined) return held
      const run = runs.get(sessionId)
      if (run === null) return null
      // Against the base, so the hunks are the same change the summary counted
      // — including work the agent never committed.
      const patch = await runCommand('git', ['diff', baseBranch], run.worktreePath)
      const set = createDecisionSet(patch.ok ? parseHunks(patch.stdout) : [])
      decisions.set(sessionId, set)
      return set
    },

    async decideHunk(sessionId, hunkId, decision): Promise<boolean> {
      const set = await this.hunksFor(sessionId)
      if (set === null) return false
      set.decide(hunkId, decision)
      return true
    },

    async applyDecisions(sessionId): Promise<ApplyResult> {
      const run = runs.get(sessionId)
      const set = decisions.get(sessionId)
      if (run === null || set === undefined) {
        return { ok: false, reverted: 0, error: 'there is no open review for that run' }
      }

      const rejected = set
        .list()
        .filter((entry) => entry.decision === 'reject')
        .map((entry) => entry.hunk)

      const result = await revertRejected(rejected, {
        applyReverse: (patch) => applyReverse(run.worktreePath, patch),
      })
      // Dropped once applied: the hunks describe a working copy that no longer
      // exists, and re-applying them would revert the accepted changes too.
      if (result.ok) decisions.delete(sessionId)
      return result
    },

    async intentFor(sessionId, request, agentAccount): Promise<IntentReview | null> {
      const run = runs.get(sessionId)
      if (run === null) return null
      const changedFiles = await readChangedFiles(run.worktreePath, baseBranch, runCommand)
      return reviewIntent({
        request,
        agentAccount,
        changedFiles,
        // Taken from the request itself. A card's tasks name the files they
        // touch, so the paths in the text are what the work was expected to
        // cover — and with nothing named the step reports nothing rather than
        // flagging every file, which would be noise that trains you to skip it.
        expectedFiles: pathsIn(request),
      })
    },

    lanes(card) {
      return laneViews(card)
    },

    mayMerge(card, ord, merged) {
      return mayMergeLane(card, ord, merged)
    },

    snapshot() {
      return {
        runs: runs.list(),
        review: review.list(),
        backpressure: backpressure.check(),
      }
    },
  }
}
