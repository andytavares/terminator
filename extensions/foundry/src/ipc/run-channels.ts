import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { orderDir, ensureWritable } from '../data-root.js'
import { laneViews, mayMergeLane } from '../order/lanes.js'
import { buildRunGraph, nodeLabels } from '../line/run-graph.js'
import type { RunGraph } from '../line/run-graph.js'
import type { Recipe } from '../recipe/parse.js'
import { readyNodes, blockedReason, retry as retryNode } from '../line/scheduler.js'
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
const ObservePayload = z.object({ id: z.string(), retry: z.array(z.string()).optional() })
const AttachPayload = z.object({ orderId: z.string(), nodeId: z.string() })

export interface RunDeps {
  readonly store: OrderStore
  /** Resolved on every call: the records location follows the open workspace. */
  readonly dataRoot: () => string
  /**
   * Resolved on every call, like `dataRoot`: which repositories are open,
   * and therefore which `.foundry/` directories are honoured, is not known at
   * activation and changes when the operator switches workspace.
   */
  readonly sources: () => ResolveSources
  readonly now: () => string
  /**
   * Actually run the graph.
   *
   * A seam, so this file keeps knowing nothing about terminals, worktrees or
   * agents — and so a test can assert the graph was handed over without
   * launching one. Optional: a host with no supervision runtime persists the
   * graph and says so, rather than reporting a run that never began.
   */
  readonly execute?: (order: WorkOrder, recipe: Recipe, graph: RunGraph) => Promise<void>
}

