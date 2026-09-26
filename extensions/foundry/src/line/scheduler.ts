import { nodeById, withNode } from './run-graph.js'
import type { RunGraph, RunNode, Feedback } from './run-graph.js'
import type { Budgets } from '../order/schema.js'

// What may start now.
//
// Two rules carry almost everything: a node is ready only when everything it
// waits on has *passed*, and the number of things in flight never exceeds the
// agent budget the order agreed to. Both are pure functions of the graph, so
// "why is nothing running" is always answerable without watching it happen.

/** Occupying an agent right now. */
const IN_FLIGHT: readonly RunNode['state'][] = ['running', 'verifying']

export const MAX_ATTEMPTS = 2

export function inFlight(graph: RunGraph): RunNode[] {
  return graph.nodes.filter((n) => IN_FLIGHT.includes(n.state))
}

function dependenciesSettled(graph: RunGraph, node: RunNode): boolean {
  return node.dependsOn.every((id) => {
    const dependency = nodeById(graph, id)
    // A dependency that does not exist cannot be waited for; treat it as
    // settled rather than deadlocking the whole graph on a typo the recipe
    // parser already refuses.
    if (dependency === undefined) return true
    return dependency.state === 'passed' || dependency.state === 'skipped'
  })
}

function anyDependencyFailed(graph: RunGraph, node: RunNode): boolean {
  return node.dependsOn.some((id) => {
    const dependency = nodeById(graph, id)
    return (
      dependency !== undefined && (dependency.state === 'failed' || dependency.state === 'blocked')
    )
  })
}

/**
 * What could start, in graph order, limited by the agent budget.
 *
 * A gate never counts against the budget: it is waiting on a person, not
 * occupying an agent, and holding an agent slot open for a decision that might
 * take an hour would idle the factory.
 */
export function readyNodes(graph: RunGraph, budgets: Budgets): RunNode[] {
  const capacity =
    budgets.agents === null ? Infinity : Math.max(0, budgets.agents - inFlight(graph).length)
  const eligible = graph.nodes.filter(
    (n) => (n.state === 'waiting' || n.state === 'ready') && dependenciesSettled(graph, n)
  )
  const gates = eligible.filter((n) => n.kind === 'gate')
  const work = eligible.filter((n) => n.kind !== 'gate').slice(0, capacity)
  return [...gates, ...work]
}

/** Nodes that can never start because something they wait on failed. */
export function blockedNodes(graph: RunGraph): RunNode[] {
  return graph.nodes.filter(
    (n) => n.state !== 'passed' && n.state !== 'skipped' && anyDependencyFailed(graph, n)
  )
}

/**
 * Why this node is not running, in words. Null when it is running or done.
 *
 * `name` decides what the sentence calls the nodes it mentions. The reason the
 * operator reads is composed here rather than reassembled by a surface, so it
 * has to be able to use the surface's own names — otherwise the panel says
 * "waiting on n2" beside a chip labelled "builder · U-1".
 */
export function blockedReason(
  graph: RunGraph,
  id: string,
  name: (nodeId: string) => string = (nodeId) => nodeId
): string | null {
  const node = nodeById(graph, id)
  if (node === undefined) return null
  if (node.state !== 'waiting' && node.state !== 'ready' && node.state !== 'blocked') return null

  const failed = node.dependsOn.filter((dep) => {
    const dependency = nodeById(graph, dep)
    return (
      dependency !== undefined && (dependency.state === 'failed' || dependency.state === 'blocked')
    )
  })
  if (failed.length > 0) return `${failed.map(name).join(', ')} failed`

  const waiting = node.dependsOn.filter((dep) => {
    const dependency = nodeById(graph, dep)
    return (
      dependency !== undefined && dependency.state !== 'passed' && dependency.state !== 'skipped'
    )
  })
  if (waiting.length > 0) return `waiting on ${waiting.map(name).join(', ')}`
  return null
}

