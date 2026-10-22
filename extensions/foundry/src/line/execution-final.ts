import * as fs from 'node:fs'
import * as path from 'node:path'
import { isComplete } from './scheduler.js'
import { stepFor } from './run-graph.js'
import type { RunNode } from './run-graph.js'
import type { RiskAssessment, WorkOrder } from '../order/schema.js'
import { summarise } from '../verify/verdict.js'
import type { Evidence } from '../verify/verdict.js'
import { inspectionFor, regrade } from '../verify/inspection-triggers.js'
import { matchesAnyGlob } from '../runtime/review/risk-grader.js'
import type { Inspection } from '../verify/inspection-triggers.js'
import { ladderFor, climb } from '../verify/ladder.js'
import { PICTURES_STEP_NAME } from '../verify/ladder.js'
import type { LadderOutcome, LadderStep, PicturesTaken, StepOutcome } from '../verify/ladder.js'
import { NO_IMAGES_REASON } from './pictures.js'
import { gradeInWords } from '../runtime/review/risk-grade.js'
import { lastLines, opensPullRequest, safeFilename } from './execution-parts.js'
import type { Gate } from '../gates/rules.js'
import type { Execution } from './execution.js'
import type { ExecutorDeps, RunOutcome } from './executor.js'

// After the waves: the change graded for what it turned out to be, the final
// check climbed over it, and the gates that only the finished work can raise.

/** Sending the finished change back to the builder this many times is enough; the third is a person's call. */
const MAX_FINAL_SEND_BACKS = 2

/** What the work changed, and what that change turned out to warrant. */
interface Change {
  readonly touched: readonly string[]
  readonly inspection: Inspection
  // The grade the change turned out to deserve, which shipping reads: a P3 plan that
  // touches authentication must reach the operator before the remote.
  readonly risk: RiskAssessment
}

/** A person looks at this change: a changed file is interface, or a unit says it is. @internal */
export function touchesUi(order: WorkOrder, files: readonly string[]): boolean {
  const { interface: interfaceGlobs } = order.context.environment.paths
  return (
    files.some((file) => matchesAnyGlob(file, interfaceGlobs)) ||
    order.plan.units.some((unit) => unit.touchesInterface === true)
  )
}

export async function finishExecution(run: Execution): Promise<RunOutcome> {
  const change = await assessChange(run)
  const workDone = isWorkDone(run)
  const climber = new FinalClimb(run, change)
  // The ladder runs over the finished work, and only when there is finished
  // work to climb over: a run that halted at a gate has not earned a verdict
  // on the whole change, and reporting one would be inventing it.
  const owed = !run.halted && !run.stalled && workDone
  const draftsOpen = owed && (await openDraftsEarly(run, change))
  const climbed = owed ? await climber.climbAll() : null
  if (climbed === null) return runOutcomeOf(run, { change, workDone, ladder: null })
  if (!run.halted) await raiseAfterWork(run, { change, climbed, climber })
  if (draftsOpen && !climbed.ladder.ok) await recordFinalCheckFailed(run, climbed.ladder)
  return runOutcomeOf(run, { change, workDone, ladder: climbed.ladder })
}

/** The pictures step's outcome carries what it left, or why it measured nothing. */
function withPictures(ladder: LadderOutcome, taken: PicturesTaken | null): LadderOutcome {
  if (taken === null) return ladder
  const steps = ladder.steps.map((step) => {
    if (step.name !== PICTURES_STEP_NAME || step.result === 'fail') return step
    return taken.images.length === 0
      ? { ...step, reason: NO_IMAGES_REASON }
      : { ...step, pictures: taken }
  })
  return { ...ladder, steps }
}

// Opens the drafts first when nothing needs the operator before they exist (no
// inspection owed; the caller judges the shipping mode). True when they are open.
async function openDraftsEarly(run: Execution, change: Change): Promise<boolean> {
  const { beforeFinalCheck } = run.deps
  if (change.inspection.required || beforeFinalCheck === undefined) return false
  return beforeFinalCheck({ risk: change.risk, verdicts: run.verdicts })
}

