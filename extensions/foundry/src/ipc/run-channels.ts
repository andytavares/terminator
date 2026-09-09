import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { orderDir, ensureWritable } from '../data-root.js'
import { laneViews, mayMergeLane } from '../order/lanes.js'
import { buildRunGraph, nodeLabels } from '../line/run-graph.js'
import type { RunGraph, RunNode } from '../line/run-graph.js'
import type { Recipe } from '../recipe/parse.js'
import { readyNodes, blockedReason, retry as retryNode } from '../line/scheduler.js'
import { reclaim, orphanedNodes } from '../line/reclaim.js'
import type { SessionLiveness } from '../line/reclaim.js'
import { resolveRecipe, availableNames } from '../recipe/resolve.js'
import type { Resolved, ResolveSources } from '../recipe/resolve.js'
import { checkRequirements } from '../recipe/requirements.js'
import type { OrderStore } from '../order/store.js'
import type { WorkOrder } from '../order/schema.js'
import { readStanding } from '../order/standing.js'
import type { Gate } from '../gates/rules.js'

// Starting a run.
//
// Everything that can refuse, refuses *before* any work begins: the order has
// to be agreed, the recipe has to be one this repository can actually support,
// and the records location has to be writable. An order that fails half way
// through because a directory could not be created has already spent agent
// time, and the message arrives attached to the wrong thing.

const StartPayload = z.object({
  id: z.string(),
  recipe: z.string().optional(),
  /** The operator's "Start anyway", against a backpressure refusal (FR-054). */
  force: z.boolean().optional(),
})
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
  /**
   * Whether there is room to start another agent (FR-053).
   *
   * The constraint is one person's capacity to review, which does not scale
   * with the number of orders. Absent means no runtime to ask, which is not a
   * reason to refuse a run.
   */
  readonly backpressure?: () => {
    allowed: boolean
    unreviewed: number
    limit: number
    reason: string | null
  }
  /** Record that the operator started anyway, with the depth they ignored. */
  readonly noteOverride?: (orderId: string) => void
  /**
   * Whether this process is still running that agent's session.
   *
   * Absent means there is nothing to ask, which is not "everything is fine" —
   * it is "nothing is running anything". A run whose agents died with the last
   * application is exactly that case, and answering it optimistically is what
   * left a reopened run drawing "building" chips for ever.
   */
  readonly isLive?: SessionLiveness
  /**
   * Whether an executor in this process is still driving that order.
   *
   * The race this closes: a node is marked `running` and written down before
   * its agent has reported a session, so for a second or two it looks exactly
   * like a node whose agent is gone. Reclaiming it there would launch a second
   * agent into the same worktree.
   */
  readonly executing?: (orderId: string) => boolean
  /**
   * Every gate raised against this order, decided or not.
   *
   * Here rather than left to the surface because a gate is what stops the
   * line, and a surface that has to fetch it separately is a surface that can
   * draw a run as busy while it has been halted for two hours. Absent means
   * no gate store to ask, which is not "no gates" — it is a host that never
   * raises any.
   */
  readonly gatesFor?: (orderId: string) => Promise<readonly Gate[]>
  /** Tool calls this order's agents are holding. No runtime means none. */
  readonly asksFor?: (orderId: string) => number
  /**
   * Runs of this order the stall detector has fired on and acted on.
   *
   * Shadow firings are recorded and deliberately never notified, so they are
   * not counted here: a standing is a notification.
   */
  readonly stallsFor?: (orderId: string) => number
  /** Agents of this order parked at their terminal's own prompt. */
  readonly strandedFor?: (orderId: string) => number
  /**
   * Which sessions those are.
   *
   * The count says what is wrong; these are what the one move needs — a
   * handed-back call can only be answered in the terminal it was handed to.
   */
  readonly strandedSessions?: (orderId: string) => readonly string[]
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

/**
 * Read one back.
 *
 * Here rather than beside its caller for the reason `writeRunGraph` is: two
 * files claiming to be the run's state is worse than one, and two functions
 * disagreeing about where that file lives is how it would happen.
 */
export async function readRunGraph(dataRoot: string, orderId: string): Promise<RunGraph | null> {
  try {
    const raw = JSON.parse(
      await fs.promises.readFile(graphPath(dataRoot, orderId), 'utf8')
    ) as RunGraph
    return { ...raw, nodes: raw.nodes.map(withUnitIds) }
  } catch {
    // A missing or unreadable graph is "no run", never a thrown surface.
    return null
  }
}

/**
 * A node from a graph written before a fan-out node could carry a whole lane.
 *
 * Those graphs have `unitId`, a single value, and nothing else on disk says so
 * — `readRunGraph` casts unvalidated JSON. A run left in flight when the
 * application closed is picked back up by reading exactly this file, so the
 * one place worth converting is the boundary that reads it: everything past
 * here then sees one shape.
 */
function withUnitIds(node: RunNode): RunNode {
  if (Array.isArray(node.unitIds)) return node
  const legacy = (node as unknown as { unitId?: string | null }).unitId ?? null
  return { ...node, unitIds: legacy === null ? [] : [legacy] }
}

