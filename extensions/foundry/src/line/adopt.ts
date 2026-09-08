import { orphanedNodes } from './reclaim.js'
import type { SessionLiveness } from './reclaim.js'
import { nodeLabel } from './run-graph.js'
import type { RunGraph } from './run-graph.js'
import { raiseGate } from '../gates/rules.js'
import type { Gate } from '../gates/rules.js'
import type { WorkOrder } from '../order/schema.js'

// What a fresh application finds when it opens on a run that never finished.
//
// An agent's terminal is a child of the process that started it, so nothing
// from a previous session survives — and nothing looked. The order stayed
// `running`, the graph stayed `running`, the Floor drew "building" chips, and
// the only way to learn that every agent had died with the application was to
// come back hours later and notice that nothing had moved.
//
// This is the looking. It is pure, so what counts as an interrupted run is a
// table rather than a branch buried in activation, and the sentence the
// operator reads is composed from the order's own words rather than from node
// ids.

export interface InterruptedRun {
  readonly orderId: string
  readonly title: string
  /** What was mid-flight, as a person would read it. Never node ids. */
  readonly stopped: readonly string[]
  readonly riskGrade: Gate['riskGrade']
  /** How much is held up behind it, for the inbox's ranking. */
  readonly blockedUnits: number
}

export interface RunOnDisk {
  readonly order: WorkOrder
  /** Null for a running order with no graph beside it, which is not a run. */
  readonly graph: RunGraph | null
}

/** Every run that says it is working and has nothing left working on it. */
export function interruptedRuns(
  runs: readonly RunOnDisk[],
  isLive: SessionLiveness
): InterruptedRun[] {
  const found: InterruptedRun[] = []
  for (const { order, graph } of runs) {
    if (order.status !== 'running' || graph === null) continue
    const orphans = orphanedNodes(graph, isLive)
    if (orphans.length === 0) continue
    found.push({
      orderId: order.id,
      title: order.title,
      stopped: orphans.map((node) => nodeLabel(order, node)),
      riskGrade: order.risk.grade,
      // What is held up: the orphans themselves plus everything still queued
      // behind them. A run stopped at its first step blocks the whole order.
      blockedUnits: graph.nodes.filter(
        (node) => node.state === 'waiting' || node.state === 'blocked'
      ).length,
    })
  }
  return found
}

/**
 * The row the operator sees, one per order.
 *
 * The id is derived from the order rather than sequenced, so opening the
 * application five times over a run nobody has answered leaves one row rather
 * than five — the gate store upserts by id.
 */
export function interruptedGate(run: InterruptedRun, at: string): Gate {
  return raiseGate({
    id: `${run.orderId}-run.interrupted`,
    rule: 'run.interrupted',
    orderId: run.orderId,
    summary: `${run.title} stopped when the application closed`,
    why:
      `${run.stopped.join(', ')} ${run.stopped.length === 1 ? 'was' : 'were'} still working when ` +
      `the application last closed, and an agent's terminal does not outlive it. Nothing is ` +
      `moving this run.`,
    riskGrade: run.riskGrade,
    blockedUnits: run.blockedUnits,
    at,
    // No deadline, ever. Every other default here declines to act; this one
    // would start agents in somebody's repository because they were at lunch.
    deadline: null,
  })
}