// The accumulated change, so a unit finishing early cannot skip the inspection: the
// plan's files plus the work's, combined because git reporting nothing means it could
// not be read, and "nothing touched authentication" is how a P0 grades P3.
async function assessChange(run: Execution): Promise<Change> {
  const { order, deps } = run
  const declared = order.plan.units.flatMap((u) => u.touches)
  const seen = await deps.observedChange()
  const touched = [...new Set([...declared, ...seen.changedFiles])]
  const observed = {
    changedFiles: touched,
    linesChanged: seen?.linesChanged ?? 0,
    checkState: (summarise(run.verdicts).ok ? 'passing' : 'failing') as 'passing' | 'failing',
  }
  const inspection = inspectionFor(order, observed)
  const risk = regrade(order, observed)
  deps.onEvent({ type: 'inspection', required: inspection.required, triggers: inspection.triggers })
  return { touched, inspection, risk }
}

/** The work is done when all but the held ship node passed; that node is the tail's. */
function isWorkDone(run: Execution): boolean {
  const { current, recipe } = run
  const isShipNode = (n: RunNode) =>
    n.kind === 'gate' && n.state === 'running' && stepFor(recipe, n)?.rule === 'ready-for-review'
  return (
    isComplete(current) ||
    (current.nodes.some(isShipNode) &&
      current.nodes.every((n) => n.state === 'passed' || n.state === 'skipped' || isShipNode(n)))
  )
}

/** A climb's outcome, with each step's log kept so a gate can show what it saw. */
interface Climb {
  readonly ladder: LadderOutcome
  readonly logs: Map<string, string>
}

/** A climb's outcome as `climbWith` returns it. */
type ClimbResult = Awaited<ReturnType<FinalClimb['climbWith']>>

/** Where the final check climbed on the base branch, and what that showed. */
interface BaseCheck {
  readonly onBase: 'fails' | 'passes' | 'unknown'
  readonly failed: StepOutcome | null
  readonly logs: Map<string, string>
}

const BASE_UNKNOWN: BaseCheck = { onBase: 'unknown', failed: null, logs: new Map() }

class FinalClimb {
  readonly steps: LadderStep[]
  private readonly climbedAt: number

  constructor(
    private readonly run: Execution,
    change: Change
  ) {
    this.climbedAt = Date.parse(run.deps.now())
    this.steps = ladderFor({
      toolchain: run.order.context.toolchain,
      risk: change.risk,
      touchesUi: touchesUi(run.order, change.touched),
      changedFiles: change.touched,
      pictures: run.order.context.environment.pictures,
      additional: run.order.context.environment.additional,
    })
  }

  logPath(name: string, suffix: string): string {
    const file = `final-${safeFilename(name.toLowerCase())}.${this.climbedAt}${suffix}.log`
    return path.join(this.run.recordsDir(), 'runs', file)
  }

  /** One climb, with each step's log kept so a gate can show what it saw. */
  async climbWith(
    steps: readonly LadderStep[],
    runner: ExecutorDeps['runStep'],
    suffix: string
  ): Promise<{ outcome: LadderOutcome; logs: Map<string, string> }> {
    const logs = new Map<string, string>()
    const outcome = await climb(steps, async (step) => {
      const logPath = this.logPath(step.name, suffix)
      logs.set(step.name, logPath)
      return runner(step, logPath)
    })
    // A step that reused another's result shows that step's log.
    for (const reused of outcome.steps) {
      const from = reused.reusedFrom === undefined ? undefined : logs.get(reused.reusedFrom)
      if (from !== undefined) logs.set(reused.name, from)
    }
    return { outcome, logs }
  }

  /** The climb over the change; a failure gets the lane prepared again and one more climb. */
  async climbAll(): Promise<Climb> {
    const first = await this.climbWith(this.steps, this.run.deps.runStep, '')
    this.run.deps.onEvent({ type: 'ladder', outcome: first.outcome })
    const settled = await this.prepareAgain(first)
    const ladder = withPictures(settled.outcome, this.run.deps.picturesTaken?.() ?? null)
    return { ladder, logs: settled.logs }
  }