export interface StartResult {
  readonly graph: RunGraph
  readonly started: readonly string[]
}

/** Move everything that can start into `running`, honouring the budget. */
export function startReady(graph: RunGraph, budgets: Budgets, at: string): StartResult {
  let next = graph
  const started: string[] = []
  for (const node of readyNodes(graph, budgets)) {
    next = withNode(next, node.id, {
      state: 'running',
      startedAt: node.startedAt ?? at,
      attempts: node.attempts + 1,
    })
    started.push(node.id)
  }
  return { graph: next, started }
}

export function markPassed(graph: RunGraph, id: string, at: string): RunGraph {
  return withNode(graph, id, { state: 'passed', endedAt: at })
}

export interface FailResult {
  readonly graph: RunGraph
  /**
   * True when this failure has used up its retries and the next attempt is a
   * decision rather than another try. Thrash is expensive and invisible; this
   * is what makes it visible on the second bounce.
   */
  readonly needsDecision: boolean
}

export function markFailed(graph: RunGraph, id: string, at: string): FailResult {
  const node = nodeById(graph, id)
  if (node === undefined) return { graph, needsDecision: false }

  const exhausted = node.attempts >= MAX_ATTEMPTS
  let next = withNode(graph, id, { state: 'failed', endedAt: at })

  // Everything downstream is blocked rather than left waiting for ever, so the
  // surface can say why nothing is happening instead of showing a stalled graph.
  for (const dependent of next.nodes) {
    if (dependent.dependsOn.includes(id) && dependent.state === 'waiting') {
      next = withNode(next, dependent.id, { state: 'blocked' })
    }
  }
  return { graph: next, needsDecision: exhausted }
}

/** Put a failed node back in the queue — after a decision, never automatically. */
export function retry(graph: RunGraph, id: string): RunGraph {
  let next = withNode(graph, id, { state: 'waiting', endedAt: null })
  for (const dependent of next.nodes) {
    if (dependent.dependsOn.includes(id) && dependent.state === 'blocked') {
      next = withNode(next, dependent.id, { state: 'waiting' })
    }
  }
  return next
}

/** Every node id reachable from `id` by following `dependsOn` (its ancestors). */
function ancestorsOf(graph: RunGraph, id: string): Set<string> {
  const seen = new Set<string>()
  const stack = [...(nodeById(graph, id)?.dependsOn ?? [])]
  while (stack.length > 0) {
    const next = stack.pop() as string
    if (seen.has(next)) continue
    seen.add(next)
    stack.push(...(nodeById(graph, next)?.dependsOn ?? []))
  }
  return seen
}

/** Every node id that depends on `id`, directly or transitively (its descendants). */
function descendantsOf(graph: RunGraph, id: string): Set<string> {
  const seen = new Set<string>()
  let frontier = [id]
  while (frontier.length > 0) {
    const next = graph.nodes
      .filter((n) => !seen.has(n.id) && n.dependsOn.some((dep) => frontier.includes(dep)))
      .map((n) => n.id)
    for (const n of next) seen.add(n)
    frontier = next
  }
  return seen
}

/** Which targets take the work back, given where the failure landed. */
function reworkTargets(targets: readonly RunNode[], failedLane: number | null): RunNode[] {
  if (targets.some((t) => t.lane === failedLane)) {
    return targets.filter((t) => t.lane === failedLane)
  }
  if (failedLane === null) {
    const lanes = targets.map((t) => t.lane).filter((l): l is number => l !== null)
    if (lanes.length > 0) {
      const lowest = Math.min(...lanes)
      return targets.filter((t) => t.lane === lowest)
    }
  }
  return []
}

/**
 * Send a check's failure back to the step that has to answer it.
 *
 * The failed check and its targets go back to `waiting` with the failure
 * attached; anything the targets produced on the way to the failure — a
 * fmt between build and lint, say — is rerun too, but only what sits on
 * that path. Nothing downstream of the failure is touched, except a node a
 * previous failure had already blocked, which is unblocked the same way
 * `retry` unblocks one.
 */
