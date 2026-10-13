import { matchesGlob } from 'node:path'
import { gradeRisk } from '../runtime/review/risk-grader.js'
import type { CheckState } from '../runtime/review/risk-grader.js'
import type { RiskAssessment, WorkOrder } from '../order/schema.js'
import { isDocumentationRelative } from './documentation-path.js'

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
  /** The triggers the agreed plan did not declare: only these stop for the operator. */
  readonly unplanned: RiskAssessment['triggers']
}

/**
 * Grade the accumulated change and decide whether an inspection runs.
 *
 * A change that trips nothing does not get one, and the record says so
 * explicitly (FR-044). Security theatre on every change is how people learn to
 * skim security findings.
 */
type Trigger = RiskAssessment['triggers'][number]

/** The triggers the grader does not speak to, read off the changed files. */
function whatTheChangeTripped(order: WorkOrder, files: readonly string[]): Trigger[] {
  const tripped: Trigger[] = []
  // About what the change brings in rather than where it lands.
  if (files.some((f) => DEPENDENCY_MANIFEST.test(f))) tripped.push('new_dependency')
  if (files.some((f) => NETWORK.test(f))) tripped.push('network_egress')
  const { criticalPaths } = order.risk
  if (files.some((file) => criticalPaths.some((glob) => matchesGlob(file, glob)))) {
    tripped.push('critical_path')
  }
  if (outsideBlastRadius(order, files)) tripped.push('outside_blast_radius')
  return tripped
}

/**
 * Writing outside what the order declared is itself a trigger: a plan that has
 * quietly grown past what was assessed is the case worth catching.
 * Documentation is not growth: the scribe writes the README and CHANGELOG
 * every order owes, wherever the plan's code lives.
 */
function outsideBlastRadius(order: WorkOrder, files: readonly string[]): boolean {
  const { blastRadius } = order.risk
  if (blastRadius.length === 0) return false
  return files.some(
    (file) =>
      !isDocumentationRelative(file) &&
      !blastRadius.some((prefix) => file === prefix || file.startsWith(prefix))
  )
}

export function inspectionFor(order: WorkOrder, input: InspectionInput): Inspection {
  const graded = gradeRisk({
    files: input.changedFiles,
    linesChanged: input.linesChanged,
    checkState: input.checkState,
    sharedContractFiles: order.plan.sharedFiles,
    criticalPaths: order.risk.criticalPaths,
  })

  const triggers = new Set<Trigger>(
    TRIGGER_FROM_GRADER.filter(({ match }) => match.test(graded.trigger)).map((t) => t.trigger)
  )
  for (const trigger of whatTheChangeTripped(order, input.changedFiles)) triggers.add(trigger)

  return {
    grade: graded.grade,
    triggers: [...triggers],
    reason: graded.trigger,
    required: triggers.size > 0,
    unplanned: [...triggers].filter((trigger) => !order.risk.triggers.includes(trigger)),
  }
}

/** The order's risk block, brought up to date with what the change actually did. */
export function regrade(order: WorkOrder, input: InspectionInput): RiskAssessment {
  const inspection = inspectionFor(order, input)
  return { ...order.risk, grade: inspection.grade, triggers: inspection.triggers }
}
