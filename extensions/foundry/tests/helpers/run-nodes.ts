/**
 * A run graph and its nodes, for specs that put them together by hand: an
 * agent step that has not started, with whatever the spec needs to differ.
 */
import type { RunGraph, RunNode } from '../../src/line/run-graph.js'
import { partialFake } from '../../../../tests/support/fakes'

/** A waiting agent node whose step is its own id, with no unit, lane or history. */
export function agentNode(id: string, over: Partial<RunNode> = {}): RunNode {
  return {
    id,
    stepId: id,
    kind: 'agent',
    state: 'waiting',
    unitIds: [],
    lane: null,
    role: null,
    dependsOn: [],
    attempts: 0,
    reworks: 0,
    feedback: [],
    sessionId: null,
    worktreePath: null,
    startedAt: null,
    endedAt: null,
    ...over,
  }
}

/** A `direct` run graph of the order with no nodes yet. */
export function emptyRunGraph(orderId: string): RunGraph {
  return partialFake<RunGraph>({ orderId, recipe: 'direct', nodes: [] })
}
