import * as fs from 'node:fs'
import * as path from 'node:path'
import { writeJsonAtomic } from '@terminator/extension-sdk/node'

import { orderDir } from '../data-root.js'
import type { LedgerEntry } from '../ledger/append.js'
import type { WorkOrder } from '../order/schema.js'
import type { RunCommandOptions } from '../runtime/supervised-runner.js'
import { indexFor } from '../state/live-index.js'
import { climb, probedStep } from '../verify/ladder.js'
import type { LadderStep, StepOutcome } from '../verify/ladder.js'
import { recordExitCodes } from '../profile/proof.js'
import { lastLines, safeFilename } from './execution-parts.js'
import type { ShellExec } from './integrate.js'
import { issueOf } from './order-project.js'
import { failedStepSentence } from './baseline-steps.js'
import {
  ensureBaselineCheckout,
  removeBaseCheckout,
  unlinkBorrowedDependencies,
} from './worktree.js'
import type { Checkout } from './worktree.js'

// Whether the base branch builds and passes its mechanical checks, proven while
// an order is still being shaped. The final check reads this instead of running
// a command again on a base that has not moved.

export interface Baseline {
  readonly state: 'checking' | 'proven' | 'failing'
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly baseBranch: string
  readonly commit: string | null
  readonly steps: readonly StepOutcome[]
  /** The log of each step that ran, by step name. */
  readonly logs: Readonly<Record<string, string>>
  /** True when a failed step passed after the checkout was prepared again. */
  readonly mended: boolean
}

export interface BaselineDeps {
  readonly root: string
  /** The current time, ISO 8601. */
  readonly now: () => string
  readonly exec: ShellExec
  readonly runCommand: (options: RunCommandOptions) => Promise<number | null>
  readonly workspaceOf: (origin: string) => string
  readonly record: (entry: LedgerEntry) => Promise<void>
}

const EXCERPT_LINES = 20

const PREPARE_STEP = 'Prepare the checkout'

function commandStep(name: string, command: string, rung: LadderStep['rung']): LadderStep {
  return { rung, name, command, status: 'runnable', reason: '', check: null }
}

/**
 * What the order says to run, in order: the preparation, the checks it has a
 * command for, then the repository's additional checks.
 * @internal
 */
export function baselineSteps({ toolchain, environment }: WorkOrder['context']): LadderStep[] {
  const prepare =
    environment.prepare === null ? [] : [commandStep(PREPARE_STEP, environment.prepare, 'L0')]
  const checks = [
    probedStep(toolchain, 'format', { rung: 'L0', name: 'Format' }),
    probedStep(toolchain, 'lint', { rung: 'L0', name: 'Lint' }),
    probedStep(toolchain, 'test', { rung: 'L1', name: 'Tests' }),
    probedStep(toolchain, 'coverage', { rung: 'L2', name: 'Coverage' }),
    probedStep(toolchain, 'build', { rung: 'L5', name: 'Build' }),
    probedStep(toolchain, 'e2e', { rung: 'L5', name: 'End-to-end tests' }),
  ].filter((step) => step.status === 'runnable')
  const added = environment.additional.map((c) => commandStep(c.name, c.command, c.rung))
  return [...prepare, ...checks, ...added]
}

function baselinePath(root: string, orderId: string): string {
  return path.join(orderDir(root, orderId), 'baseline.json')
}

/** A missing or unreadable file is no baseline, never a thrown surface. */
export async function readBaseline(root: string, orderId: string): Promise<Baseline | null> {
  try {
    return JSON.parse(await fs.promises.readFile(baselinePath(root, orderId), 'utf8')) as Baseline
  } catch {
    return null
  }
}

/** @internal */
export async function writeBaseline(
  root: string,
  orderId: string,
  baseline: Baseline
): Promise<void> {
  await fs.promises.mkdir(orderDir(root, orderId), { recursive: true })
  await writeJsonAtomic(baselinePath(root, orderId), baseline)
  indexFor(root).announce({ kind: 'graph', orderId })
}

