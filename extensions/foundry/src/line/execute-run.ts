import type { ExtensionAPI } from '@terminator/extension-sdk'

import { rulesAtRung } from '../verify/rules.js'
import { RUNGS, rungLevelInWords } from '../verify/ladder.js'
import { askOnce, createLiveGateStore } from '../gates/store.js'
import type { GateStore } from '../gates/store.js'
import { shipOrder } from './integrate.js'
import { afterFinalCheck, ciRounds, settledOnce } from './ship-tail.js'
import { createEarlyShip } from './early-ship.js'
import { execute } from './executor.js'
import type { ExecutorDeps, RunOutcome } from './executor.js'
import type { RunGraph } from './run-graph.js'
import type { Recipe } from '../recipe/parse.js'
import { documentOutcome } from './document-outcome.js'
import type { IntegrateDeps, ShellExec, Shipment, ShipOutcome } from './integrate.js'
import { writeBack } from '../trackers/write-back.js'
import type { IssuesPort } from '../trackers/write-back.js'
import type { WorkOrder } from '../order/schema.js'
import type { OrderStore } from '../order/store.js'

import { indexFor, writeGraph } from '../state/live-index.js'
import { issuesPortFor, writeBackDepsFor } from '../trackers/issues-port.js'
import {
  whyNotShipped,
  integrateDepsFor,
  ciRoundDepsFor,
  ciSendBackFor,
  settleShipNode,
} from './ship-deps.js'
import { buildExecutorDeps } from './executor-deps.js'
import type { OrderRun } from './executor-deps.js'

type HouseRules = Awaited<ReturnType<typeof buildExecutorDeps>>['houseRules']
type EarlyShip = ReturnType<typeof createEarlyShip>

/** Everything the run and its tail share once the executor's deps are built. */
interface RunTail {
  readonly api: ExtensionAPI
  readonly root: string
  readonly order: WorkOrder
  readonly recipe: Recipe
  readonly executorDeps: ExecutorDeps
  readonly exec: ShellExec
  readonly store: OrderStore
  readonly houseRules: HouseRules
  readonly issuesPort: IssuesPort
  readonly gates: GateStore
  readonly graphRef: { current: RunGraph }
  // Shipped against the grade the change turned out to deserve, not the one
  // the plan predicted — which is the whole reason the executor regrades. The
  // CI send-back reads it, so it follows the early drafts' regrade.
  readonly shippedOrderRef: { current: WorkOrder }
  // The CI watch can start before the final check ends (ADR 085). A red round
  // sends work back only once the check has settled, so a builder never edits
  // the checkout the check is climbing over.
  readonly finalCheck: ReturnType<typeof settledOnce<boolean>>
}

/** What a shipment is drawn from: the run's verdicts, its ladder, and whether inspection is owed. */
interface Found {
  verdicts: RunOutcome['verdicts']
  ladder: RunOutcome['ladder']
  inspectionRequired: boolean
  reason: string
}

export async function executeRun(api: ExtensionAPI, run: OrderRun): Promise<void> {
  const tail = await prepareRun(api, run)
  const { order } = tail

  // The issue moves the moment work starts, not when somebody remembers.
  await writeBack(order, { event: 'started' }, writeBackDepsFor(tail.root, order, tail.issuesPort))

  const shipDeps = shipDepsFor(tail)
  // The draft opens before the final check, and the check runs while CI does
  // (ADR 085) — unless the operator decides before anything is pushed.
  const early = createEarlyShip({
    order,
    deps: shipDeps,
    shipment: (found) => shipmentFor(tail, found),
  })
  const outcome = await executeGraph(tail, early, run.graph)
  await writeGraph(tail.root, outcome.graph)
  await recordRunEnd(tail, outcome)
  await finishTail(tail, { early, shipDeps, outcome })
}

