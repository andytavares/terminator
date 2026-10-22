import type { Toolchain } from './toolchain-probe.js'
import type { CheckName } from './check-names.js'
import type { RiskAssessment } from '../order/schema.js'
import { isDocumentationRelative } from './documentation-path.js'

// The verification ladder.
//
// Seven rungs, each running as early as it can rather than everything at the
// end. Two properties matter more than the ordering itself.
//
// A failure stops the climb at its own rung. A lint error should never cost a
// security scan, and a failed criterion should never reach a merge gate.
//
// And a rung with no command reports "not measured", with the reason, and is
// never counted as a pass. That is what makes the whole thing honest in a
// repository nobody configured for it.

export const RUNGS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const
export type Rung = (typeof RUNGS)[number]

type RungStatus = 'runnable' | 'unavailable' | 'not_triggered' | 'elsewhere'

const RUNG_LEVEL_IN_WORDS: Record<Rung, string> = {
  L0: 'formatting and lint',
  L1: "the unit's own tests",
  L2: 'repository-wide coverage',
  L3: 'independent verification',
  L4: 'security inspection',
  L5: 'integration',
  L6: 'human decision',
}

/** What a rung of the verification ladder is, in words, never the bare code. */
export function rungLevelInWords(rung: Rung): string {
  return RUNG_LEVEL_IN_WORDS[rung]
}

export interface LadderStep {
  readonly rung: Rung
  readonly name: string
  /** What to run, or null when this repository has nothing for it. */
  readonly command: string | null
  readonly status: RungStatus
  /** Why it cannot run, or why it was not triggered. Empty when runnable. */
  readonly reason: string
  /** Which probed check this rung came from, where it came from one. */
  readonly check: CheckName | null
}

/** A rung run by the command the probe found for `check`, or unavailable when it found none. */
export function probedStep(
  toolchain: Toolchain,
  check: CheckName,
  { rung, name }: Pick<LadderStep, 'rung' | 'name'>
): LadderStep {
  const found = toolchain[check]
  return found === null
    ? {
        rung,
        name,
        command: null,
        status: 'unavailable',
        reason: `this repository has no ${check} command`,
        check,
      }
    : { rung, name, command: found.command, status: 'runnable', reason: '', check }
}

export interface LadderInput {
  readonly toolchain: Toolchain
  readonly risk: RiskAssessment
  /** True when the change alters something a person looks at. */
  readonly touchesUi: boolean
  /**
   * What the change touched. When every path is documentation the climb runs
   * Format and Lint and nothing else. Absent or empty means nobody knows what
   * changed, which is never a reason to run less.
   */
  readonly changedFiles?: readonly string[]
  /** Checks the repository's profile adds, each run at its own rung. */
  readonly additional?: readonly AdditionalStep[]
}

export interface AdditionalStep {
  readonly name: string
  readonly command: string
  readonly rung: Rung
}

/** A step the profile added: runnable at its rung, tied to no probed check. */
function additionalStep({ name, command, rung }: AdditionalStep): LadderStep {
  return { rung, name, command, status: 'runnable', reason: '', check: null }
}

/** Each added step goes after the last step already at its rung. */
function withAdditional(steps: LadderStep[], additional: readonly AdditionalStep[]): LadderStep[] {
  const placed = [...steps]
  for (const added of additional) {
    const lastAtRung = placed.map((step) => step.rung).lastIndexOf(added.rung)
    placed.splice(lastAtRung + 1, 0, additionalStep(added))
  }
  return placed
}

// Not a command and not a gap: the verifier runs as its own node on every unit and its
// exit status is in the criteria table. "Not measured" here taught skimming.
const INDEPENDENT_VERIFICATION: LadderStep = {
  rung: 'L3',
  name: 'Independent verification',
  command: null,
  status: 'elsewhere',
  reason: 'by the verifier on each unit — see the criteria table',
  check: null,
}

const HUMAN_DECISION: LadderStep = {
  rung: 'L6',
  name: 'Human decision',
  command: null,
  status: 'elsewhere',
  reason: 'only what a rule raised — see the decision below',
  check: null,
}

function inspectionStep(risk: RiskAssessment): LadderStep {
  const triggered = risk.triggers.length > 0
  return {
    rung: 'L4',
    name: 'Security inspection',
    command: null,
    status: triggered ? 'elsewhere' : 'not_triggered',
    reason: triggered
      ? `triggered by ${risk.triggers.join(', ')} — see the findings`
      : 'this change touches nothing that warrants one',
    check: null,
  }
}

/** End-to-end tests run against the built application, so a step builds it first. */
function integrationSteps(toolchain: Toolchain, touchesUi: boolean): LadderStep[] {
  const build =
    toolchain.e2e !== null && toolchain.build !== null
      ? [probedStep(toolchain, 'build', { rung: 'L5', name: 'Build the application' })]
      : []
  const name = touchesUi ? 'Integration and a picture of the running application' : 'Integration'
  return [...build, probedStep(toolchain, 'e2e', { rung: 'L5', name })]
}

/** A step that is not a command this climb runs: the verifier's, the inspection's, the human's. */
function isDecidedElsewhere(step: LadderStep): boolean {
  return step.check === null && step.status !== 'runnable'
}

