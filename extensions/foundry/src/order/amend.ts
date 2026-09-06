import type { WorkOrder } from './schema.js'

// Changing an agreed order.
//
// Two rules, and both cost something to break. The order goes back to draft
// and every check runs again — an agreement that can be edited after the fact
// is not an agreement. And no identifier ever changes: ledger entries,
// verdicts and gates all reference criteria and units by id, so renumbering on
// amendment would silently orphan the record of what actually happened.

export interface AmendInput {
  readonly reason: string
  readonly at: string
  /** Applied before the order returns to draft. Pure; must not renumber. */
  readonly change?: (order: WorkOrder) => WorkOrder
}

export function amendOrder(order: WorkOrder, input: AmendInput): WorkOrder {
  const changed = input.change === undefined ? order : input.change(order)
  return {
    ...changed,
    status: 'draft',
    agreedAt: null,
    provenance: {
      ...changed.provenance,
      amendments: [...changed.provenance.amendments, `${input.at} — ${input.reason}`],
    },
  }
}

export interface LateFinding {
  readonly id: string
  readonly severity: 'low' | 'medium' | 'high'
  readonly text: string
  readonly at: string
}
