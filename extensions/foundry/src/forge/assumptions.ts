import type { Assumption, WorkOrder } from '../order/schema.js'

// Assumptions are how the Forge decides things without asking.
//
// The bargain only works if striking one is cheap and precise. A strike that
// redrew the whole order would make correcting a single detail cost the
// operator everything they had already settled, and they would stop striking —
// which turns every stated assumption back into an unstated guess.

export interface StrikeResult {
  readonly order: WorkOrder
  /** Exactly what has to be redrawn. Nothing else may be touched. */
  readonly redraw: readonly string[]
}

/** The assumptions the operator still has to scan. */
export function liveAssumptions(order: WorkOrder): Assumption[] {
  return order.assumptions.filter((a) => !a.struck)
}

/**
 * Strike an assumption, and say what that invalidates.
 *
 * The order goes back to draft because the plan is about to change and an
 * agreed order whose plan is being redrawn is not an agreement any more.
 * Striking something already struck is a no-op with an empty redraw list, so a
 * double click costs nothing.
 */
export function strikeAssumption(order: WorkOrder, assumptionId: string): StrikeResult {
  const assumption = order.assumptions.find((a) => a.id === assumptionId)
  if (assumption === undefined || assumption.struck) {
    return { order, redraw: [] }
  }

  return {
    order: {
      ...order,
      status: 'draft',
      agreedAt: null,
      assumptions: order.assumptions.map((a) =>
        a.id === assumptionId ? { ...a, struck: true } : a
      ),
    },
    redraw: [...assumption.affects],
  }
}