async function prepareRun(api: ExtensionAPI, run: OrderRun): Promise<RunTail> {
  const { root, order, recipe, graph } = run
  const built = await buildExecutorDeps(api, run)
  return {
    api,
    root,
    order,
    recipe,
    executorDeps: built.deps,
    exec: built.exec,
    store: built.store,
    houseRules: built.houseRules,
    issuesPort: issuesPortFor(api),
    gates: createLiveGateStore(() => root, indexFor),
    graphRef: { current: graph },
    shippedOrderRef: { current: order },
    finalCheck: settledOnce<boolean>(),
  }
}

function shipmentFor(tail: RunTail, found: Found): Shipment {
  return {
    verdicts: found.verdicts,
    findings: found.inspectionRequired ? [found.reason] : [],
    inspection: {
      ran: found.inspectionRequired,
      reason: `graded ${tail.shippedOrderRef.current.risk.grade} with no risk triggers`,
    },
    ladder: found.ladder,
    // Grouped by rung, so the record says what was in force where rather
    // than listing every rule as though they all applied at once.
    rulesInForce: RUNGS.flatMap((rung) =>
      rulesAtRung(tail.houseRules, rung).map(
        (rule) => `${rule.asserts.trim()} (${rungLevelInWords(rung)})`
      )
    ),
  }
}

function shipDepsFor(tail: RunTail): IntegrateDeps {
  const { api, root, order, gates } = tail
  return {
    ...integrateDepsFor(api, root, order.id),
    // The shipping decision, where the grade calls for one, is the operator's
    // and reaches them through the inbox like every other.
    decide: (gate) => askOnce(gates, gate),
    raiseGate: async (gate) => {
      await gates.save(gate)
    },
    // The ticket moves to In Review when the draft opens, not when the CI
    // watch that follows it ends.
    onDraftOpened: async (pulls) => {
      await writeBack(
        order,
        { event: 'draft_opened', pulls: pulls.map((pull) => ({ repo: pull.repo, url: pull.url })) },
        writeBackDepsFor(root, order, tail.issuesPort)
      )
    },
    watchCi: (pulls) => watchCi(tail, pulls),
  }
}

// A recipe with no `ci` never asks to watch anything (`rounds: null`
// makes `ciRounds` return `{ kind: 'none' }` without a single poll).
function watchCi(
  tail: RunTail,
  pulls: Parameters<NonNullable<IntegrateDeps['watchCi']>>[0]
): ReturnType<typeof ciRounds> {
  const { api, root, order, recipe, graphRef } = tail
  return ciRounds({
    pulls: pulls.map((pull) => ({ url: pull.url, cwd: pull.cwd })),
    rounds: recipe.ci?.rounds ?? null,
    ...ciRoundDepsFor(root, order.id, tail.exec),
    sendBack: afterFinalCheck(
      tail.finalCheck.settled,
      ciSendBackFor(
        { root, order: tail.shippedOrderRef.current, recipe, graphRef },
        { executorDeps: tail.executorDeps, integrateDeps: integrateDepsFor(api, root, order.id) }
      )
    ),
  })
}

async function executeGraph(tail: RunTail, early: EarlyShip, graph: RunGraph): Promise<RunOutcome> {
  const { order, recipe, store } = tail
  let outcome: RunOutcome
  try {
    outcome = await execute(order, recipe, graph, {
      ...tail.executorDeps,
      beforeFinalCheck: async (found) => {
        tail.shippedOrderRef.current = { ...order, risk: found.risk }
        // A document outside the checkout has no change to open a draft on.
        const end = documentOutcome(recipe, (await store.load(order.id))?.document ?? null)
        if (end.kind === 'ready' || end.kind === 'missing') return false
        return early.beforeFinalCheck(found)
      },
    })
  } catch (error) {
    tail.finalCheck.settle(false)
    throw error
  }
  tail.finalCheck.settle(outcome.ladder?.ok ?? false)
  // In the same turn as the settle: a CI send-back waiting on it reworks this graph.
  tail.graphRef.current = outcome.graph
  return outcome
}