export interface RunChannels {
  /** Continue a run that halted at a gate the operator has now answered. */
  resume(payload: unknown): Promise<unknown>
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
 * Persist a graph.
 *
 * Exported because the executor writes the graph back as it progresses, and
 * two files claiming to be the run's state is worse than one written from two
 * places.
 */
export async function writeRunGraph(dataRoot: string, graph: RunGraph): Promise<void> {
  await fs.promises.mkdir(orderDir(dataRoot, graph.orderId), { recursive: true })
  await fs.promises.writeFile(
    graphPath(dataRoot, graph.orderId),
    `${JSON.stringify(graph, null, 2)}\n`,
    'utf8'
  )
}

/** A proposed shape and the reason it fits this order (FR-014). */
export interface ProposedRecipe {
  readonly name: string
  readonly why: string
}

/**
 * Choose a shape when the operator has not, and say why.
 *
 * Deliberately simple and stated out loud rather than clever: one unit is a
 * direct change, several is the standard shape, and anything already carrying
 * a recipe keeps it. The operator overrides in one click and that override is
 * recorded — a proposal nobody can predict is worse than a plain one.
 *
 * The reason travels with the name because a shape decides how many agents
 * run, what gets verified and whether a pull request opens at the end. An
 * operator asked to accept or override that needs the grounds, not just the
 * answer.
 */
export function proposeRecipe(order: WorkOrder): ProposedRecipe {
  if (order.recipe !== null) {
    return { name: order.recipe, why: 'the order already names this shape' }
  }
  const units = order.plan.units.length
  if (units <= 1 && order.risk.grade === 'P3') {
    return {
      name: 'direct',
      why: `${units === 1 ? 'one unit' : 'no units'} of work, graded ${order.risk.grade}`,
    }
  }
  return {
    name: 'standard',
    why:
      units > 1
        ? `${units} units of work`
        : `graded ${order.risk.grade}, which is above the direct shape's ceiling`,
  }
}

export function createRunChannels(deps: RunDeps): RunChannels {
  async function saveGraph(graph: RunGraph): Promise<void> {
    await writeRunGraph(deps.dataRoot(), graph)
  }

  async function loadGraph(orderId: string): Promise<RunGraph | null> {
    try {
      return JSON.parse(
        await fs.promises.readFile(graphPath(deps.dataRoot(), orderId), 'utf8')
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

    const writable = await ensureWritable(deps.dataRoot())
    if (!writable.ok) return { error: writable.reason }

    const chosenByOperator = parsed.data.recipe !== undefined
    const proposal = proposeRecipe(order)
    const name = parsed.data.recipe ?? proposal.name
    const resolved = resolveRecipe(name, deps.sources())
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
      recipeOverriddenBy: chosenByOperator ? 'operator' : null,
    }
    await deps.store.save(running)
    await deps.store.record({
      at: deps.now(),
      orderId: order.id,
      actor: chosenByOperator ? 'operator' : 'role:architect',
      action: 'run.started',
      subject: name,
      // Both halves of "why this shape": the grounds for choosing it, and
      // which rung it was read from. Either alone leaves a surprising run
      // unexplained — the first says why this shape, the second says why this
      // version of it.
      reason: `${
        chosenByOperator ? 'chosen by the operator' : proposal.why
      }; recipe resolved from ${resolved.resolved.rung}`,
      evidence: [],
    })

    if (deps.execute === undefined) {
      // Said out loud. A graph persisted with nothing to run it is what the
      // Forge's hand-off used to produce, and it read as a started run.
      return {
        graph,
        order: running,
        started: false,
        reason: 'The supervision runtime is not available, so nothing was started.',
      }
    }

    // Not awaited: a run outlives the call that started it, and a channel that
    // blocked until the last agent finished would hold the bridge for the
    // length of the work. Failures reach the ledger and the graph, which is
    // where a surface reads them.
    void deps.execute(running, resolved.resolved.value, graph).catch(async (error: unknown) => {
      await deps.store.record({
        at: deps.now(),
        orderId: order.id,
        actor: 'rule:line',
        action: 'run.failed',
        subject: order.id,
        reason: error instanceof Error ? error.message : String(error),
        evidence: [],
      })
    })

    return { graph, order: running, started: true }
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

    // What each node is called, worked out where the order is in hand rather
    // than in the surface, so the chips and the blocked sentences agree.
    const labels = nodeLabels(order, graph)
    const name = (id: string): string => labels[id] ?? id

    return {
      graph,
      labels,
      ready: readyNodes(graph, budgets).map((n) => n.id),
      blocked: graph.nodes
        .map((n) => ({ id: n.id, reason: blockedReason(graph, n.id, name) }))
        .filter((b) => b.reason !== null),
      // What each lane is, what it shares, and what it is waiting for. Empty
      // for an order with nothing agreed yet, and one unremarkable row for a
      // single-repository order — the surface decides not to draw it.
      lanes:
        order === null
          ? []
          : laneViews(order).map((view) => ({
              ord: view.lane.ord,
              repo: view.lane.repo,
              role: view.lane.role,
              collisions: view.collisions,
              blockedBy: view.blockedBy,
              // Said as a sentence here rather than reassembled in the view,
              // so the reason the operator reads is the reason the rule gave.
              hold: mayMergeLane(order, view.lane.ord, []).reason,
            })),
    }
  }

  /**
   * Pick a halted run back up.
   *
   * The graph on disk is the run's state, so resuming is re-entering the
   * executor over it — there is no second notion of "where it got to" that
   * could disagree. A node the operator sent back is retried; everything else
   * carries on from where the wave stopped.
   *
   * Idempotent against a run that is already going: `execute` starts only what
   * the scheduler offers, and a running node is not offered.
   */
  async function resume(raw: unknown): Promise<unknown> {
    const parsed = ObservePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const order = await deps.store.load(parsed.data.id)
    if (order === null) return { error: `No order ${parsed.data.id}.` }
    if (order.status !== 'running') {
      return { error: `Only a running order can be resumed; this one is ${order.status}.` }
    }

    const graph = await loadGraph(parsed.data.id)
    if (graph === null) return { error: `No run for ${parsed.data.id}.` }
    if (order.recipe === null) return { error: `${order.id} has no recipe to resume.` }

    const resolved = resolveRecipe(order.recipe, deps.sources())
    if (!resolved.ok) return { error: resolved.reason }

    // Anything the operator sent back is offered again. Without this a failed
    // node stays failed and the resumed run has nothing to do — which reads
    // as "it finished" rather than "it never restarted".
    const retried = (parsed.data.retry ?? []).reduce((g, id) => retryNode(g, id), graph)
    await saveGraph(retried)

    if (deps.execute === undefined) {
      return { graph: retried, started: false, reason: 'The supervision runtime is not available.' }
    }
    void deps.execute(order, resolved.resolved.value, retried).catch(async (error: unknown) => {
      await deps.store.record({
        at: deps.now(),
        orderId: order.id,
        actor: 'rule:line',
        action: 'run.failed',
        subject: order.id,
        reason: error instanceof Error ? error.message : String(error),
        evidence: [],
      })
    })
    return { graph: retried, started: true }
  }

  async function recipes(raw: unknown): Promise<unknown> {
    const parsed = ObservePayload.safeParse(raw)
    if (!parsed.success) return { error: 'Malformed request.' }

    const order = await deps.store.load(parsed.data.id)
    if (order === null) return { error: `No order ${parsed.data.id}.` }

    const offered = availableNames('recipes', deps.sources()).map((name) => {
      const resolved = resolveRecipe(name, deps.sources())
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

    const proposal = proposeRecipe(order)
    return { recipes: offered, proposed: proposal.name, proposedWhy: proposal.why }
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

  return { start, resume, observe, recipes, attach }
}
