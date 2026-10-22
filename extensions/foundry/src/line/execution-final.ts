import * as fs from 'node:fs'
import * as path from 'node:path'
import { isComplete } from './scheduler.js'
import { stepFor } from './run-graph.js'
import type { RunNode } from './run-graph.js'
import type { RiskAssessment } from '../order/schema.js'
import { summarise } from '../verify/verdict.js'
import type { Evidence } from '../verify/verdict.js'
import { inspectionFor, regrade } from '../verify/inspection-triggers.js'
import type { Inspection } from '../verify/inspection-triggers.js'
import { ladderFor, climb } from '../verify/ladder.js'
import { brokenInstall } from '../verify/broken-install.js'
import type { LadderOutcome, LadderStep, StepOutcome } from '../verify/ladder.js'
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

/** A check that failed and passed on the same commit, with both runs as evidence. */
interface Flaky {
  readonly name: string
  readonly command: string | null
  /** The failing run, then the passing one. */
  readonly evidence: readonly [Evidence, Evidence]
}

/** A climb's outcome, with each step's log kept so a gate can show what it saw. */
interface Climb {
  readonly ladder: LadderOutcome
  readonly logs: Map<string, string>
  /** What is wrong with the installed dependencies, when that is why it failed. */
  readonly installFault: string | null
}

interface Climbed extends Climb {
  /** Set when a check disagreed with itself; the ladder then counts as failed unless the debt was accepted. */
  readonly flaky: Flaky | null
}

/** The checks whose runs are repeated in the final check, to see whether they agree. */
const BURNED_IN: readonly LadderStep['check'][] = ['test', 'e2e']

/** One run of a check: how it ended and where it logged. */
interface CheckRun {
  readonly exitCode: number | null
  readonly log: string | undefined
}

function runOf(step: StepOutcome, logs: Map<string, string>): CheckRun {
  return { exitCode: step.exitCode, log: logs.get(step.name) }
}

function flakyOf(
  step: { name: string; command: string | null },
  failed: CheckRun,
  passed: CheckRun
): Flaky {
  const evidenceOf = (run: CheckRun): Evidence => ({
    kind: 'stdout',
    exitCode: run.exitCode ?? undefined,
    step: step.name,
    command: step.command ?? undefined,
    path: run.log,
    excerpt: excerptOf(run.log),
  })
  return {
    name: step.name,
    command: step.command,
    evidence: [evidenceOf(failed), evidenceOf(passed)],
  }
}

/** The operator already shipped with this check named as flaky, so it is not asked again. */
function isFlakyAccepted(gates: readonly Gate[], stepName: string): boolean {
  return gates.some(
    (g) =>
      g.rule === 'verify.flaky' &&
      g.decision?.option === 'accept_debt' &&
      g.evidence.some((e) => e.step === stepName)
  )
}

/** Where the final check climbed on the base branch, and what that showed. */
interface BaseCheck {
  readonly onBase: 'fails' | 'passes' | 'unknown'
  readonly failed: StepOutcome | null
  readonly logs: Map<string, string>
  readonly fault: string | null
}

const BASE_UNKNOWN: BaseCheck = { onBase: 'unknown', failed: null, logs: new Map(), fault: null }

class FinalClimb {
  readonly steps: LadderStep[]
  private readonly climbedAt: number
  /** The first check found to disagree with itself in this climb. */
  private flaky: Flaky | null = null

