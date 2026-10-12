import type { ExtensionAPI } from '@terminator/extension-sdk'

import { rulesAtRung } from '../verify/rules.js'
import { RUNGS, rungLevelInWords } from '../verify/ladder.js'
import { askOnce, createLiveGateStore } from '../gates/store.js'
import { shipOrder } from './integrate.js'
import { afterFinalCheck, ciRounds, settledOnce } from './ship-tail.js'
import { createEarlyShip } from './early-ship.js'
import { execute } from './executor.js'
import type { RunOutcome } from './executor.js'
import type { RunGraph } from './run-graph.js'
import type { Recipe } from '../recipe/parse.js'
import { documentOutcome } from './document-outcome.js'
import type { IntegrateDeps, Shipment } from './integrate.js'
import { writeBack } from '../trackers/write-back.js'
import type { WorkOrder } from '../order/schema.js'

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

export async function executeRun(
  api: ExtensionAPI,
  root: string,
  order: WorkOrder,
  recipe: Recipe,
  graph: RunGraph
): Promise<void> {
  const {
    deps: executorDeps,
    exec,
    store,
    houseRules,
  } = await buildExecutorDeps(api, root, order, recipe, graph)
  const issuesPort = issuesPortFor(api)

  // The issue moves the moment work starts, not when somebody remembers.
  await writeBack(order, 'started', writeBackDepsFor(api, root, order, issuesPort))

  const gates = createLiveGateStore(() => root, indexFor)
  const graphRef = { current: graph }
  // Shipped against the grade the change turned out to deserve, not the one
  // the plan predicted — which is the whole reason the executor regrades. The
  // CI send-back reads it, so it follows the early drafts' regrade.
  const shippedOrderRef = { current: order }

  const shipmentFor = (found: {
    verdicts: RunOutcome['verdicts']
    ladder: RunOutcome['ladder']
    inspectionRequired: boolean
    reason: string
  }): Shipment => ({
    verdicts: found.verdicts,
    findings: found.inspectionRequired ? [found.reason] : [],
    inspection: {
      ran: found.inspectionRequired,
      reason: `graded ${shippedOrderRef.current.risk.grade} with no risk triggers`,
    },
    ladder: found.ladder,
    // Grouped by rung, so the record says what was in force where rather
    // than listing every rule as though they all applied at once.
    rulesInForce: RUNGS.flatMap((rung) =>
      rulesAtRung(houseRules, rung).map(
        (rule) => `${rule.asserts.trim()} (${rungLevelInWords(rung)})`
      )
    ),
  })

  // The CI watch can start before the final check ends (ADR 085). A red round
  // sends work back only once the check has settled, so a builder never edits
  // the checkout the check is climbing over.
  const finalCheck = settledOnce<boolean>()
  const shipDeps: IntegrateDeps = {
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
      await writeBack(order, 'draft_opened', writeBackDepsFor(api, root, order, issuesPort), {
        pulls: pulls.map((pull) => ({ repo: pull.repo, url: pull.url })),
      })
    },
    // A recipe with no `ci` never asks to watch anything (`rounds: null`
    // makes `ciRounds` return `{ kind: 'none' }` without a single poll).
    watchCi: (pulls) =>
      ciRounds({
        pulls: pulls.map((pull) => ({ url: pull.url, cwd: pull.cwd })),
        rounds: recipe.ci?.rounds ?? null,
        ...ciRoundDepsFor(root, order.id, exec),
        sendBack: afterFinalCheck(
          finalCheck.settled,
          ciSendBackFor(
            root,
            shippedOrderRef.current,
            recipe,
            executorDeps,
            integrateDepsFor(api, root, order.id),
            graphRef
          )
        ),
      }),
  }

  // The draft opens before the final check, and the check runs while CI does
  // (ADR 085) — unless the operator decides before anything is pushed.
  const early = createEarlyShip({ order, deps: shipDeps, shipment: shipmentFor })
  let outcome: Awaited<ReturnType<typeof execute>>
  try {
    outcome = await execute(order, recipe, graph, {
      ...executorDeps,
      beforeFinalCheck: async (found) => {
        shippedOrderRef.current = { ...order, risk: found.risk }
        // A document outside the checkout has no change to open a draft on.
        const end = documentOutcome(recipe, (await store.load(order.id))?.document ?? null)
        if (end.kind === 'ready' || end.kind === 'missing') return false
        return early.beforeFinalCheck(found)
      },
    })
  } catch (error) {
    finalCheck.settle(false)
    throw error
  }
  finalCheck.settle(outcome.ladder?.ok ?? false)
  graphRef.current = outcome.graph

  await writeGraph(root, outcome.graph)
  await store.record({
    at: new Date().toISOString(),
    orderId: order.id,
    actor: 'rule:line',
    action: outcome.complete ? 'run.complete' : 'run.halted',
    subject: order.id,
    reason: outcome.complete
      ? `${outcome.verdicts.length} verdicts`
      : `waiting on ${outcome.awaitingDecision.join(', ') || 'a gate'}`,
    evidence: [],
  })

  // ── The tail ───────────────────────────────────────────────────────────
  //
  // A shape whose product is a document ends on where its author put it. In
  // the checkout it ships as a pull request below; anywhere else there is no
  // change to open one on, and an author that handed nothing back has not
  // finished.
  const latest = await store.load(order.id)
  const documentEnd = outcome.shippable
    ? documentOutcome(recipe, latest?.document ?? null)
    : ({ kind: 'not-a-document-shape' } as const)
  if (documentEnd.kind === 'missing' || documentEnd.kind === 'ready') {
    await store.record({
      at: new Date().toISOString(),
      orderId: order.id,
      actor: 'rule:line',
      action: documentEnd.kind === 'missing' ? 'run.failed' : 'run.document_ready',
      subject: order.id,
      reason: documentEnd.kind === 'missing' ? documentEnd.reason : documentEnd.where,
      evidence: [],
    })
    await settleShipNode(root, recipe, graphRef, documentEnd.kind === 'ready')
    return
  }

  // Work that is finished and waiting on nobody ships, without being asked
  // (FR-053). Work that is waiting on somebody does not — the run halts, the
  // inbox has the question, and answering it resumes from here.
  if (!outcome.shippable) {
    // Out loud. A run that finishes every node and then quietly does not ship
    // is indistinguishable, from every surface, from one that shipped — the
    // graph is all green either way, and the only way to find out was to go
    // and look at GitHub. Watched on a live run: every node passed, nothing
    // was pushed, and nothing anywhere said why.
    await store.record({
      at: new Date().toISOString(),
      orderId: order.id,
      actor: 'rule:line',
      action: 'ship.refused',
      subject: order.id,
      reason: whyNotShipped(recipe, outcome),
      evidence: [],
    })
    await settleShipNode(root, recipe, graphRef, false)
    return
  }

  shippedOrderRef.current = { ...order, risk: outcome.risk }

  const earlyShipped = early.opened ? await early.finish(outcome) : null
  const shipped =
    earlyShipped ??
    (early.opened
      ? null
      : await shipOrder(
          shippedOrderRef.current,
          shipmentFor({
            verdicts: outcome.verdicts,
            ladder: outcome.ladder,
            inspectionRequired: outcome.inspection.required,
            reason: outcome.inspection.reason,
          }),
          shipDeps
        ))

  // The ship node was left running when the executor reached it. It passes
  // when the ready question is raised, and goes back to waiting when shipping
  // stopped short of it, so a resume owes the tail again.
  await settleShipNode(root, recipe, graphRef, shipped?.gate?.rule === 'ready-for-review')

  if (shipped === null || shipped.held || shipped.pulls.length === 0) return

  await store.save({
    ...order,
    document: (await store.load(order.id))?.document ?? order.document,
    status: 'shipped',
  })
}
