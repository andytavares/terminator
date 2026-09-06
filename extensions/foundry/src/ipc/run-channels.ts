import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { orderDir, ensureWritable } from '../data-root.js'
import { buildRunGraph } from '../line/run-graph.js'
import type { RunGraph } from '../line/run-graph.js'
import { readyNodes, blockedReason } from '../line/scheduler.js'
import { resolveRecipe, availableNames } from '../recipe/resolve.js'
import type { ResolveSources } from '../recipe/resolve.js'
import { checkRequirements } from '../recipe/requirements.js'
import type { OrderStore } from '../order/store.js'
import type { WorkOrder } from '../order/schema.js'

// Starting a run.
//
// Everything that can refuse, refuses *before* any work begins: the order has
// to be agreed, the recipe has to be one this repository can actually support,
// and the records location has to be writable. An order that fails half way
// through because a directory could not be created has already spent agent
// time, and the message arrives attached to the wrong thing.

const StartPayload = z.object({ id: z.string(), recipe: z.string().optional() })
const ObservePayload = z.object({ id: z.string() })
const AttachPayload = z.object({ orderId: z.string(), nodeId: z.string() })

export interface RunDeps {
  readonly store: OrderStore
  readonly dataRoot: string
  readonly sources: ResolveSources
  readonly now: () => string
}

export interface RunChannels {
  start(payload: unknown): Promise<unknown>
  observe(payload: unknown): Promise<unknown>
  /** Which shapes of work this order could actually take, and why not. */
  recipes(payload: unknown): Promise<unknown>
  /** The live session behind a running agent, so a surface can go to it. */
  attach(payload: unknown): Promise<unknown>
}

function graphPath(dataRoot: string, orderId: string): string {
  return path.join(orderDir(dataRoot, orderId), 'run-graph.json')
}

/**
 * Choose a shape when the operator has not.
 *
 * Deliberately simple and stated out loud rather than clever: one unit is a
 * direct change, several is the standard shape, and anything already carrying
 * a recipe keeps it. The operator overrides in one click and that override is
 * recorded — a proposal nobody can predict is worse than a plain one.
 */
export function proposeRecipe(order: WorkOrder): string {
  if (order.recipe !== null) return order.recipe
  if (order.plan.units.length <= 1 && order.risk.grade === 'P3') return 'direct'
  return 'standard'
}

export function createRunChannels(deps: RunDeps): RunChannels {
  async function saveGraph(graph: RunGraph): Promise<void> {
    await fs.promises.mkdir(orderDir(deps.dataRoot, graph.orderId), { recursive: true })
    await fs.promises.writeFile(
      graphPath(deps.dataRoot, graph.orderId),
      `${JSON.stringify(graph, null, 2)}\n`,
      'utf8'
    )
  }

  async function loadGraph(orderId: string): Promise<RunGraph | null> {
    try {
      return JSON.parse(
        await fs.promises.readFile(graphPath(deps.dataRoot, orderId), 'utf8')
      ) as RunGraph
    } catch {
      return null
    }
  }

  async function start(raw: unknown): Promise<unknown> {
    const parsed = StartPayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const order = await deps.store.load(parsed.data.id)
    if (order === null) return { error: `No order ${parsed.data.id}.` }
    if (order.status !== 'agreed') {
      return {
        error: `Only an agreed order can be started; this one is ${order.status}.`,
      }
    }

    const writable = await ensureWritable(deps.dataRoot)
    if (!writable.ok) return { error: writable.reason }

    const name = parsed.data.recipe ?? proposeRecipe(order)
    const resolved = resolveRecipe(name, deps.sources)
    if (!resolved.ok) return { error: resolved.reason }

    const availability = checkRequirements(resolved.resolved.value.requires, order)
    if (!availability.available) {
      return { error: `The "${name}" shape cannot run here: ${availability.unmet.join('; ')}.` }
    }

    const graph = buildRunGraph(order, resolved.resolved.value)
    await saveGraph(graph)

    const running: WorkOrder = {
      ...order,
      status: 'running',
      recipe: name,
      recipeOverriddenBy: parsed.data.recipe === undefined ? null : 'operator',
    }
    await deps.store.save(running)
    await deps.store.record({
      at: deps.now(),
      orderId: order.id,
      actor: parsed.data.recipe === undefined ? 'role:architect' : 'operator',
      action: 'run.started',
      subject: name,
      // Which rung the recipe came from is part of the answer: "which recipe
      // ran" alone does not explain a surprising run.
      reason: `recipe resolved from ${resolved.resolved.rung}`,
      evidence: [],
    })

    return { graph, order: running }
  }

  async function observe(raw: unknown): Promise<unknown> {
    const parsed = ObservePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const graph = await loadGraph(parsed.data.id)
    if (graph === null) return { error: `No run for ${parsed.data.id}.` }

    const order = await deps.store.load(parsed.data.id)
    const budgets = order?.budgets ?? {
      agents: 3,
      wallClockMinutes: 45,
      filesTouched: 25,
      tokens: null,
    }

    return {
      graph,
      ready: readyNodes(graph, budgets).map((n) => n.id),
      blocked: graph.nodes
        .map((n) => ({ id: n.id, reason: blockedReason(graph, n.id) }))
        .filter((b) => b.reason !== null),
    }
  }

  async function recipes(raw: unknown): Promise<unknown> {
    const parsed = ObservePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const order = await deps.store.load(parsed.data.id)
    if (order === null) return { error: `No order ${parsed.data.id}.` }

    const offered = availableNames('recipes', deps.sources).map((name) => {
      const resolved = resolveRecipe(name, deps.sources)
      if (!resolved.ok) return { name, available: false, unmet: [resolved.reason], rung: null }
      const availability = checkRequirements(resolved.resolved.value.requires, order)
      return {
        name,
        available: availability.available,
        unmet: availability.unmet,
        rung: resolved.resolved.rung,
        description: resolved.resolved.value.description,
      }
    })

    return { recipes: offered, proposed: proposeRecipe(order) }
  }

  /**
   * Where the agent actually is.
   *
   * The backstop: however good the structured view gets, there are moments
   * when the only useful thing is to be in the session typing at it. One
   * action, from any surface.
   */
  async function attach(raw: unknown): Promise<unknown> {
    const parsed = AttachPayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const graph = await loadGraph(parsed.data.orderId)
    if (graph === null) return { error: `No run for ${parsed.data.orderId}.` }

    const node = graph.nodes.find((n) => n.id === parsed.data.nodeId)
    if (node === undefined) return { error: `No step ${parsed.data.nodeId}.` }
    if (node.sessionId === null) {
      return { error: `${node.id} has no session yet — it is ${node.state}.` }
    }
    return { terminalSessionId: node.sessionId, nodeId: node.id }
  }

  return { start, observe, recipes, attach }
}
