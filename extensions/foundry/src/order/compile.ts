import { coverageMatrix } from './coverage-matrix.js'
import { collidingLanes, planLanes, sharedFilesFor } from './lanes.js'
import type { WorkOrder } from './schema.js'

// The five checks that decide whether an order may be handed off.
//
// The point of writing them here, as one pure function over the order, is that
// "ironed out" stops being a feeling. There is no reading of the plan involved
// and no judgement to disagree with: five conditions, each of which can fail,
// each of which names the specific criterion, unit or question responsible.
//
// Every check has teeth. A check that cannot fail is decoration, and
// decoration inside a gate is worse than no gate at all, because it teaches
// the operator to trust a green they did not earn.

export const CHECK_IDS = ['questions', 'verifiable', 'coverage', 'risk', 'redTeam'] as const

export type CheckId = (typeof CHECK_IDS)[number]

export interface CompileFailure {
  readonly check: CheckId
  /** What is wrong, in words the operator can act on. */
  readonly detail: string
  /** The criteria, units or questions responsible. FR-011 wants the specifics. */
  readonly subjectIds: readonly string[]
}

export interface CompileResult {
  readonly ok: boolean
  readonly failures: readonly CompileFailure[]
}

/** Whether a path sits inside any declared prefix. Prefix match, not a glob. */
function inside(path: string, radius: readonly string[]): boolean {
  return radius.some((prefix) => path === prefix || path.startsWith(prefix))
}

function checkQuestions(order: WorkOrder): CompileFailure | null {
  const open = order.openQuestions.filter((q) => q.answer === null)
  if (open.length === 0) return null
  return {
    check: 'questions',
    detail: `${open.length} question${open.length === 1 ? '' : 's'} still unanswered.`,
    subjectIds: open.map((q) => q.id),
  }
}

/**
 * A criterion is falsifiable when something can actually decide it: a command
 * with an exit status, a named test, or a rubric with named evidence.
 *
 * The escape hatch is deliberate and expensive — an operator may accept a
 * criterion as unverifiable, but only in writing, and the reason travels with
 * the order.
 */
/** Files a person looks at. A change to one is a change somebody can see. */
const UI_FILE = /\.(tsx|jsx|vue|svelte|css|scss|html)$/

/**
 * A change somebody can see needs a picture of it (FR-040).
 *
 * Not a rule about screenshots for their own sake: every UI failure in this
 * project's history passed its structural assertions first, and a criterion
 * proved by a command cannot say whether the thing renders. The escape is the
 * same one every criterion has — accept it as unverifiable, in writing.
 *
 * **One picture closes it, and the failure has to say so.** A check that names
 * what is missing without naming what is enough gets over-served. Measured on
 * WO-0910-1fb, an order whose whole content was "make all text red": this
 * fired because the plan touched CSS, and the architect closed it by inventing
 * three screenshot criteria across five extension views in two themes. The
 * coverage check then pulled all five of those views into the unit's `touches`
 * to keep the matrix complete, and a one-line ask became a 41-file plan the
 * builder spent fifty-three minutes on. Every one of those steps was a check
 * working exactly as written.
 */
function checkPicture(order: WorkOrder): CompileFailure | null {
  const seen = order.plan.units.filter((unit) => unit.touches.some((p) => UI_FILE.test(p)))
  if (seen.length === 0) return null

  const pictured = order.acceptance.some(
    (criterion) =>
      criterion.unverifiable?.accepted === true ||
      criterion.verify.kind === 'screenshot' ||
      (criterion.verify.kind === 'judge' && criterion.verify.evidence.includes('screenshot'))
  )
  if (pictured) return null

  return {
    check: 'verifiable',
    detail: `${seen.map(unitName).join(', ')} change${seen.length === 1 ? 's' : ''} what a person sees, and no criterion asks for a picture of the running application. A command cannot say whether it renders. One such criterion closes this — of a surface the plan already touches, not of new ones added to satisfy it, because every surface a criterion names is one the plan then has to touch to stay covered.`,
    subjectIds: seen.map((unit) => unit.id),
  }
}

function checkVerifiable(order: WorkOrder): CompileFailure | null {
  const unprovable = order.acceptance.filter((criterion) => {
    if (criterion.unverifiable?.accepted === true) return false
    const verify = criterion.verify
    switch (verify.kind) {
      case 'test':
      case 'command':
        return verify.command.trim() === ''
      case 'judge':
        return verify.rubric.trim() === '' || verify.evidence.length === 0
      case 'artifact':
        return verify.path.trim() === ''
      case 'screenshot':
        return verify.target.trim() === ''
    }
  })
  if (unprovable.length === 0) return null
  return {
    check: 'verifiable',
    detail:
      'A criterion has no executable proof. Give it a command, a named test, or a rubric with evidence — or accept it as unverifiable in writing.',
    subjectIds: unprovable.map((c) => c.id),
  }
}

// A person reads these on the Plan step, so a criterion or unit is named by
// what it says; the id is a fallback for one written with no text.
function quoted(text: string, id: string): string {
  return text.trim() === '' ? id : `“${text.trim()}”`
}

function unitName(unit: WorkOrder['plan']['units'][number]): string {
  return quoted(unit.title, unit.id)
}