  // A check that failed is run once more after the lane's own preparation ran again: a
  // different checkout, not a rerun. Passing then means the checkout was broken, not the
  // code; no log is read.
  private async prepareAgain(first: ClimbResult): Promise<ClimbResult> {
    const { order, deps } = this.run
    const failedName = first.outcome.steps.find((s) => s.result === 'fail')?.name
    if (failedName === undefined || order.context.environment.prepare === null) return first
    const prepared = await deps.reinstall('change', this.logPath('prepare', '.again'))
    if (prepared !== 0) return first
    const again = await this.climbWith(this.steps, deps.runStep, '.reprepared')
    deps.onEvent({ type: 'ladder', outcome: again.outcome })
    if (!again.outcome.ok) return first
    await deps.record(
      'verify.reprepared',
      failedName,
      `${failedName} failed and passed once the checkout was prepared again: the checkout was broken, not the code. Earlier log: ${first.logs.get(failedName)}.`
    )
    return again
  }

  // The same rungs on the base branch, up to the failed one, so a failure already
  // there is not sent back to a builder; the base checkout is let go regardless.
  async onBase(failedStep: StepOutcome): Promise<BaseCheck> {
    const upTo = this.steps.findIndex((s) => s.name === failedStep.name)
    const baseSteps = this.steps.slice(0, upTo + 1)
    try {
      const base = await this.climbWith(baseSteps, this.run.deps.runStepOnBase, '.base')
      const failed = base.outcome.steps.find((s) => s.result === 'fail') ?? null
      const atStep = base.outcome.steps.find((s) => s.name === failedStep.name)
      return { onBase: baseVerdict({ failed, atStep }), failed, logs: base.logs }
    } finally {
      await this.run.deps.releaseBase()
    }
  }
}

function baseVerdict({
  failed,
  atStep,
}: {
  failed: StepOutcome | null
  atStep: StepOutcome | undefined
}): BaseCheck['onBase'] {
  if (failed !== null) return 'fails'
  return atStep?.result === 'pass' ? 'passes' : 'unknown'
}

/** The last lines of a step's log, or nothing when it never wrote one. */
function excerptOf(logPath: string | undefined): string {
  return logPath !== undefined && fs.existsSync(logPath)
    ? lastLines(fs.readFileSync(logPath, 'utf8').trimEnd(), 60)
    : ''
}

interface AfterWork {
  readonly change: Change
  readonly climbed: Climb
  readonly climber: FinalClimb
}

// The rules that fire on what the change turned out to be, raised after the
// work, when that answer exists.
async function raiseAfterWork(run: Execution, after: AfterWork): Promise<void> {
  const { inspection, risk } = after.change
  const { order } = run
  // A trigger the agreed plan declared was the operator's to weigh when they
  // released it; asking again after the work is the same question twice.
  if (inspection.unplanned.length > 0) {
    const planned =
      risk.grade === order.risk.grade
        ? ''
        : ` — it was planned as ${gradeInWords(order.risk.grade)}`
    run.halted = await run.stopAtGate('risk.p0', {
      summary: `${order.title} graded ${gradeInWords(risk.grade)} once it was done${planned}`,
      why: `${inspection.reason} Triggered by ${inspection.unplanned.join(', ')}.`,
    })
  }
  if (!run.halted && !after.climbed.ladder.ok) await raiseFailedCheck(run, after)
}

/** How many times the operator sent the finished change back from a gate of this rule. */
function sentBackCount(run: Execution, rule: Gate['rule']): number {
  return run.priorGates.filter(
    (g) => g.rule === rule && g.nodeId === null && g.decision?.option === 'send_back'
  ).length
}

/** The step the final check failed at, its log, and what to show of it. */
interface FailedCheck {
  readonly step: StepOutcome | null
  readonly evidence: Evidence[]
  readonly why: string
}

function failedCheckOf({ ladder, logs }: Climb): FailedCheck {
  const step = ladder.steps.find((s) => s.result === 'fail') ?? null
  if (step === null) {
    return {
      step,
      evidence: [],
      why: `Nothing failed, but ${ladder.unmeasured.join(', ')} could not be measured here.`,
    }
  }
  const log = logs.get(step.name)
  const exit = `${step.name} failed with exit code ${step.exitCode ?? 'unknown'}`
  return {
    step,
    evidence: [
      { kind: 'stdout', exitCode: step.exitCode ?? undefined, path: log, excerpt: excerptOf(log) },
    ],
    why: step.command === null ? `${exit}.` : `${exit}: \`${step.command}\`.`,
  }
}

