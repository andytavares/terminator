import { withNode } from './run-graph.js'
import type { RunGraph, RunNode } from './run-graph.js'

// Taking back the nodes whose agent is gone.
//
// An agent runs in a terminal that is a child of this process, so quitting the
// application kills every one of them — while `run-graph.json` goes on saying
// `running`. Nothing reclaimed those nodes, and nothing could: the scheduler
// offers only `waiting` and `ready`, and `hasStalled` is false while anything
// is in flight. So a reopened run raised no gate, started nothing, and drew
// "building" chips for ever. Resuming it did nothing, because there was
// nothing the scheduler would offer.
//
// The question this asks is not "is the terminal still open" but "is anything
// in this process still running that node". They differ in exactly the case
// that matters: a wave the executor abandoned leaves agents in their terminals
// that nobody is collecting, and a node nobody is collecting is a dead node
// however alive its terminal looks.

/** Occupying an agent, as far as the graph is concerned. */
export const IN_FLIGHT: readonly RunNode['state'][] = ['running', 'verifying']

/**
 * Whether this process is still running that session.
 *
 * A null session is never live: the node was started and no agent ever
 * reported one, so nothing anywhere can be running it.
 */
export type SessionLiveness = (sessionId: string) => boolean

export interface Reclaimed {
  readonly graph: RunGraph
  /** What was taken back, in graph order. Empty means the graph is untouched. */
  readonly reclaimed: readonly string[]
}

export function orphanedNodes(graph: RunGraph, isLive: SessionLiveness): RunNode[] {
  return graph.nodes.filter(
    (node) => IN_FLIGHT.includes(node.state) && (node.sessionId === null || !isLive(node.sessionId))
  )
}

/**
 * Put every orphaned node back where the scheduler can offer it again.
 *
 * The attempt is given back. The counter exists to catch an agent thrashing on
 * the same check — two failures and the third is a decision — and an
 * application that closed is not the agent's doing. Without this a run
 * interrupted twice would turn its next genuine failure straight into a
 * question, which is the wrong question at the wrong time.
 *
 * The session id stays on the node. It is what lets a resumed run continue the
 * conversation the agent was having rather than start a cold one that has read
 * nothing — the transcript outlives the process that wrote it.
 */
export function reclaim(graph: RunGraph, isLive: SessionLiveness): Reclaimed {
  const orphans = orphanedNodes(graph, isLive)
  if (orphans.length === 0) return { graph, reclaimed: [] }

  let next = graph
  for (const node of orphans) {
    next = withNode(next, node.id, {
      state: 'waiting',
      attempts: Math.max(0, node.attempts - 1),
      endedAt: null,
    })
    // Whatever it was holding up goes back to waiting with it, or the resumed
    // run reclaims the node and still reports everything downstream blocked.
    for (const dependent of next.nodes) {
      if (dependent.dependsOn.includes(node.id) && dependent.state === 'blocked') {
        next = withNode(next, dependent.id, { state: 'waiting' })
      }
    }
  }
  return { graph: next, reclaimed: orphans.map((node) => node.id) }
}
