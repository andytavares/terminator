import * as fs from 'node:fs'
import * as path from 'node:path'
import { writeJsonAtomic } from '@terminator/extension-sdk/node'

import { orderDir } from '../data-root.js'
import type { LedgerEntry } from '../ledger/append.js'
import type { WorkOrder } from '../order/schema.js'
import type { RunCommandOptions } from '../runtime/supervised-runner.js'
import { indexFor } from '../state/live-index.js'
import { brokenInstall } from '../verify/broken-install.js'
import { climb, probedStep } from '../verify/ladder.js'
import type { LadderStep, StepOutcome } from '../verify/ladder.js'
import { installCommandFor, probeToolchain } from '../verify/toolchain-probe.js'
import type { Toolchain } from '../verify/toolchain-probe.js'
import { lastLines, safeFilename } from './execution-parts.js'
import type { ShellExec } from './integrate.js'
import { issueOf } from './order-project.js'
import { ensureBaseCheckout, removeBaseCheckout, unlinkBorrowedDependencies } from './worktree.js'
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
  /** True when a broken install was reinstalled and the checks run again. */
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

export function baselineSteps(toolchain: Toolchain): LadderStep[] {
  return [
    probedStep(toolchain, 'format', { rung: 'L0', name: 'Format' }),
    probedStep(toolchain, 'lint', { rung: 'L0', name: 'Lint' }),
    probedStep(toolchain, 'test', { rung: 'L1', name: 'Tests' }),
    probedStep(toolchain, 'build', { rung: 'L5', name: 'Build' }),
  ].filter((step) => step.status === 'runnable')
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

export async function writeBaseline(
  root: string,
  orderId: string,
  baseline: Baseline
): Promise<void> {
  await fs.promises.mkdir(orderDir(root, orderId), { recursive: true })
  await writeJsonAtomic(baselinePath(root, orderId), baseline)
  indexFor(root).announce({ kind: 'graph', orderId })
}

/** The exit code `command` recorded on this very commit, or null when it did not run there. */
export function recordedOnBase(
  baseline: Baseline | null,
  command: string,
  commit: string | null
): number | null {
  if (baseline === null || commit === null || baseline.commit !== commit) return null
  const ran = baseline.steps.find(
    (step) => step.command === command && (step.result === 'pass' || step.result === 'fail')
  )
  return ran?.exitCode ?? null
}

interface Proof {
  readonly order: WorkOrder
  readonly deps: BaselineDeps
  readonly repoPath: string
  readonly baseBranch: string
  readonly startedAt: string
}

async function readCommit(proof: Proof): Promise<string | null> {
  const { stdout, exitCode } = await proof.deps.exec({
    command: 'git',
    args: ['rev-parse', proof.baseBranch],
    cwd: proof.repoPath,
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

async function installFaultIn(pass: Pass): Promise<boolean> {
  for (const step of failedIn(pass)) {
    const log = await fs.promises.readFile(pass.logs[step.name] ?? '', 'utf8').catch(() => '')
    if (brokenInstall(log) !== null) return true
  }
  return false
}

async function reinstall(proof: Proof, checkout: Checkout): Promise<void> {
  const command = installCommandFor(checkout.path)
  if (command === null) return
  await unlinkBorrowedDependencies(checkout, { exec: proof.deps.exec, root: proof.deps.root })
  await runOnBase(proof, checkout, {
    title: 'Reinstall dependencies',
    command,
    logPath: logPathFor(proof, 'Reinstall dependencies'),
  })
}

interface Finding {
  readonly pass: Pass
  readonly mended: boolean
}

async function checkAndMend(proof: Proof, checkout: Checkout): Promise<Finding> {
  const steps = baselineSteps(probeToolchain(checkout.path))
  const first = await runSteps(proof, checkout, steps)
  if (!(await installFaultIn(first))) return { pass: first, mended: false }
  await reinstall(proof, checkout)
  return { pass: await runSteps(proof, checkout, steps), mended: true }
}

function failureReason(proof: Proof, failed: StepOutcome[]): string {
  return failed
    .map(
      (step) =>
        `${step.name} failed on ${proof.baseBranch} with exit code ${step.exitCode}: \`${step.command}\`.`
    )
    .join(' ')
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

async function settle(proof: Proof, commit: string | null, found: Finding): Promise<void> {
  const failed = failedIn(found.pass)
  const state = failed.length === 0 ? 'proven' : 'failing'
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
  await announce(proof, {
    action: `environment.${state}`,
    reason:
      state === 'proven'
        ? `${proof.baseBranch} builds and passes its checks.`
        : failureReason(proof, failed),
    evidence: await failureEvidence(found.pass),
  })
}

async function proveOnCheckout(proof: Proof, lane: number): Promise<void> {
  const commit = await readCommit(proof)
  const checkout = await ensureBaseCheckout(proof.order, lane, proof.deps)
  try {
    await settle(proof, commit, await checkAndMend(proof, checkout))
  } finally {
    await removeBaseCheckout(checkout, proof.deps)
  }
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

/** Prove the base branch builds and passes its checks. Never throws: a failure is recorded. */
export async function proveEnvironment(order: WorkOrder, deps: BaselineDeps): Promise<void> {
  const repo = [...order.context.repos].sort((a, b) => a.lane - b.lane)[0]
  if (repo === undefined) return
  const proof: Proof = {
    order,
    deps,
    repoPath: repo.path,
    baseBranch: repo.baseBranch,
    startedAt: deps.now(),
  }
  try {
    await writeBaseline(deps.root, order.id, baselineOf(proof, {}))
    await announce(proof, {
      action: 'environment.checking',
      reason: `Checking that ${proof.baseBranch} builds and passes its checks before any work starts.`,
      evidence: [],
    })
    await proveOnCheckout(proof, repo.lane)
  } catch (error) {
    await recordCouldNotCheck(proof, error).catch(() => undefined)
  }
}