  constructor(
    private readonly run: Execution,
    change: Change
  ) {
    this.climbedAt = Date.parse(run.deps.now())
    this.steps = ladderFor({
      toolchain: run.order.context.toolchain,
      risk: change.risk,
      touchesUi: change.touched.some((p) => /\.(tsx|css|html|svelte|vue)$/.test(p)),
      changedFiles: change.touched,
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

  /** The climb over the change, retried once on a failure and mended once for a broken install. */
  async climbAll(): Promise<Climbed> {
    const first = await this.climbWith(this.steps, this.burnedInRunner(), '')
    this.run.deps.onEvent({ type: 'ladder', outcome: first.outcome })
    // A check that disagreed with itself needs a decision, not a retry or a reinstall.
    const undecided = this.flaky !== null && !isFlakyAccepted(this.run.priorGates, this.flaky.name)
    const settled = undecided ? first : await this.retryFailure(first)
    const climb: Climb = undecided
      ? { ladder: settled.outcome, logs: settled.logs, installFault: null }
      : await this.mendInstall(settled)
    return { ...climb, flaky: this.flaky }
  }

  // A test or end-to-end step runs `finalRuns` times on the same commit. The first run may
  // come from the pass cache; the repeats never do, or they would only repeat its answer.
  private burnedInRunner(): ExecutorDeps['runStep'] {
    const runs = this.run.deps.finalRuns ?? 1
    return async (step, logPath) => {
      const first = await this.run.deps.runStep(step, logPath)
      if (first === null || runs < 2 || !BURNED_IN.includes(step.check)) return first
      for (let n = 2; n <= runs; n += 1) {
        const repeat = this.logPath(step.name, `.run${n}`)
        const exitCode = await this.run.deps.runStep(step, repeat, { fresh: true })
        if (exitCode === null || (exitCode === 0) === (first === 0)) continue
        const runs = [
          { exitCode: first, log: logPath },
          { exitCode, log: repeat },
        ]
        return this.disagreed(step, first === 0 ? runs.reverse() : runs)
      }
      return first
    }
  }

  // The failing exit code, so the ladder stops here; zero when the operator already
  // accepted this check as flaky, so the debt is carried and the climb goes on.
  private disagreed(step: LadderStep, [failed, passed]: CheckRun[]): number | null {
    this.flaky ??= flakyOf(step, failed, passed)
    return isFlakyAccepted(this.run.priorGates, step.name) ? 0 : failed.exitCode
  }

  // A check that fails once and passes on the same commit is flaky, which is a failure:
  // the first result stands unless the operator already accepted this check as flaky.
  // Passes on this commit are cached, so only the failed step and later ones rerun.
  private async retryFailure(first: { outcome: LadderOutcome; logs: Map<string, string> }) {
    const firstFailed = first.outcome.ok
      ? undefined
      : first.outcome.steps.find((s) => s.result === 'fail')
    if (firstFailed === undefined) return first
    const retry = await this.climbWith(this.steps, this.run.deps.runStep, '.retry')
    this.run.deps.onEvent({ type: 'ladder', outcome: retry.outcome })
    if (!retry.outcome.ok) return retry
    const passed = retry.outcome.steps.find((s) => s.name === firstFailed.name)
    this.flaky = flakyOf(
      firstFailed,
      runOf(firstFailed, first.logs),
      runOf(passed ?? firstFailed, retry.logs)
    )
    return isFlakyAccepted(this.run.priorGates, firstFailed.name) ? retry : first
  }

  // A missing package or half-downloaded binary is mended, not asked about:
  // reinstalling is the whole answer, and the code is not at fault.
  private async mendInstall(climbed: {
    outcome: LadderOutcome
    logs: Map<string, string>
  }): Promise<Climb> {
    const installFault = climbed.outcome.ok ? null : this.installFaultIn(climbed)
    if (installFault === null) return { ladder: climbed.outcome, logs: climbed.logs, installFault }
    const { order, deps } = this.run
    const failedName = climbed.outcome.steps.find((s) => s.result === 'fail')?.name ?? order.id
    const installed = await deps.reinstall('change', this.logPath('reinstall', ''))
    await deps.record(
      'verify.reinstalled',
      failedName,
      `${failedName} failed because ${installFault}; reinstalled the dependencies (exit ${installed ?? 'not run'}).`
    )
    if (installed !== 0) return { ladder: climbed.outcome, logs: climbed.logs, installFault }
    const healed = await this.climbWith(this.steps, deps.runStep, '.reinstalled')
    deps.onEvent({ type: 'ladder', outcome: healed.outcome })
    const fault = healed.outcome.ok ? null : this.installFaultIn(healed)
    return { ladder: healed.outcome, logs: healed.logs, installFault: fault }
  }

  /** What is wrong with the installed dependencies, read from a failed step's log. */
  installFaultIn({ outcome, logs }: { outcome: LadderOutcome; logs: Map<string, string> }) {
    const failed = outcome.steps.find((s) => s.result === 'fail')
    const logPath = failed === undefined ? undefined : logs.get(failed.name)
    if (logPath === undefined || !fs.existsSync(logPath)) return null
    return brokenInstall(fs.readFileSync(logPath, 'utf8'))
  }

  // The same rungs on the base branch, up to the failed one, so a failure already
  // there is not sent back to a builder; the base checkout is let go regardless.
  async onBase(failedStep: StepOutcome): Promise<BaseCheck> {
    const upTo = this.steps.findIndex((s) => s.name === failedStep.name)
    const baseSteps = this.steps.slice(0, upTo + 1)
    try {
      const base = await this.climbBase(baseSteps)
      const failed = base.outcome.steps.find((s) => s.result === 'fail') ?? null
      const atStep = base.outcome.steps.find((s) => s.name === failedStep.name)
      return {
        onBase: baseVerdict(base.fault, { failed, atStep }),
        failed,
        logs: base.logs,
        fault: base.fault,
      }
    } finally {
      await this.run.deps.releaseBase()
    }
  }

  private async climbBase(baseSteps: readonly LadderStep[]) {
    const { deps } = this.run
    let base = await this.climbWith(baseSteps, deps.runStepOnBase, '.base')
    let fault = this.installFaultIn(base)
    if (fault !== null) {
      const installed = await deps.reinstall('base', this.logPath('reinstall', '.base'))
      if (installed === 0) {
        base = await this.climbWith(baseSteps, deps.runStepOnBase, '.base.reinstalled')
        fault = this.installFaultIn(base)
      }
    }
    return { ...base, fault }
  }
}

function baseVerdict(
  fault: string | null,
  { failed, atStep }: { failed: StepOutcome | null; atStep: StepOutcome | undefined }
): BaseCheck['onBase'] {
  if (fault !== null) return 'unknown'
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
  readonly climbed: Climbed
  readonly climber: FinalClimb
}

// The three rules that fire on what the change turned out to be, raised after the
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
  const { flaky } = after.climbed
  if (!run.halted && flaky !== null && !isFlakyAccepted(run.priorGates, flaky.name)) {
    await raiseFlaky(run, flaky)
  } else if (!run.halted && !after.climbed.ladder.ok) await raiseFailedCheck(run, after)
}

// A check that gave two answers on one commit: the person decides between fixing the
// test in this order and shipping with it named. Nothing is retried a third time.
async function raiseFlaky(run: Execution, flaky: Flaky): Promise<void> {
  const [failed, passed] = flaky.evidence
  const capped = sentBackCount(run, 'verify.flaky') >= MAX_FINAL_SEND_BACKS
  const command = flaky.command === null ? '' : `: \`${flaky.command}\``
  run.halted = await run.stopAtGate('verify.flaky', {
    evidence: [...flaky.evidence],
    summary: `${run.order.title} has a check that does not agree with itself`,
    why: `${flaky.name} failed with exit code ${failed.exitCode ?? 'unknown'} and passed with exit code ${passed.exitCode ?? 'unknown'} on the same commit${command}. A check that fails and passes on the same commit is a failure.${capped ? ' It has been sent back twice; accept it named, or hold.' : ''}`,
    omitOptions: capped ? ['send_back'] : undefined,
  })
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

function failedCheckOf({ ladder, logs }: Climbed): FailedCheck {
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
  const base =
    failed.step !== null && climbed.installFault === null
      ? await climber.onBase(failed.step)
      : BASE_UNKNOWN
  const baseBranch = run.order.context.repos[0]?.baseBranch ?? 'the base branch'
  if (base.onBase === 'fails' && base.failed !== null) {
    run.halted = await run.stopAtGate(
      'verify.base-fail',
      baseFailAsk(run, { failed, base, baseBranch })
    )
    return
  }
  const capped = sentBackCount(run, 'verify.repeat-fail') >= MAX_FINAL_SEND_BACKS
  const note = baseNote({ failed, base, baseBranch, installFault: climbed.installFault })
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

function baseNote({
  failed,
  base,
  baseBranch,
  installFault,
}: BaseFinding & { installFault: string | null }): string {
  if (failed.step === null) return ''
  if (installFault !== null) {
    return ` The installed dependencies are broken: ${installFault}, and reinstalling did not fix it.`
  }
  if (base.onBase === 'passes') return ` It passes on ${baseBranch} without this change.`
  if (base.fault !== null) return ` ${baseBranch} could not be checked: ${base.fault}.`
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
