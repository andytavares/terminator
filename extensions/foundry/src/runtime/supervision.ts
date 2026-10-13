import * as path from 'node:path'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import {
  createRunRegistry,
  type Run,
  type RunHistoryEntry,
  type RunRegistry,
} from './run-registry.js'
import { createFeedLog, type FeedLog } from './feed/feed-log.js'
import { readDiffSummary, type RunCommand } from './diff-metrics.js'

// The supervision layer: what is running and what it changed.
//
// Assembled here rather than in the extension's entry point so it can be built
// without an Electron host and exercised as one thing — the closed branch's
// worst bugs were all in wiring that each unit tested fine on its own.

export interface Supervision {
  readonly runs: RunRegistry
  readonly feed: FeedLog
  /**
   * Reads what a run's working copy has changed and records it.
   *
   * Nothing reported this in the closed branch, so the diff stayed at zero for
   * a run's whole life — which made `ready` unreachable.
   */
  measure(sessionId: string): Promise<void>
  /**
   * A run has finished a turn. With changes, that is something to look at: in a
   * terminal the agent does not exit when it is done, it sits at its prompt, so
   * waiting for the conversation to end would mean work was never offered.
   */
  finishTurn(sessionId: string, turns: number, at: number): Promise<void>
  /** The run ended for good. */
  finish(sessionId: string, at: number): void
  /** Everything a surface needs in one read. */
  snapshot(): {
    runs: Run[]
    /** What is over, so the live list does not have to be the record too. */
    history: RunHistoryEntry[]
  }
}

export interface SupervisionOptions {
  api: ExtensionAPI
  stateDir: string
  /** Injected so the whole layer can be exercised without a repository. */
  run?: RunCommand
  /** The branch a card's work is measured against. */
  baseBranch?: string
  /** Told whenever the feed gains or loses a line. */
  onFeedChange?: () => void
}

/** What the supervision layer's parts share. */
interface SupervisionContext {
  readonly runs: RunRegistry
  readonly feed: FeedLog
  /**
   * Whatever the card was actually branched from. Measuring against a fixed
   * `main` reported the difference between two branches rather than the work
   * this run did.
   */
  readonly baseBranch: string
  readonly runCommand: RunCommand
}

export function createSupervision(options: SupervisionOptions): Supervision {
  const runs = createRunRegistry()
  const context: SupervisionContext = {
    runs,
    feed: createFeedLog(path.join(options.stateDir, 'feed.jsonl'), options.onFeedChange),
    baseBranch: options.baseBranch ?? 'main',
    runCommand: options.run ?? shellRunCommand(options.api),
  }

  return {
    runs,
    feed: context.feed,
    measure: (sessionId) => measure(context, sessionId),
    finishTurn: (sessionId, turns, at) => finishTurn(context, sessionId, { turns, at }),
    finish: (sessionId, at) => finish(runs, sessionId, at),
    snapshot: () => ({
      runs: runs.list(),
      history: runs.history(),
    }),
  }
}

/** `git`, through the host's shell. */
function shellRunCommand(api: ExtensionAPI): RunCommand {
  return async (command, args, cwd) => {
    const result = await api.shell.exec({ command: command as 'git', args, cwd })
    return { ok: result.exitCode === 0, stdout: result.stdout }
  }
}

async function measure(context: SupervisionContext, sessionId: string): Promise<void> {
  const { runs } = context
  const run = runs.get(sessionId)
  if (run === null || run.worktreePath === '') return
  runs.noteDiff(
    sessionId,
    await readDiffSummary(run.worktreePath, run.baseBranch ?? context.baseBranch, {
      run: context.runCommand,
    })
  )
}

async function finishTurn(
  context: SupervisionContext,
  sessionId: string,
  { turns, at }: { turns: number; at: number }
): Promise<void> {
  const { runs } = context
  const run = runs.get(sessionId)
  if (run === null) return
  runs.noteTurns(sessionId, turns)
  await measure(context, sessionId)

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

  context.feed.post({
    at,
    sessionId,
    author: 'agent',
    summary: `${path.basename(run.featureDir)} is ready to review — ${changed.files} file${changed.files === 1 ? '' : 's'} +${changed.added} −${changed.removed}`,
  })
}

function finish(runs: RunRegistry, sessionId: string, at: number): void {
  const run = runs.get(sessionId)
  if (run === null) return
  // Left on the register rather than removed: a finished run with a diff is
  // still work somebody may open.
  runs.setState(sessionId, run.diff.files > 0 ? 'ready' : 'finished', at)
}
