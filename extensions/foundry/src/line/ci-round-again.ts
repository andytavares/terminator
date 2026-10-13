import type { ExtensionAPI } from '@terminator/extension-sdk'

import type { GateStore } from '../gates/store.js'
import type { WorkOrder } from '../order/schema.js'
import type { Recipe } from '../recipe/parse.js'
import { resolveRecipe } from '../recipe/resolve.js'
import { orderStoreAt, readGraph } from '../state/live-index.js'
import { resolveSources } from '../workspace-root.js'
import { buildExecutorDeps } from './executor-deps.js'
import { finishShipping, readPulls } from './integrate.js'
import type { LanePullRequest } from './integrate.js'
import type { RunGraph } from './run-graph.js'
import { ciRoundDepsFor, ciSendBackFor, integrateDepsFor, settleShipNode } from './ship-deps.js'
import { ciRounds } from './ship-tail.js'

/** One more CI watch on drafts that are already open. */
export interface CiRoundAgain {
  readonly api: ExtensionAPI
  readonly root: string
  readonly orderId: string
  /** A fixed number of rounds, or the recipe's own count. */
  readonly rounds: number | 'recipe'
  /** Where a gate the round raises is saved. */
  readonly gates: GateStore
}

/** An order that has shipped drafts: what it is, its shape, its graph and its pulls. */
interface ShippedOrder {
  readonly order: WorkOrder
  readonly recipe: Recipe
  readonly graph: RunGraph
  readonly pulls: LanePullRequest[]
}

/**
 * `ciRounds` against the drafts that already exist, then `finishShipping` so
 * the order gets its ready gate again, or `ci.red` if the round failed. Shared
 * by the `ci.red` gate's "another round" and the refinery's recheck after a
 * rebase. Nothing happens for an order with no recipe, no graph or one whose
 * recipe no longer resolves.
 */
export async function ciRoundAgain(request: CiRoundAgain): Promise<void> {
  const { api, root } = request
  const shipped = await loadShipped(api, root, request.orderId)
  if (shipped === null) return
  const { order, recipe, graph, pulls } = shipped
  const { deps: executorDeps, exec } = await buildExecutorDeps(api, { root, order, recipe, graph })
  const integrateDeps = integrateDepsFor(api, root, order.id)
  const run = { root, order, recipe, graphRef: { current: graph } }
  const outcome = await ciRounds({
    pulls: pulls.map((pull) => ({ url: pull.url, cwd: pull.cwd })),
    rounds: request.rounds === 'recipe' ? (recipe.ci?.rounds ?? null) : request.rounds,
    ...ciRoundDepsFor(root, order.id, exec),
    sendBack: ciSendBackFor(run, { executorDeps, integrateDeps }),
  })
  const finished = await finishShipping(
    order,
    {
      shipment: { verdicts: [], findings: [] },
      drafts: { pulls, bodyPaths: pulls.map((pull) => pull.bodyPath) },
      ci: outcome,
    },
    {
      ...integrateDeps,
      raiseGate: async (gate) => {
        await request.gates.save(gate)
      },
    }
  )
  await settleShipNode(run, finished.gate?.rule === 'ready-for-review')
}

async function loadShipped(
  api: ExtensionAPI,
  root: string,
  orderId: string
): Promise<ShippedOrder | null> {
  const order = await orderStoreAt(root).load(orderId)
  if (order === null || order.recipe === null) return null
  const resolved = resolveRecipe(order.recipe, resolveSources(api, root))
  if (!resolved.ok) return null
  const recipe = resolved.resolved.value
  const graph = await readGraph(root, orderId)
  if (graph === null) return null
  return { order, recipe, graph, pulls: await readPulls(root, orderId) }
}