/** The exit code `command` recorded as a pass on this very commit, or null. A failure is run again. */
export function recordedOnBase(
  baseline: Baseline | null,
  command: string,
  commit: string | null
): number | null {
  if (baseline === null || commit === null || baseline.commit !== commit) return null
  const passed = baseline.steps.find((step) => step.command === command && step.result === 'pass')
  return passed?.exitCode ?? null
}

interface Proof {
  readonly order: WorkOrder
  readonly deps: BaselineDeps
  /** The lane whose repository is proved, and where its stored profile lives. */
  readonly lane: number
  readonly repoPath: string
  readonly baseBranch: string
  readonly startedAt: string
}

async function readCommit(proof: Proof, checkout: Checkout): Promise<string | null> {
  const { stdout, exitCode } = await proof.deps.exec({
    command: 'git',
    args: ['rev-parse', 'HEAD'],
    cwd: checkout.path,
  })
  return exitCode === 0 ? stdout.trim() : null
}

function logPathFor(proof: Proof, name: string): string {
  const stamp = safeFilename(proof.deps.now())
  const file = `baseline-${safeFilename(name)}.${stamp}.log`
  return path.join(orderDir(proof.deps.root, proof.order.id), 'runs', file)
}

async function runOnBase(
  proof: Proof,
  checkout: Checkout,
  run: { title: string; command: string; logPath: string }
): Promise<number | null> {
  await fs.promises.mkdir(path.dirname(run.logPath), { recursive: true })
  return proof.deps.runCommand({
    worktreePath: checkout.path,
    workspaceId: proof.deps.workspaceOf(checkout.origin),
    branch: checkout.branch,
    issue: issueOf(proof.order),
    ...run,
  })
}

interface Pass {
  readonly steps: StepOutcome[]
  readonly logs: Record<string, string>
}

// One step at a time: `climb` stops at the first failure, and every check is wanted here.
async function runSteps(proof: Proof, checkout: Checkout, steps: LadderStep[]): Promise<Pass> {
  const pass: Pass = { steps: [], logs: {} }
  for (const step of steps) {
    const logPath = logPathFor(proof, step.name)
    const outcome = await climb([step], (ran) =>
      runOnBase(proof, checkout, {
        title: `${ran.name} on ${proof.baseBranch}`,
        command: ran.command ?? '',
        logPath,
      })
    )
    pass.steps.push(...outcome.steps)
    if (outcome.steps[0]?.result !== 'not_measured') pass.logs[step.name] = logPath
  }
  return pass
}

function failedIn(pass: Pass): StepOutcome[] {
  return pass.steps.filter((step) => step.result === 'fail')
}

async function prepareAgain(proof: Proof, checkout: Checkout, command: string): Promise<void> {
  await unlinkBorrowedDependencies(checkout, { exec: proof.deps.exec, root: proof.deps.root })
  await runOnBase(proof, checkout, {
    title: 'Prepare the checkout again',
    command,
    logPath: logPathFor(proof, 'Prepare the checkout again'),
  })
}

interface Finding {
  readonly pass: Pass
  readonly mended: boolean
}

/** The first pass with each rerun step in place of the one that failed. */
function withReruns(first: Pass, again: Pass): Finding {
  const rerun = new Map(again.steps.map((step) => [step.name, step]))
  return {
    pass: {
      steps: first.steps.map((step) => rerun.get(step.name) ?? step),
      logs: { ...first.logs, ...again.logs },
    },
    mended: again.steps.some((step) => step.result === 'pass'),
  }
}

// A step that failed is run once more after the preparation ran again: a checkout
// broken by its install fails the same way a broken change does, so nothing reads a log.
async function checkAndMend(proof: Proof, checkout: Checkout): Promise<Finding> {
  const steps = baselineSteps(proof.order.context)
  const first = await runSteps(proof, checkout, steps)
  const failed = failedIn(first).map((step) => step.name)
  const { prepare } = proof.order.context.environment
  if (prepare === null || failed.length === 0 || failed.includes(PREPARE_STEP)) {
    return { pass: first, mended: false }
  }
  await prepareAgain(proof, checkout, prepare)
  const again = await runSteps(
    proof,
    checkout,
    steps.filter((step) => failed.includes(step.name))
  )
  return withReruns(first, again)
}