/** A proposed shape and the reason it fits this order (FR-014). */
export interface ProposedRecipe {
  readonly name: string
  readonly why: string
}

/**
 * Choose a shape when the operator has not, and say why.
 *
 * Deliberately simple and stated out loud rather than clever, and the operator
 * overrides in one click with the override recorded — a proposal nobody can
 * predict is worse than a plain one.
 *
 * Two questions, in order. **How many lanes**, because a lane is a worktree
 * and a branch, and it is the only thing a heavier shape can genuinely run in
 * parallel. Then **what the order says about itself**: the grade and whether
 * any trigger fired, which is the order's own statement of who ought to look
 * at it before it ships.
 *
 * Unit count decides nothing any more. A fan-out is `by lane`, so seven units
 * in one lane cost one session; pricing the shape off them charged for
 * parallelism that never existed and put a seven-unit stylesheet change into
 * the heaviest shape there is.
 *
 * The reason travels with the name because a shape decides how many agents
 * run, what gets verified and whether a pull request opens at the end. An
 * operator asked to accept or override that needs the grounds, not just the
 * answer.
 */
export function recipeLadder(order: WorkOrder): ProposedRecipe[] {
  if (order.recipe !== null) {
    return [{ name: order.recipe, why: 'the order already names this shape' }]
  }

  const lanes = new Set(order.plan.units.map((unit) => unit.lane)).size
  const heaviest: ProposedRecipe =
    lanes > 1
      ? { name: 'standard', why: `${lanes} lanes of work` }
      : {
          name: 'standard',
          why: `graded ${order.risk.grade}, which is above the direct shape's ceiling`,
        }
  if (lanes > 1) return [heaviest]

  const { grade, triggers } = order.risk
  const direct: ProposedRecipe = {
    name: 'direct',
    why:
      triggers.length === 0
        ? `one lane, graded ${grade}`
        : `one lane graded ${grade}, and ${triggers.join(', ')} fired`,
  }

  if (grade === 'P3' && triggers.length === 0) {
    // `quick` needs a test command and `direct` does not, so the fallback is
    // not decoration: in a repository with no suite, `quick`'s only check does
    // not exist, and proposing a shape that cannot run here would refuse the
    // run rather than choose a shape that can.
    return [{ name: 'quick', why: 'one lane, graded P3, nothing flagged' }, direct]
  }
  if (grade === 'P2' || grade === 'P3') return [direct]
  return [heaviest]
}

/** The lightest shape that fits, ignoring whether this repository can run it. */
export function proposeRecipe(order: WorkOrder): ProposedRecipe {
  return recipeLadder(order)[0]
}

type FittedRecipe =
  | { readonly proposal: ProposedRecipe; readonly fitted: Resolved<Recipe> }
  | { readonly error: string }

/**
 * The first shape on the ladder this repository can actually run.
 *
 * The reason a *ladder* exists rather than one answer: a shape's requirements
 * are about the repository and the proposal is about the order, so the two
 * can disagree. Where they do, the lighter shape stepping down to a heavier
 * one is the right answer; refusing the run is not. An unmet requirement on
 * the last rung is still an error — silently running something that meets none
 * of them would be worse than saying so.
 */
function fitRecipe(
  ladder: readonly ProposedRecipe[],
  order: WorkOrder,
  sources: ResolveSources
): FittedRecipe {
  const reasons: string[] = []
  for (const proposal of ladder) {
    const resolved = resolveRecipe(proposal.name, sources)
    if (!resolved.ok) {
      reasons.push(resolved.reason)
      continue
    }
    const availability = checkRequirements(resolved.resolved.value.requires, order)
    if (availability.available) return { proposal, fitted: resolved.resolved }
    reasons.push(`the "${proposal.name}" shape cannot run here: ${availability.unmet.join('; ')}`)
  }
  return { error: `${reasons.join('. ')}.` }
}