export function rework(
  graph: RunGraph,
  failedId: string,
  targetStepId: string,
  feedback: Feedback
): RunGraph {
  const failed = nodeById(graph, failedId)
  if (failed === undefined) return graph

  const candidates = graph.nodes.filter((n) => n.stepId === targetStepId)
  if (candidates.length === 0) return graph
  const targets = reworkTargets(candidates, failed.lane)
  const chosen = targets.length > 0 ? targets : candidates

  const ancestorsOfFailed = ancestorsOf(graph, failedId)
  const between = new Set<string>()
  for (const target of chosen) {
    for (const id of descendantsOf(graph, target.id)) {
      if (ancestorsOfFailed.has(id)) between.add(id)
    }
  }

  const resetIds = new Set([...chosen.map((t) => t.id), ...between, failedId])

  let next = graph
  for (const target of chosen) {
    const current = nodeById(next, target.id) as RunNode
    next = withNode(next, target.id, {
      state: 'waiting',
      endedAt: null,
      feedback: [...current.feedback, feedback],
    })
  }
  for (const id of between) {
    next = withNode(next, id, { state: 'waiting', endedAt: null })
  }
  next = withNode(next, failedId, { state: 'waiting', endedAt: null, reworks: failed.reworks + 1 })

  for (const n of next.nodes) {
    if (n.state === 'blocked' && n.dependsOn.some((dep) => resetIds.has(dep))) {
      next = withNode(next, n.id, { state: 'waiting' })
    }
  }

  return next
}

export function isComplete(graph: RunGraph): boolean {
  return graph.nodes.every((n) => n.state === 'passed' || n.state === 'skipped')
}

export function hasStalled(graph: RunGraph, budgets: Budgets): boolean {
  return (
    !isComplete(graph) && inFlight(graph).length === 0 && readyNodes(graph, budgets).length === 0
  )
}

/** The budgets a run is held to. ADR 056 retired `files_touched`. */
export const BUDGET_KINDS = ['wall_clock', 'agents'] as const

export interface BudgetBreach {
  readonly kind: (typeof BUDGET_KINDS)[number]
  readonly limit: number
  readonly actual: number
}

/**
 * Budgets are part of the agreement, not advice.
 *
 * A breach pauses and asks; it never continues silently and never dies
 * silently, which are the two things that make an unattended run untrustworthy.
 */
export function budgetBreach(
  budgets: Budgets,
  observed: { elapsedMinutes: number; agents: number }
): BudgetBreach | null {
  const actual: Record<BudgetBreach['kind'], number> = {
    wall_clock: observed.elapsedMinutes,
    agents: observed.agents,
  }
  for (const kind of BUDGET_KINDS) {
    const limit = budgets[BUDGET_FIELD[kind]]
    if (limit !== null && actual[kind] > limit) return { kind, limit, actual: actual[kind] }
  }
  return null
}

const BUDGET_FIELD = {
  wall_clock: 'wallClockMinutes',
  agents: 'agents',
} as const satisfies Record<BudgetBreach['kind'], keyof Budgets>

/** The budgets with the one a breach named set to `limit`. Null is no limit. */
export function withLimit(
  budgets: Budgets,
  kind: BudgetBreach['kind'],
  limit: number | null
): Budgets {
  return { ...budgets, [BUDGET_FIELD[kind]]: limit }
}

/**
 * Why a raised limit would not let the run continue, or null when it would.
 *
 * A limit the run is already past halts it again on the next poll, which is a
 * decision that looks taken and changes nothing.
 */
export function raisedLimitProblem(breach: BudgetBreach, limit: number | null): string | null {
  if (limit === null || breach.actual <= limit) return null
  return `This run is already at ${Math.ceil(breach.actual)}, so a limit of ${limit} would stop it again straight away. Choose at least ${Math.ceil(breach.actual)}.`
}