/**
 * The rungs for this repository and this change.
 *
 * L0–L2 run whatever the probe found; L4 runs only on a risk trigger and says
 * so when it does not (FR-044) — a security inspection on every change is how
 * people learn to skim security findings.
 */
export function ladderFor(input: LadderInput): LadderStep[] {
  const { toolchain, risk, touchesUi, changedFiles = [], additional = [] } = input
  const base: LadderStep[] = [
    probedStep(toolchain, 'format', { rung: 'L0', name: 'Format' }),
    probedStep(toolchain, 'lint', { rung: 'L0', name: 'Lint' }),
    probedStep(toolchain, 'test', { rung: 'L1', name: "The unit's own tests" }),
    probedStep(toolchain, 'coverage', { rung: 'L2', name: 'Repository gate' }),
    INDEPENDENT_VERIFICATION,
    inspectionStep(risk),
    ...integrationSteps(toolchain, touchesUi),
    HUMAN_DECISION,
  ]
  const rungs = withAdditional(base, additional)

  // Words cannot break a build or a test, so a change that only touches them
  // is held to Format and Lint. Said on each step rather than dropped, so the
  // record shows what was not run and why.
  if (changedFiles.length === 0 || !changedFiles.every(isDocumentationRelative)) {
    return rungs
  }
  return rungs.map((rung) =>
    rung.check === 'format' || rung.check === 'lint' || isDecidedElsewhere(rung)
      ? rung
      : { ...rung, command: null, status: 'not_triggered' as const, reason: 'documentation only' }
  )
}

export interface StepOutcome {
  readonly rung: Rung
  readonly name: string
  readonly result: 'pass' | 'fail' | 'not_measured' | 'not_triggered' | 'elsewhere'
  readonly reason: string
  readonly exitCode: number | null
  /** The command this step ran, so a failure can be reported by name, not by rung code. */
  readonly command: string | null
  /** The earlier step this one reused the result of: the same command string, run once. */
  readonly reusedFrom?: string
}

export interface LadderOutcome {
  readonly steps: readonly StepOutcome[]
  /** Where it stopped, or null when it climbed the whole way. */
  readonly stoppedAt: Rung | null
  /** Every rung that could not run. Never counted as passing. */
  readonly unmeasured: readonly string[]
  readonly ok: boolean
}

export type RunStep = (step: LadderStep) => Promise<number | null>

// What a step not run here records. `unavailable` is not a failure (the climb goes on)
// but never a pass, carried out so nothing reads it as green; `elsewhere` is decided,
// neither a pass this climb can claim nor a gap to report.
const NOT_RUN: Record<Exclude<RungStatus, 'runnable'>, StepOutcome['result']> = {
  not_triggered: 'not_triggered',
  elsewhere: 'elsewhere',
  unavailable: 'not_measured',
}

/**
 * Climb, stopping at the first failure.
 *
 * The runner is injected: in the application these are steps inside the
 * supervised session, and in a test they are a function. Either way the
 * verdict comes from the exit status the runner returns, never from anything
 * it printed.
 */
export async function climb(steps: readonly LadderStep[], run: RunStep): Promise<LadderOutcome> {
  const outcomes: StepOutcome[] = []
  let stoppedAt: Rung | null = null
  // A command that passed in this climb. A repository whose `test` and
  // `coverage` are both `vitest run --coverage` would otherwise run it twice
  // on the same commit for the same answer.
  const passed = new Map<string, string>()

  for (const step of steps) {
    const outcome = await rungOutcomeOf(step, run, passed)
    outcomes.push(outcome)
    if (outcome.result === 'fail') {
      stoppedAt = step.rung
      break
    }
  }

  return {
    steps: outcomes,
    stoppedAt,
    unmeasured: outcomes.filter((o) => o.result === 'not_measured').map((o) => o.name),
    ok: stoppedAt === null && outcomes.every((o) => o.result !== 'fail'),
  }
}

async function rungOutcomeOf(
  step: LadderStep,
  run: RunStep,
  passed: Map<string, string>
): Promise<StepOutcome> {
  const { rung, name, command } = step
  if (step.status !== 'runnable') {
    return {
      rung,
      name,
      result: NOT_RUN[step.status],
      reason: step.reason,
      exitCode: null,
      command,
    }
  }
  const earlier = command === null ? undefined : passed.get(command)
  if (earlier !== undefined) {
    const reason = `same command as ${earlier}; its result was reused, not run again`
    return { rung, name, result: 'pass', reason, exitCode: 0, command, reusedFrom: earlier }
  }
  const outcome = ranOutcome(step, await run(step))
  if (outcome.result === 'pass' && command !== null) passed.set(command, name)
  return outcome
}

/** What a step's exit status says: a pass, a failure, or nothing when it did not run. */
function ranOutcome({ rung, name, command }: LadderStep, exitCode: number | null): StepOutcome {
  if (exitCode === null) {
    return { rung, name, result: 'not_measured', reason: 'the step did not run', exitCode, command }
  }
  const succeeded = exitCode === 0
  return {
    rung,
    name,
    result: succeeded ? 'pass' : 'fail',
    reason: succeeded ? '' : `exited ${exitCode}`,
    exitCode,
    command,
  }
}
