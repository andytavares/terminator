import { nodeById, withNode } from './run-graph.js'
import type { RunGraph, RunNode } from './run-graph.js'
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
  const capacity = Math.max(0, budgets.agents - inFlight(graph).length)
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

export function isComplete(graph: RunGraph): boolean {
  return graph.nodes.every((n) => n.state === 'passed' || n.state === 'skipped')
}

export function hasStalled(graph: RunGraph, budgets: Budgets): boolean {
  return (
    !isComplete(graph) && inFlight(graph).length === 0 && readyNodes(graph, budgets).length === 0
  )
}

export interface BudgetBreach {
  readonly kind: 'wall_clock' | 'files_touched' | 'agents'
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
  observed: { elapsedMinutes: number; filesTouched: number; agents: number }
): BudgetBreach | null {
  if (observed.elapsedMinutes > budgets.wallClockMinutes) {
    return {
      kind: 'wall_clock',
      limit: budgets.wallClockMinutes,
      actual: observed.elapsedMinutes,
    }
  }
  if (observed.filesTouched > budgets.filesTouched) {
    return { kind: 'files_touched', limit: budgets.filesTouched, actual: observed.filesTouched }
  }
  if (observed.agents > budgets.agents) {
    return { kind: 'agents', limit: budgets.agents, actual: observed.agents }
  }
  return null
}
