/**
 * A run graph's node, for specs that put one on a graph by hand: an agent step
 * that has not started, with whatever the spec needs to differ.
 */
import type { RunNode } from '../../src/line/run-graph.js'

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
