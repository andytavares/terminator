import type { ExtensionAPI } from '@terminator/extension-sdk'

import { ruleInWords } from '../gates/rules.js'
import { pushLanes } from './integrate.js'
import type { ShellExec } from './integrate.js'
import { watchChecks, failedLogs } from './ci.js'
import type { Check, CiVerdict } from './ci.js'
import { ciReworkTarget, shipNodeId, settleShip } from './ship-tail.js'
import { writeCiState } from './ci-state.js'
import type { CiState } from './ci-state.js'
import { rework } from './scheduler.js'
import { execute, opensPullRequest } from './executor.js'
import type { RunOutcome, ExecutorDeps } from './executor.js'
import type { RunGraph, Feedback } from './run-graph.js'
import type { Recipe } from '../recipe/parse.js'
import type { IntegrateDeps } from './integrate.js'
import type { WorkOrder } from '../order/schema.js'

import { indexFor, orderStoreAt, writeGraph } from '../state/live-index.js'

/**
 * Why a finished run did not open anything, in one sentence.
 *
 * Read off the outcome in the order `shippable` itself checks, so the sentence
 * names the first thing that actually stopped it rather than the last thing
 * that happens to be false.
 */
export function whyNotShipped(recipe: Recipe, outcome: RunOutcome): string {
  if (!opensPullRequest(recipe)) {
    return `the "${recipe.id}" shape opens nothing — it is a question, not a change`
  }
  if (!outcome.complete) return 'not every node finished'
  if (outcome.gates.length > 0) {
    return `held by ${outcome.gates.map((gate) => ruleInWords(gate.rule)).join(', ')}`
  }
  if (outcome.ladder === null) return 'verification never ran, so nothing has been checked'
  if (!outcome.ladder.ok) {
    const failedStep = outcome.ladder.steps.find((step) => step.result === 'fail') ?? null
    return outcome.ladder.stoppedAt === null || failedStep === null
      ? `verification could not measure ${outcome.ladder.unmeasured.join(', ')}`
      : `verification stopped at ${failedStep.name}`
  }
  return 'it was not shippable, and this build cannot say which check said so'
}

/**
 * @param orderId Which order's ledger these entries belong in.
 *
 * Not `subject`, which is what this used. A shipping entry's subject is
 * whatever the entry is about — the order for `ship.ready_asked`, and the
 * **pull request URL** for `ship.draft_opened`. Filing by subject sent the most
 * important entry the feature writes to a ledger named after a URL, and built
 * the directories to match:
 *
 *   .foundry/orders/https:/github.com/owner/repo/pull/8/ledger.jsonl
 *
 * So a live run opened a real draft and its own ledger never said so — the
 * evidence for the one thing the Line exists to do, filed under a path made of
 * somebody else's text.
 */
export function integrateDepsFor(api: ExtensionAPI, root: string, orderId: string): IntegrateDeps {
  return {
    exec: (options) => api.shell.exec(options),
    root,
    now: () => new Date().toISOString(),
    autoOpen: api.settings?.get<boolean>('terminator.foundry.autoOpenDraftPr') ?? true,
    // Nothing in the extension host answers a gate; the operator does, through
    // the inbox. A shipping decision reaching this seam means it was never
    // raised, and holding is the only safe reading of that.
    decide: async () => 'hold',
    record: async (action, subject, reason) => {
      await orderStoreAt(root).record({
        at: new Date().toISOString(),
        orderId,
        actor: 'rule:ship',
        action,
        subject,
        reason,
        evidence: [],
      })
    },
  }
}

/** The parts of a CI round that both the run and the inbox share. */
export interface CiRoundDeps {
  watch: (
    pull: { url: string; cwd: string },
    onPoll: (checks: readonly Check[]) => void,
    judged: ReadonlySet<string>
  ) => Promise<CiVerdict>
  failedLogs: (checks: readonly Check[], cwd: string) => Promise<string>
  record: (action: string, subject: string, reason: string) => Promise<void>
  state: (state: Omit<CiState, 'at'>) => Promise<void>
}

/**
 * The parts of a CI round that never change between the run that opened the
 * draft and a later "another round" answered from the inbox: how a pull's
 * checks are watched, how a failure's log is read, and where the round's own
 * ledger entry and live state go.
 *
 * `sendBack` is deliberately not here — the run and the inbox each build a
 * different one, because the run already has a graph and executor deps in
 * hand and the inbox has to rebuild them.
 */
export function ciRoundDepsFor(root: string, orderId: string, exec: ShellExec): CiRoundDeps {
  return {
    watch: (pull, onPoll, judged) =>
      watchChecks(pull, exec, {
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        onPoll,
        ignoreRuns: judged,
      }),
    failedLogs: (checks, cwd) => failedLogs(checks, cwd, exec),
    record: (action, subject, reason) => recordCiEntry(root, orderId, { action, subject, reason }),
    state: async (state) => {
      await writeCiState(root, orderId, { ...state, at: new Date().toISOString() })
      indexFor(root).announce({ kind: 'graph', orderId })
    },
  }
}

async function recordCiEntry(
  root: string,
  orderId: string,
  entry: { action: string; subject: string; reason: string }
): Promise<void> {
  await orderStoreAt(root).record({
    at: new Date().toISOString(),
    orderId,
    actor: 'rule:ci',
    action: entry.action,
    subject: entry.subject,
    reason: entry.reason,
    evidence: [],
  })
}

/**
 * Where a run's tail works: its records, its shape, its order, and its graph
 * as each round leaves it.
 *
 * `graphRef` is a box rather than a plain graph because a CI round shared
 * between a run in flight and a `ci.red` gate answered later from the inbox
 * has to see the graph the previous round left, and the inbox path has no
 * closure over a running executor to hold it for it.
 */
export interface ShipRun {
  readonly root: string
  readonly order: WorkOrder
  readonly recipe: Recipe
  readonly graphRef: { current: RunGraph }
}

/**
 * The fix round a red CI check gets: rework the graph back to the builder,
 * re-run the executor from there, and — if that leaves the order shippable —
 * push the fixed branches onto the drafts that are already open.
 */
export function ciSendBackFor(
  run: ShipRun,
  deps: { executorDeps: ExecutorDeps; integrateDeps: IntegrateDeps }
): (feedback: Feedback) => Promise<boolean> {
  const { root, order, recipe, graphRef } = run
  return async (feedback) => {
    const target = ciReworkTarget(recipe)
    const shipId = shipNodeId(recipe)
    if (target === null || shipId === null) return false

    graphRef.current = rework(graphRef.current, shipId, { to: target, feedback })
    await writeGraph(root, graphRef.current)

    const outcome = await execute(order, recipe, graphRef.current, deps.executorDeps)
    graphRef.current = outcome.graph
    await writeGraph(root, graphRef.current)

    if (!outcome.shippable) return false
    await pushLanes(order, deps.integrateDeps)
    return true
  }
}

/**
 * Settle the recipe's ship node once the tail has finished: passed when the
 * ready-for-review question was raised, waiting otherwise. A ship node that is
 * neither running nor (when asked) waiting is left as it is.
 */
export async function settleShipNode(
  run: Pick<ShipRun, 'root' | 'recipe' | 'graphRef'>,
  asked: boolean
): Promise<void> {
  const { root, recipe, graphRef } = run
  const shipId = shipNodeId(recipe)
  if (shipId === null) return
  const settled = settleShip(graphRef.current, shipId, { asked, at: new Date().toISOString() })
  if (settled === graphRef.current) return
  graphRef.current = settled
  await writeGraph(root, graphRef.current)
}
