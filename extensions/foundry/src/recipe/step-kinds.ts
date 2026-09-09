import type { PlanUnit, WorkOrder } from '../order/schema.js'

// The small language a recipe is allowed to speak.
//
// `over`, `when` and `expect` accept a path into the order, an optional filter
// and a comparison. That is all, deliberately. A recipe that needs arbitrary
// logic wants a *role* — a prompt and an output schema — not code in a data
// file, and the moment this grows an `if` it has become a scripting language
// nobody asked for and everybody has to learn.

export interface ExpectFailure {
  readonly key: string
  readonly expected: string
  readonly actual: unknown
}

/** `plan.units`, optionally filtered: `plan.units[role=builder]`. */
export function selectOver(expression: string, order: WorkOrder): PlanUnit[] {
  const match = /^plan\.units(?:\[(\w+)=([\w.-]+)\])?(?:\s+by\s+lane)?$/.exec(expression.trim())
  if (match === null) return []
  const [, field, value] = match
  if (field === undefined) return [...order.plan.units]
  return order.plan.units.filter((unit) => {
    const actual = (unit as unknown as Record<string, unknown>)[field]
    return String(actual) === value
  })
}

/** Whether a fan-out expression asked to be grouped: `… by lane`. */
export function groupsByLane(expression: string): boolean {
  return /\s+by\s+lane$/.test(expression.trim())
}

/**
 * What one fan-out node covers.
 *
 * A plain fan-out gives one target per unit. `by lane` gives one per lane,
 * carrying that lane's units in dependency order.
 */
export interface FanoutTarget {
  /** The suffix the node is named with: a unit id, or `lane-N`. */
  readonly id: string
  readonly units: readonly PlanUnit[]
  readonly lane: number | null
}

/**
 * The nodes a fan-out should produce.
 *
 * `by lane` exists because a fan-out is a claim that work can happen at the
 * same time, and units inside one lane cannot: they share a worktree and a
 * branch, and the plan's own `dependsOn` usually orders them anyway. Measured
 * on WO-0907-3c1 — seven units, one lane — the run spent seven cold agent
 * sessions re-reading one repository to do work that was serial in one
 * checkout. Grouping keeps the plan's detail, which the brief still lists,
 * and stops charging a process for it.
 */
export function fanoutTargets(expression: string, order: WorkOrder): FanoutTarget[] {
  const units = selectOver(expression, order)
  if (!groupsByLane(expression)) {
    return units.map((unit) => ({ id: unit.id, units: [unit], lane: unit.lane }))
  }

  // Insertion-ordered by first appearance, so a plan that lists lane 2 first
  // gets lane 2 first — the recipe never reorders what the plan decided.
  const byLane = new Map<number, PlanUnit[]>()
  for (const unit of units) {
    const existing = byLane.get(unit.lane)
    if (existing === undefined) byLane.set(unit.lane, [unit])
    else existing.push(unit)
  }
  return [...byLane].map(([lane, laneUnits]) => ({
    id: `lane-${lane}`,
    units: inDependencyOrder(laneUnits),
    lane,
  }))
}

/**
 * A lane's units in the order one agent should do them.
 *
 * The plan's `dependsOn` is the whole answer where it is stated; where two
 * units do not constrain each other the plan's own order stands. A cycle — or
 * a dependency on a unit outside this lane — leaves the remainder in plan
 * order rather than throwing, because a graph that cannot be built is a run
 * that cannot start, and the compile gate is where a bad plan is refused.
 */
function inDependencyOrder(units: readonly PlanUnit[]): PlanUnit[] {
  const here = new Set(units.map((unit) => unit.id))
  const placed = new Set<string>()
  const ordered: PlanUnit[] = []
  let remaining = [...units]

  while (remaining.length > 0) {
    const ready = remaining.filter((unit) =>
      unit.dependsOn.every((id) => !here.has(id) || placed.has(id))
    )
    // Nothing is ready: the rest depend on each other. Keep plan order.
    if (ready.length === 0) return [...ordered, ...remaining]
    for (const unit of ready) {
      ordered.push(unit)
      placed.add(unit.id)
    }
    remaining = remaining.filter((unit) => !placed.has(unit.id))
  }
  return ordered
}

/** The collections `when` can ask about. Nothing else is reachable. */
function collectionAt(path: string, order: WorkOrder): unknown[] | null {
  switch (path) {
    case 'risk.triggers':
      return [...order.risk.triggers]
    case 'plan.units':
      return [...order.plan.units]
    case 'plan.lanes':
      return [...order.plan.lanes]
    case 'plan.sharedFiles':
      return [...order.plan.sharedFiles]
    case 'acceptance':
      return [...order.acceptance]
    case 'openQuestions':
      return [...order.openQuestions]
    default:
      return null
  }
}

/**
 * `risk.triggers is not empty`, `plan.lanes count > 1`.
 *
 * An expression this cannot parse is **false**, never true: a step that runs
 * because nobody could read its condition is worse than one that does not run.
 */
export function evaluateWhen(expression: string | undefined, order: WorkOrder): boolean {
  if (expression === undefined || expression.trim() === '') return true

  const emptiness = /^([\w.]+)\s+is\s+(not\s+)?empty$/.exec(expression.trim())
  if (emptiness !== null) {
    const items = collectionAt(emptiness[1], order)
    if (items === null) return false
    return emptiness[2] === undefined ? items.length === 0 : items.length > 0
  }

  const count = /^([\w.]+)\s+count\s+(>=|<=|>|<|==|!=)\s+(\d+)$/.exec(expression.trim())
  if (count !== null) {
    const items = collectionAt(count[1], order)
    if (items === null) return false
    return compareNumbers(items.length, count[2], Number(count[3]))
  }

  return false
}

function compareNumbers(left: number, operator: string, right: number): boolean {
  switch (operator) {
    case '>=':
      return left >= right
    case '<=':
      return left <= right
    case '>':
      return left > right
    case '<':
      return left < right
    case '==':
      return left === right
    case '!=':
      return left !== right
    default:
      return false
  }
}

/**
 * What a step promised about its own result.
 *
 * This is how the bugfix recipe says a reproduction has to *fail* before the
 * fix exists — `suite_exit_code: '!= 0'` — which is the one place a passing
 * command is the wrong answer.
 */
export function checkExpect(
  expected: Record<string, unknown> | undefined,
  actual: Record<string, unknown>
): ExpectFailure[] {
  if (expected === undefined) return []
  const failures: ExpectFailure[] = []

  for (const [key, raw] of Object.entries(expected)) {
    const want = String(raw).trim()
    const got = actual[key]
    const comparison = /^(>=|<=|>|<|==|!=)\s*(-?\d+)$/.exec(want)

    if (comparison !== null) {
      const number = typeof got === 'number' ? got : Number(got)
      if (Number.isNaN(number) || !compareNumbers(number, comparison[1], Number(comparison[2]))) {
        failures.push({ key, expected: want, actual: got })
      }
      continue
    }

    // No operator: an equality against the literal, compared as text so a
    // recipe author never has to think about quoting.
    if (String(got) !== want) failures.push({ key, expected: want, actual: got })
  }

  return failures
}