function failureReason(proof: Proof, pass: Pass): string {
  const failed = failedIn(pass)
  if (failed.length > 0) return failed.map((s) => failedStepSentence(s, proof.baseBranch)).join(' ')
  const why =
    pass.steps.length === 0
      ? 'this repository has no format, lint, test or build command'
      : `${pass.steps.map((step) => step.name).join(', ')} did not run`
  return `Nothing could be measured on ${proof.baseBranch}: ${why}.`
}

async function failureEvidence(pass: Pass): Promise<LedgerEntry['evidence']> {
  return Promise.all(
    failedIn(pass).map(async (step) => {
      const logPath = pass.logs[step.name] ?? ''
      const text = await fs.promises.readFile(logPath, 'utf8').catch(() => '')
      return {
        kind: 'stdout',
        path: logPath,
        exitCode: step.exitCode ?? undefined,
        excerpt: lastLines(text, EXCERPT_LINES),
      }
    })
  )
}

async function announce(
  proof: Proof,
  entry: Pick<LedgerEntry, 'action' | 'reason' | 'evidence'>
): Promise<void> {
  await proof.deps.record({
    at: proof.deps.now(),
    orderId: proof.order.id,
    actor: 'rule:environment',
    subject: proof.baseBranch,
    ...entry,
  })
}

function baselineOf(proof: Proof, rest: Partial<Baseline>): Baseline {
  return {
    state: 'checking',
    startedAt: proof.startedAt,
    finishedAt: null,
    baseBranch: proof.baseBranch,
    commit: null,
    steps: [],
    logs: {},
    mended: false,
    ...rest,
  }
}

// Nothing failed and a check passed: a step that did not run is not a pass, and neither
// is a preparation, which measures nothing.
function isProven(pass: Pass): boolean {
  return (
    failedIn(pass).length === 0 &&
    pass.steps.some((step) => step.result === 'pass' && step.name !== PREPARE_STEP)
  )
}

function exitCodesOf(pass: Pass): Record<string, number | null> {
  const ran = pass.steps.filter((step) => step.command !== null)
  return Object.fromEntries(ran.map((step) => [step.command, step.exitCode]))
}

// The profile's copy is a courtesy to the next order: failing to write it must not
// turn a proof that was recorded into one that could not be checked.
async function keepInProfile(proof: Proof, commit: string | null, pass: Pass): Promise<void> {
  if (commit === null) return
  const result = { commit, at: proof.deps.now(), exitCodes: exitCodesOf(pass) }
  await recordExitCodes(proof.deps.root, proof.repoPath, result).catch(() => undefined)
}

async function recordOutcome(proof: Proof, commit: string | null, found: Finding): Promise<void> {
  const state = isProven(found.pass) ? 'proven' : 'failing'
  await writeBaseline(
    proof.deps.root,
    proof.order.id,
    baselineOf(proof, {
      state,
      finishedAt: proof.deps.now(),
      commit,
      steps: found.pass.steps,
      logs: found.pass.logs,
      mended: found.mended,
    })
  )
  await keepInProfile(proof, commit, found.pass)
  await announce(proof, {
    action: `environment.${state}`,
    reason:
      state === 'proven'
        ? `${proof.baseBranch} builds and passes its checks.`
        : failureReason(proof, found.pass),
    evidence: await failureEvidence(found.pass),
  })
}

async function proveOnCheckout(proof: Proof): Promise<void> {
  const checkout = await ensureBaselineCheckout(proof.order, proof.lane, proof.deps)
  try {
    const commit = await readCommit(proof, checkout)
    await recordOutcome(proof, commit, await checkAndMend(proof, checkout))
  } finally {
    await removeBaseCheckout(checkout, proof.deps)
  }
}

