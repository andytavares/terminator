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
  const match = /^plan\.units(?:\[(\w+)=([\w.-]+)\])?$/.exec(expression.trim())
  if (match === null) return []
  const [, field, value] = match
  if (field === undefined) return [...order.plan.units]
  return order.plan.units.filter((unit) => {
    const actual = (unit as unknown as Record<string, unknown>)[field]
    return String(actual) === value
  })
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