export function createRunChannels(deps: RunDeps): RunChannels {
  // Nothing to ask means nothing is running it. The optimistic reading is what
  // made a reopened run look like a working one.
  const isLive: SessionLiveness = (sessionId) => deps.isLive?.(sessionId) ?? false

  /**
   * The nodes nothing is running, for one order.
   *
   * Empty while an executor in this process is driving the order, because a
   * node marked `running` before its agent has reported a session is
   * indistinguishable from one whose agent is gone — and only one of those is
   * safe to restart.
   */
  function orphansOf(orderId: string, graph: RunGraph): string[] {
    if (deps.executing?.(orderId) === true) return []
    return orphanedNodes(graph, isLive).map((node) => node.id)
  }

  async function saveGraph(graph: RunGraph): Promise<void> {
    await writeRunGraph(deps.dataRoot(), graph)
  }

  async function loadGraph(orderId: string): Promise<RunGraph | null> {
    return readRunGraph(deps.dataRoot(), orderId)
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

    // Refused before anything is cut, with the reason and the depth — and
    // overridable, which is the half that did not exist: the gate was built,
    // the Floor showed its verdict, and `run.start` never asked it, so runs
    // began regardless and the override had nothing to override.
    const room = deps.backpressure?.() ?? null
    if (room !== null && !room.allowed && parsed.data.force !== true) {
      return {
        error: room.reason ?? 'There is too much waiting to be reviewed.',
        backpressure: room,
      }
    }
    if (room !== null && !room.allowed) {
      deps.noteOverride?.(order.id)
      await deps.store.record({
        at: deps.now(),
        orderId: order.id,
        actor: 'operator',
        action: 'backpressure.overridden',
        subject: order.id,
        // What they chose to ignore, at the moment they ignored it.
        reason: `started anyway with ${room.unreviewed} waiting to be reviewed (limit ${room.limit})`,
        evidence: [],
      })
    }

    const chosenByOperator = parsed.data.recipe !== undefined
    // An operator's choice is honoured or refused, never quietly swapped. A
    // *proposal* walks its own ladder instead: proposing a shape this
    // repository cannot run would refuse the run over a decision nobody made.
    const ladder = chosenByOperator
      ? [{ name: parsed.data.recipe as string, why: 'chosen by the operator' }]
      : recipeLadder(order)

    const fitted = fitRecipe(ladder, order, deps.sources())
    if ('error' in fitted) return { error: fitted.error }
    const { proposal, fitted: recipe } = fitted
    const name = proposal.name

    const graph = buildRunGraph(order, recipe.value)
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
      }; recipe resolved from ${recipe.rung}`,
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
    void deps.execute(running, recipe.value, graph).catch(async (error: unknown) => {
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

    const orphaned = orphansOf(parsed.data.id, graph)
    const gates = await (deps.gatesFor?.(parsed.data.id) ?? Promise.resolve([]))
    const waiting = gates.filter((gate) => gate.decision === null)

    return {
      graph,
      labels,
      // What the operator called it. The surface's heading was the order id
      // and the recipe name — two identifiers nobody chose — so the screen
      // showing a run never said which piece of work it was.
      title: order?.title ?? null,
      // Where this order stands, and whose move it is, decided once here
      // rather than five times over in five surfaces from whatever each of
      // them happened to hold.
      // Through `readStanding` with what is already in hand rather than a
      // second assembly of the same inputs: two callers assembling them
      // separately is how the order list and this surface came to describe
      // one halted run as "ready to hand off" and "building" at once.
      standing: await readStanding(
        order ?? ({ id: parsed.data.id, status: 'running' } as WorkOrder),
        {
          graphFor: async () => graph,
          gatesFor: async () => gates,
          asksFor: deps.asksFor,
          stallsFor: deps.stallsFor,
          strandedFor: deps.strandedFor,
          orphansFor: () => orphaned,
        }
      ),
      // The agents waiting at a terminal prompt, so the band can offer the one
      // move that answers a handed-back call: going to that terminal.
      stranded: deps.strandedSessions?.(parsed.data.id) ?? [],
      // The gates holding it, in full. A band that says "halted at a gate" and
      // cannot offer the gate's own options is the wall this replaces.
      waiting,
      // What the graph calls running and nothing is actually running. A
      // surface that cannot tell those apart shows a dead run as a busy one,
      // which is how an interrupted run went unnoticed for hours.
      orphaned,
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

    // Whatever was left mid-flight by an application that closed comes back
    // first. Without this the scheduler has nothing to offer — it offers only
    // `waiting` and `ready` — so a resumed run started nothing and said
    // nothing, which reads exactly like a run that had finished.
    const taken =
      deps.executing?.(order.id) === true ? { graph, reclaimed: [] } : reclaim(graph, isLive)
    if (taken.reclaimed.length > 0) {
      await deps.store.record({
        at: deps.now(),
        orderId: order.id,
        actor: 'rule:line',
        action: 'run.reclaimed',
        subject: order.id,
        reason: `${taken.reclaimed.join(', ')} had no agent left and were put back in the queue`,
        evidence: [],
      })
    }

    // Anything the operator sent back is offered again. Without this a failed
    // node stays failed and the resumed run has nothing to do — which reads
    // as "it finished" rather than "it never restarted".
    const retried = (parsed.data.retry ?? []).reduce((g, id) => retryNode(g, id), taken.graph)
    await saveGraph(retried)

    if (deps.execute === undefined) {
      return {
        graph: retried,
        reclaimed: taken.reclaimed,
        started: false,
        reason: 'The supervision runtime is not available.',
      }
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
    return { graph: retried, reclaimed: taken.reclaimed, started: true }
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

    // The same walk `start` does, so the shape the surface shows is the shape
    // that would run.
    const fitted = fitRecipe(recipeLadder(order), order, deps.sources())
    const proposal = 'error' in fitted ? proposeRecipe(order) : fitted.proposal
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
    // A session id outlives the process that ran it, so handing one back
    // unchecked sent the operator to a terminal that no longer exists.
    if (!isLive(node.sessionId) && deps.executing?.(parsed.data.orderId) !== true) {
      return {
        error: `${node.id} has no live agent — its session ended when the application last closed. Resume the run to start it again.`,
      }
    }
    return { terminalSessionId: node.sessionId, nodeId: node.id }
  }

  return { start, resume, observe, recipes, attach }
}