// One base checkout per order: two things proving at once would each remove the other's.
const queues = new Map<string, Promise<unknown>>()

function inQueue<T>(orderId: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(orderId) ?? Promise.resolve()).catch(() => undefined).then(task)
  queues.set(orderId, next)
  const forget = (): void => {
    if (queues.get(orderId) === next) queues.delete(orderId)
  }
  next.then(forget, forget)
  return next
}

/** What commands ended with on a fresh checkout of the base branch. */
export interface FreshBaseRun {
  readonly commit: string | null
  /** By command. */
  readonly exitCodes: Readonly<Record<string, number | null>>
  readonly logPaths: Readonly<Record<string, string>>
}

async function runCommandsOnBase(proof: Proof, commands: readonly string[]): Promise<FreshBaseRun> {
  const checkout = await ensureBaselineCheckout(proof.order, proof.lane, proof.deps)
  try {
    const commit = await readCommit(proof, checkout)
    const exitCodes: Record<string, number | null> = {}
    const logPaths: Record<string, string> = {}
    for (const [index, command] of commands.entries()) {
      logPaths[command] = logPathFor(proof, `Command ${index + 1}`)
      const title = `${command} on ${proof.baseBranch}`
      exitCodes[command] = await runOnBase(proof, checkout, {
        title,
        command,
        logPath: logPaths[command],
      })
    }
    return { commit, exitCodes, logPaths }
  } finally {
    await removeBaseCheckout(checkout, proof.deps)
  }
}

/**
 * Each command in a terminal tab of its own on a fresh checkout of the order's first
 * repository, after any proof already running for the order. Throws when it cannot check out.
 */
export function runOnFreshBase(
  order: WorkOrder,
  deps: BaselineDeps,
  commands: readonly string[]
): Promise<FreshBaseRun> {
  return inQueue(order.id, () => runCommandsOnBase(proofOf(order, deps), commands))
}

async function recordCouldNotCheck(proof: Proof, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  await writeBaseline(
    proof.deps.root,
    proof.order.id,
    baselineOf(proof, { state: 'failing', finishedAt: proof.deps.now() })
  )
  await announce(proof, {
    action: 'environment.failing',
    reason: `Could not check ${proof.baseBranch}: ${message}.`,
    evidence: [],
  })
}

const inFlight = new Map<string, Promise<void>>()

/** Whether a proof for this order is running now. Reads memory only. */
export function isProving(orderId: string): boolean {
  return inFlight.has(orderId)
}

/** Never throws: a failure is recorded. A second call joins the running proof. */
export function proveEnvironment(order: WorkOrder, deps: BaselineDeps): Promise<void> {
  const running = inFlight.get(order.id)
  if (running !== undefined) return running
  const proof = prove(order, deps).finally(() => inFlight.delete(order.id))
  inFlight.set(order.id, proof)
  return proof
}

function proofOf(order: WorkOrder, deps: BaselineDeps): Proof {
  const repo = [...order.context.repos].sort((a, b) => a.lane - b.lane)[0]
  if (repo === undefined) throw new Error('The order has no repository.')
  return {
    order,
    deps,
    lane: repo.lane,
    repoPath: repo.path,
    baseBranch: repo.baseBranch,
    startedAt: deps.now(),
  }
}

async function prove(order: WorkOrder, deps: BaselineDeps): Promise<void> {
  if (order.context.repos.length === 0) return
  const proof = proofOf(order, deps)
  try {
    await writeBaseline(deps.root, order.id, baselineOf(proof, {}))
    await announce(proof, {
      action: 'environment.checking',
      reason: `Checking that ${proof.baseBranch} builds and passes its checks before any work starts.`,
      evidence: [],
    })
    await inQueue(order.id, () => proveOnCheckout(proof))
  } catch (error) {
    await recordCouldNotCheck(proof, error).catch(() => undefined)
  }
}
