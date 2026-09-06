import type { WorkOrder } from './schema.js'

// Criteria against units, in both directions.
//
// This is the check the whole design leans on. Every expensive failure in this
// project's history has one shape — units that are individually right and
// collectively incomplete — and both halves of that are an intersection in
// this grid: a criterion no row reaches, or a column attached to nothing.
//
// It is deliberately a matrix rather than a judgement. Nobody has to read a
// plan carefully and notice what is missing; the gap is a coordinate.

export interface DanglingRef {
  readonly unitId: string
  readonly criterionId: string
}

export interface CoverageMatrix {
  readonly criteria: readonly string[]
  readonly units: readonly string[]
  /** `cells[criterion][unit]` — laid out so a surface can render it directly. */
  readonly cells: readonly (readonly boolean[])[]
  /** Criteria nothing builds. Unbuilt requirements. */
  readonly uncoveredCriteria: readonly string[]
  /** Units attached to nothing. Scope nobody asked for. */
  readonly orphanUnits: readonly string[]
  /** A unit claiming a criterion that does not exist — a rename gone wrong. */
  readonly danglingRefs: readonly DanglingRef[]
  readonly complete: boolean
  /** Why it is incomplete, when the answer is not a specific id. */
  readonly reason: string | null
}

export function coverageMatrix(order: WorkOrder): CoverageMatrix {
  const criteria = order.acceptance.map((a) => a.id)
  const units = order.plan.units.map((u) => u.id)
  const known = new Set(criteria)

  const danglingRefs: DanglingRef[] = []
  for (const unit of order.plan.units) {
    for (const criterionId of unit.satisfies) {
      if (!known.has(criterionId)) danglingRefs.push({ unitId: unit.id, criterionId })
    }
  }

  // A reference to a criterion that does not exist attaches nothing. Counting
  // it would let a typo satisfy the coverage check, which is precisely the
  // class of mistake this exists to catch.
  const cells = criteria.map((criterionId) =>
    order.plan.units.map((unit) => unit.satisfies.includes(criterionId))
  )

  const uncoveredCriteria = criteria.filter((_, row) => !cells[row].some(Boolean))
  const orphanUnits = order.plan.units
    .filter((unit) => !unit.satisfies.some((id) => known.has(id)))
    .map((unit) => unit.id)

  const reason =
    criteria.length === 0
      ? 'The order has no acceptance criteria, so there is nothing to prove.'
      : null

  return {
    criteria,
    units,
    cells,
    uncoveredCriteria,
    orphanUnits,
    danglingRefs,
    complete:
      reason === null &&
      uncoveredCriteria.length === 0 &&
      orphanUnits.length === 0 &&
      danglingRefs.length === 0,
    reason,
  }
}
