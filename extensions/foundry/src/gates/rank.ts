import type { Gate } from './rules.js'

// One queue, always sorted.
//
// Ranked by how much work the decision unblocks, weighted by risk — so the
// thing that frees the most work sits at the top, and a P0 holding three units
// outranks a P0 holding none. That ordering is the entire user-interface
// argument: never a board to scan, never a judgement about what to look at
// first.

const RISK_WEIGHT: Record<Gate['riskGrade'], number> = { P0: 8, P1: 4, P2: 2, P3: 1 }

/**
 * Blocked units times risk weight.
 *
 * A gate that blocks nothing still ranks above zero, because a decision
 * waiting on nobody is still a decision — it just sits below anything that is
 * holding work up.
 */
export function rankOf(gate: Gate): number {
  return (gate.blockedUnits + 1) * RISK_WEIGHT[gate.riskGrade]
}

/** Undecided gates, most consequential first. */
export function rankInbox(gates: readonly Gate[]): Gate[] {
  return gates
    .filter((gate) => gate.decision === null)
    .map((gate) => ({ gate, rank: rankOf(gate) }))
    .sort((a, b) => b.rank - a.rank || a.gate.raisedAt.localeCompare(b.gate.raisedAt))
    .map(({ gate }) => gate)
}

export interface InboxSummary {
  readonly waiting: number
  readonly orders: number
  /** Decisions taken by a rule's default rather than by the operator. */
  readonly automatic: number
}

export function summariseInbox(gates: readonly Gate[]): InboxSummary {
  const waiting = gates.filter((g) => g.decision === null)
  return {
    waiting: waiting.length,
    orders: new Set(waiting.map((g) => g.orderId)).size,
    automatic: gates.filter((g) => g.decision?.by === 'default').length,
  }
}
