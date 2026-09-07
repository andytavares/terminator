import { gradeRisk, matchesGlob } from '../runtime/review/risk-grader.js'
import type { CheckState } from '../runtime/review/risk-grader.js'
import type { RiskAssessment, WorkOrder } from '../order/schema.js'

// What makes a security inspection run.
//
// The triggers come from the existing risk grader rather than a second list
// kept in step by hand: it already grades a change top-down by what it touches,
// with P3 checked last so a lockfile change that also touches authentication
// grades P0 rather than slipping into the quiet lane.
//
// The inspection reads the *accumulated* change rather than any single unit,
// which is what stops a unit finishing early from skipping it (FR-045).

/** The grader's prose reasons, mapped onto the order's trigger vocabulary. */
const TRIGGER_FROM_GRADER: ReadonlyArray<{
  match: RegExp
  trigger: RiskAssessment['triggers'][number]
}> = [
  { match: /authentication/i, trigger: 'authentication' },
  { match: /payments?/i, trigger: 'payments' },
  { match: /secrets?/i, trigger: 'secrets' },
  { match: /migration/i, trigger: 'migration' },
  { match: /public interface/i, trigger: 'public_interface' },
]

const DEPENDENCY_MANIFEST = /(^|\/)(package\.json|Cargo\.toml|go\.mod|pyproject\.toml|Gemfile)$/
const NETWORK = /(^|\/)(fetch|http|client|api-client|webhook)[.-]/i

export interface InspectionInput {
  /** Every file the accumulated change touches, across every unit. */
  readonly changedFiles: readonly string[]
  readonly linesChanged: number
  readonly checkState: CheckState
}

export interface Inspection {
  readonly grade: RiskAssessment['grade']
  readonly triggers: RiskAssessment['triggers']
  /** The grader's own words, kept so a gate can show the specific reason. */
  readonly reason: string
  readonly required: boolean
}

/**
 * Grade the accumulated change and decide whether an inspection runs.
 *
 * A change that trips nothing does not get one, and the record says so
 * explicitly (FR-044). Security theatre on every change is how people learn to
 * skim security findings.
 */
export function inspectionFor(order: WorkOrder, input: InspectionInput): Inspection {
  const graded = gradeRisk({
    files: input.changedFiles,
    linesChanged: input.linesChanged,
    checkState: input.checkState,
    sharedContractFiles: order.plan.sharedFiles,
    criticalPaths: order.risk.criticalPaths,
  })

  const triggers = new Set<RiskAssessment['triggers'][number]>()

  for (const { match, trigger } of TRIGGER_FROM_GRADER) {
    if (match.test(graded.trigger)) triggers.add(trigger)
  }

  // Three the grader does not speak to, because they are about what the change
  // brings in rather than where it lands.
  if (input.changedFiles.some((f) => DEPENDENCY_MANIFEST.test(f))) triggers.add('new_dependency')
  if (input.changedFiles.some((f) => NETWORK.test(f))) triggers.add('network_egress')

  if (order.risk.criticalPaths.length > 0) {
    const entered = input.changedFiles.some((file) =>
      order.risk.criticalPaths.some((glob) => matchesGlob(file, glob))
    )
    if (entered) triggers.add('critical_path')
  }

  // Writing outside what the order declared is itself a trigger: a plan that
  // has quietly grown past what was assessed is the case worth catching.
  if (order.risk.blastRadius.length > 0) {
    const outside = input.changedFiles.some(
      (file) => !order.risk.blastRadius.some((prefix) => file === prefix || file.startsWith(prefix))
    )
    if (outside) triggers.add('outside_blast_radius')
  }

  return {
    grade: graded.grade,
    triggers: [...triggers],
    reason: graded.trigger,
    required: triggers.size > 0,
  }
}

/** The order's risk block, brought up to date with what the change actually did. */
export function regrade(order: WorkOrder, input: InspectionInput): RiskAssessment {
  const inspection = inspectionFor(order, input)
  return { ...order.risk, grade: inspection.grade, triggers: inspection.triggers }
}