async function raiseFailedCheck(run: Execution, { climbed, climber }: AfterWork): Promise<void> {
  const failed = failedCheckOf(climbed)
  const base = failed.step !== null ? await climber.onBase(failed.step) : BASE_UNKNOWN
  const baseBranch = run.order.context.repos[0]?.baseBranch ?? 'the base branch'
  if (base.onBase === 'fails' && base.failed !== null) {
    run.halted = await run.stopAtGate(
      'verify.base-fail',
      baseFailAsk(run, { failed, base, baseBranch })
    )
    return
  }
  const capped = sentBackCount(run, 'verify.repeat-fail') >= MAX_FINAL_SEND_BACKS
  const note = baseNote({ failed, base, baseBranch })
  run.halted = await run.stopAtGate('verify.repeat-fail', {
    evidence: failed.evidence,
    summary: `${run.order.title} did not pass verification`,
    why: `${failed.why}${note}${capped ? ' It has been sent back twice; take over, accept the debt, or hold.' : ''}`,
    omitOptions: capped ? ['send_back'] : undefined,
  })
}

interface BaseFinding {
  readonly failed: FailedCheck
  readonly base: BaseCheck
  readonly baseBranch: string
}

function baseFailAsk(run: Execution, { failed, base, baseBranch }: BaseFinding) {
  const baseFailed = base.failed as StepOutcome
  const baseCommand = baseFailed.command === null ? '' : `: \`${baseFailed.command}\``
  const baseLog = base.logs.get(baseFailed.name)
  return {
    evidence: [
      ...failed.evidence,
      {
        kind: 'stdout' as const,
        exitCode: baseFailed.exitCode ?? undefined,
        step: baseFailed.name,
        command: baseFailed.command ?? undefined,
        path: baseLog,
        excerpt: excerptOf(baseLog),
      },
    ],
    summary: `${run.order.title} is blocked by a check that already fails on ${baseBranch}`,
    why: `${baseFailed.name} fails on ${baseBranch} with exit code ${baseFailed.exitCode ?? 'unknown'}${baseCommand}. It also fails without this change.`,
  }
}

function baseNote({ failed, base, baseBranch }: BaseFinding): string {
  if (failed.step === null) return ''
  if (base.onBase === 'passes') return ` It passes on ${baseBranch} without this change.`
  return ` ${baseBranch} could not be checked to see whether it fails there too.`
}

async function recordFinalCheckFailed(run: Execution, ladder: LadderOutcome): Promise<void> {
  const failedStep = ladder.steps.find((s) => s.result === 'fail')
  await run.deps.record(
    'ship.final_check_failed',
    failedStep?.name ?? run.order.id,
    failedStep === undefined
      ? 'The final check could not be completed; the draft stays a draft.'
      : `${failedStep.name} failed${failedStep.command === null ? '' : `: ${failedStep.command}`}; the draft stays a draft.`
  )
}

function runOutcomeOf(
  run: Execution,
  { change, workDone, ladder }: { change: Change; workDone: boolean; ladder: LadderOutcome | null }
): RunOutcome {
  const { inspection } = change
  return {
    graph: run.current,
    verdicts: run.verdicts,
    complete: workDone,
    awaitingDecision: run.awaitingDecision,
    gates: run.gates,
    ladder,
    inspection: {
      required: inspection.required,
      triggers: inspection.triggers,
      reason: inspection.reason,
    },
    risk: change.risk,
    // Done, nothing waiting on a person, and the climb passed or was not owed: a
    // complete graph with an open gate is not shippable, nor is a shape with no ship step.
    shippable:
      opensPullRequest(run.recipe) &&
      workDone &&
      !run.halted &&
      !run.stalled &&
      run.gates.length === 0 &&
      (ladder?.ok ?? false),
  }
}