function checkCoverage(order: WorkOrder): CompileFailure | null {
  const matrix = coverageMatrix(order)
  if (matrix.complete) return null

  const parts: string[] = []
  if (matrix.reason !== null) parts.push(matrix.reason)
  if (matrix.uncoveredCriteria.length > 0) {
    const names = order.acceptance
      .filter((c) => matrix.uncoveredCriteria.includes(c.id))
      .map((c) => quoted(c.statement, c.id))
    parts.push(`Nothing in the plan builds ${names.join(', ')}.`)
  }
  if (matrix.orphanUnits.length > 0) {
    const names = order.plan.units.filter((u) => matrix.orphanUnits.includes(u.id)).map(unitName)
    parts.push(`${names.join(', ')} satisf${names.length === 1 ? 'ies' : 'y'} no criterion.`)
  }
  for (const ref of matrix.danglingRefs) {
    const unit = order.plan.units.find((u) => u.id === ref.unitId)
    const name = unit === undefined ? ref.unitId : unitName(unit)
    parts.push(`${name} claims a criterion that does not exist (${ref.criterionId}).`)
  }

  return {
    check: 'coverage',
    detail: parts.join(' '),
    subjectIds: [
      ...matrix.uncoveredCriteria,
      ...matrix.orphanUnits,
      ...matrix.danglingRefs.map((r) => r.unitId),
    ],
  }
}

/**
 * Two lanes touching one file, and nobody said which of them owns it.
 *
 * Folded into `coverage` rather than given a seventh check, because it is the
 * same question that check already asks: does the plan account for everything
 * it has to. A collision with no producer is a plan that has not decided the
 * merge order, and discovering that at merge time means discovering it as a
 * conflict.
 *
 * Runs only when there is a collision, so a single-repository order — and a
 * multi-repository one whose lanes touch nothing in common — never sees it.
 */
function checkLaneOwnership(order: WorkOrder): CompileFailure | null {
  const shared = sharedFilesFor(order)
  if (shared.length === 0) return null

  const involved = collidingLanes(order, shared)
  const producers = order.plan.lanes.filter(
    (lane) => lane.role === 'producer' && involved.includes(lane.ord)
  )
  if (producers.length === 1) return null

  const names = involved
    .map((ord) => order.plan.lanes.find((lane) => lane.ord === ord)?.repo ?? `lane ${ord}`)
    .join(', ')

  return {
    check: 'coverage',
    detail:
      producers.length === 0
        ? `${names} all change ${shared.join(', ')}, and no lane is declared the producer. Say which repository owns the shared change so the rest can be held until it merges.`
        : `${producers.length} lanes are declared the producer of ${shared.join(', ')}. Exactly one owns a shared change.`,
    subjectIds: order.plan.units
      .filter((unit) => unit.touches.some((path) => shared.includes(path)))
      .map((unit) => unit.id),
  }
}

/**
 * The grade has to have been taken against *this* plan.
 *
 * Expressed as: everything the plan says it will touch is inside the blast
 * radius the risk assessment was made over. A plan that has quietly grown past
 * what was assessed is the case this catches — the grade is stale, and a stale
 * grade decides gates and inspection.
 */
function checkRisk(order: WorkOrder): CompileFailure | null {
  const touched = [...new Set(order.plan.units.flatMap((u) => u.touches))]
  if (touched.length === 0) return null

  if (order.risk.blastRadius.length === 0) {
    return {
      check: 'risk',
      detail:
        'The plan touches files but the order declares no blast radius, so its risk grade was not taken against this plan.',
      subjectIds: order.plan.units.filter((u) => u.touches.length > 0).map((u) => u.id),
    }
  }

  const outside = touched.filter((path) => !inside(path, order.risk.blastRadius))
  if (outside.length === 0) return null
  return {
    check: 'risk',
    detail: `The plan touches ${outside.join(', ')}, outside the declared blast radius.`,
    subjectIds: order.plan.units
      .filter((u) => u.touches.some((p) => outside.includes(p)))
      .map((u) => u.id),
  }
}

function checkRedTeam(order: WorkOrder): CompileFailure | null {
  const open = order.redTeam.filter((f) => f.status === 'open')
  if (open.length === 0) return null
  return {
    check: 'redTeam',
    detail: `The adversarial pass left ${open.length} finding${open.length === 1 ? '' : 's'} unresolved. Resolve each, or accept it with a reason.`,
    subjectIds: open.map((f) => f.id),
  }
}

/**
 * All five, always. Never short-circuits: an operator fixing one thing at a
 * time because the gate only ever showed them the first failure is a slower
 * loop than one that shows them everything.
 */
export function compileOrder(order: WorkOrder): CompileResult {
  const failures = [
    checkQuestions(order),
    checkVerifiable(order) ?? checkPicture(order),
    checkCoverage(order) ?? checkLaneOwnership(order),
    checkRisk(order),
    checkRedTeam(order),
  ].filter((f): f is CompileFailure => f !== null)

  return { ok: failures.length === 0, failures }
}

export type AgreeResult = { ok: true; order: WorkOrder } | { ok: false; result: CompileResult }

/**
 * The only way an order becomes `agreed`.
 *
 * Nothing else may set that status, which is what makes the compile checks a
 * gate rather than a suggestion. An order that fails is returned untouched —
 * no partial promotion, no half-agreed state.
 */
export function agreeOrder(order: WorkOrder, now: string): AgreeResult {
  if (order.status !== 'draft') {
    return {
      ok: false,
      result: {
        ok: false,
        failures: [
          {
            check: 'questions',
            detail: `Only a draft can be agreed; this order is ${order.status}.`,
            subjectIds: [order.id],
          },
        ],
      },
    }
  }

  const result = compileOrder(order)
  if (!result.ok) return { ok: false, result }
  // The collisions and the merge order they imply are written down at the
  // moment of agreement, so what the Line reads is the plan that was agreed
  // rather than a derivation it has to repeat and could get differently.
  const planned = planLanes(order)
  return { ok: true, order: { ...planned, status: 'agreed', agreedAt: now } }
}
