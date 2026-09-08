import { isLive } from './autonomy.js'
import { surfacedQuestions } from '../forge/interview.js'
import type { Autonomy } from './autonomy.js'
import type { Gate } from './rules.js'
import type { WorkOrder } from '../order/schema.js'

// How much is waiting for the operator, and on which surface.
//
// Foundry holds work for a person in three places — a gate in the inbox, an
// open question in the Forge, a held tool call on the Floor — and none of them
// used to say so anywhere the operator could see without first navigating to
// it. An interruption you have to go looking for is one that does not happen:
// the whole point of counting here rather than in each view is that the answer
// to "is anything waiting" is available on every surface at once.

export interface AttentionInput {
  readonly gates: readonly Gate[]
  readonly autonomy: Autonomy
  readonly orders: readonly WorkOrder[]
  /** Tool calls held at a PreToolUse hook, waiting to be allowed or denied. */
  readonly pendingAsks: number
}

export interface AttentionCounts {
  /** Undecided gates this autonomy setting still asks about. */
  readonly inbox: number
  /** Open questions across draft orders, plus every held tool call. */
  readonly forge: number
  /**
   * Open questions per order.
   *
   * A badge saying two is only actionable if the list underneath it says which
   * two orders are asking.
   */
  readonly byOrder: Record<string, number>
}

/**
 * What needs the operator right now.
 *
 * Questions are counted on draft orders only, because that is the only status
 * in which the Forge is answering them: once an order is agreed the plan is
 * fixed and a leftover question is history, not a request.
 */
export function countAttention(input: AttentionInput): AttentionCounts {
  const inbox = input.gates.filter(
    (gate) => gate.decision === null && isLive(gate.rule, input.autonomy)
  ).length

  const byOrder: Record<string, number> = {}
  for (const order of input.orders) {
    if (order.status !== 'draft') continue
    const open = surfacedQuestions(order.openQuestions).length
    if (open > 0) byOrder[order.id] = open
  }

  const questions = Object.values(byOrder).reduce((sum, n) => sum + n, 0)
  return { inbox, forge: questions + input.pendingAsks, byOrder }
}
