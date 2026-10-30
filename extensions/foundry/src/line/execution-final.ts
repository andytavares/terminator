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
  // The ladder runs over the finished work, and only when there is finished
  // work to climb over: a run that halted at a gate has not earned a verdict
  // on the whole change, and reporting one would be inventing it. A document
  // handed back outside the checkout has no change to verify either.
  const shipsChange = (await run.deps.shipsChange?.()) ?? true
  const owed = !run.halted && !run.stalled && workDone && shipsChange
  if (!owed) return runOutcomeOf(run, { change, workDone, ladder: null, debt: false })
  return climbOverChange(run, { change, workDone })
}

async function climbOverChange(
  run: Execution,
  { change, workDone }: { change: Change; workDone: boolean }
): Promise<RunOutcome> {
  const draftsOpen = await openDraftsEarly(run, change)
  const climbed = await new FinalClimb(run, change).climbAll()
  const debt = !climbed.ladder.ok && debtAccepted(run)
  if (!run.halted) await raiseAfterWork(run, { change, climbed, debt })
  if (draftsOpen && !climbed.ladder.ok && !debt) await recordFinalCheckFailed(run, climbed.ladder)
  return runOutcomeOf(run, { change, workDone, ladder: climbed.ladder, debt })
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
  // The operator already accepted a failing final check for this order.
  readonly debt: boolean
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
  if (run.halted || after.climbed.ladder.ok) return
  if (after.debt) await recordAcceptedDebt(run, after.climbed.ladder)
  else await raiseFailedCheck(run, after.climbed)
}

/** The operator accepted a failing final check for this order, on an earlier run. */
function debtAccepted(run: Execution): boolean {
  return run.priorGates.some(
    (g) =>
      (g.rule === 'verify.repeat-fail' || g.rule === 'verify.base-fail') &&
      g.finalCheck === true &&
      g.decision?.option === 'accept_debt'
  )
}

async function recordAcceptedDebt(run: Execution, ladder: LadderOutcome): Promise<void> {
  const step = ladder.steps.find((s) => s.result === 'fail')
  if (step === undefined) return
  const command = step.command === null ? '' : ` (\`${step.command}\`)`
  await run.deps.record(
    'verify.debt_accepted',
    step.name,
    `${step.name}${command} failed with exit code ${step.exitCode ?? 'unknown'}; you accepted this debt, so the change ships.`
  )
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

async function raiseFailedCheck(run: Execution, climbed: Climb): Promise<void> {
  const failed = failedCheckOf(climbed)
  const capped = sentBackCount(run, 'verify.repeat-fail') >= MAX_FINAL_SEND_BACKS
  run.halted = await run.stopAtGate('verify.repeat-fail', {
    evidence: failed.evidence,
    summary: `${run.order.title} did not pass verification`,
    why: `${failed.why}${capped ? ' It has been sent back twice; take over, accept the debt, or hold.' : ''}`,
    omitOptions: capped ? ['send_back'] : undefined,
    finalCheck: true,
  })
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

interface Outcome {
  readonly change: Change
  readonly workDone: boolean
  readonly ladder: LadderOutcome | null
  readonly debt: boolean
}

function runOutcomeOf(run: Execution, { change, workDone, ladder, debt }: Outcome): RunOutcome {
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
    // Done, nothing waiting on a person, and the climb passed, was not owed, or its
    // failure was accepted as debt: a complete graph with an open gate is not
    // shippable, nor is a shape with no ship step.
    shippable:
      opensPullRequest(run.recipe) &&
      workDone &&
      !run.halted &&
      !run.stalled &&
      run.gates.length === 0 &&
      ((ladder?.ok ?? true) || debt),
  }
}
