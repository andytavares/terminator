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

/**
 * A red-team finding raised after the order was agreed.
 *
 * It reopens the order like any other amendment. It gets no quieter path for
 * having arrived late — the whole value of the adversarial pass is that its
 * findings are as binding as anything else in the six checks.
 */
export function addRedTeamFinding(order: WorkOrder, finding: LateFinding): WorkOrder {
  return amendOrder(order, {
    reason: `red team raised ${finding.id}: ${finding.text}`,
    at: finding.at,
    change: (o) => ({
      ...o,
      redTeam: [
        ...o.redTeam,
        {
          id: finding.id,
          severity: finding.severity,
          text: finding.text,
          status: 'open' as const,
          reason: '',
        },
      ],
    }),
  })
}