async function recordTailEntry(
  tail: RunTail,
  entry: { action: string; reason: string }
): Promise<void> {
  await tail.store.record({
    at: new Date().toISOString(),
    orderId: tail.order.id,
    actor: 'rule:line',
    action: entry.action,
    subject: tail.order.id,
    reason: entry.reason,
    evidence: [],
  })
}

async function recordRunEnd(tail: RunTail, outcome: RunOutcome): Promise<void> {
  await recordTailEntry(tail, {
    action: outcome.complete ? 'run.complete' : 'run.halted',
    reason: outcome.complete
      ? `${outcome.verdicts.length} verdicts`
      : `waiting on ${outcome.awaitingDecision.join(', ') || 'a gate'}`,
  })
}

// ── The tail ───────────────────────────────────────────────────────────
async function finishTail(
  tail: RunTail,
  ran: { early: EarlyShip; shipDeps: IntegrateDeps; outcome: RunOutcome }
): Promise<void> {
  if (await endedOnDocument(tail, ran.outcome)) return

  // Work that is finished and waiting on nobody ships, without being asked
  // (FR-053). Work that is waiting on somebody does not — the run halts, the
  // inbox has the question, and answering it resumes from here.
  if (!ran.outcome.shippable) {
    // Out loud. A run that finishes every node and then quietly does not ship
    // is indistinguishable, from every surface, from one that shipped — the
    // graph is all green either way, and the only way to find out was to go
    // and look at GitHub. Watched on a live run: every node passed, nothing
    // was pushed, and nothing anywhere said why.
    await recordTailEntry(tail, {
      action: 'ship.refused',
      reason: whyNotShipped(tail.recipe, ran.outcome),
    })
    await settleShipNode(tail, false)
    return
  }
  await shipFinishedRun(tail, ran)
}

// A shape whose product is a document ends on where its author put it. In
// the checkout it ships as a pull request below; anywhere else there is no
// change to open one on, and an author that handed nothing back has not
// finished.
async function endedOnDocument(tail: RunTail, outcome: RunOutcome): Promise<boolean> {
  const latest = await tail.store.load(tail.order.id)
  const documentEnd = outcome.shippable
    ? documentOutcome(tail.recipe, latest?.document ?? null)
    : ({ kind: 'not-a-document-shape' } as const)
  if (documentEnd.kind !== 'missing' && documentEnd.kind !== 'ready') return false
  await recordTailEntry(tail, {
    action: documentEnd.kind === 'missing' ? 'run.failed' : 'run.document_ready',
    reason: documentEnd.kind === 'missing' ? documentEnd.reason : documentEnd.where,
  })
  await settleShipNode(tail, documentEnd.kind === 'ready')
  return true
}

async function shipFinishedRun(
  tail: RunTail,
  ran: { early: EarlyShip; shipDeps: IntegrateDeps; outcome: RunOutcome }
): Promise<void> {
  const { order, store } = tail
  tail.shippedOrderRef.current = { ...order, risk: ran.outcome.risk }
  const shipped = await shipOnce(tail, ran)

  // The ship node was left running when the executor reached it. It passes
  // when the ready question is raised, and goes back to waiting when shipping
  // stopped short of it, so a resume owes the tail again.
  await settleShipNode(tail, shipped?.gate?.rule === 'ready-for-review')

  if (shipped === null || shipped.held || shipped.pulls.length === 0) return

  await store.save({
    ...order,
    document: (await store.load(order.id))?.document ?? order.document,
    status: 'shipped',
  })
}

async function shipOnce(
  tail: RunTail,
  { early, shipDeps, outcome }: { early: EarlyShip; shipDeps: IntegrateDeps; outcome: RunOutcome }
): Promise<ShipOutcome | null> {
  if (early.opened) return early.finish(outcome)
  return shipOrder(
    tail.shippedOrderRef.current,
    shipmentFor(tail, {
      verdicts: outcome.verdicts,
      ladder: outcome.ladder,
      inspectionRequired: outcome.inspection.required,
      reason: outcome.inspection.reason,
    }),
    shipDeps
  )
}
