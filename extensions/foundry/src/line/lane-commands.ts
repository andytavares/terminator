import * as fs from 'node:fs'
import * as path from 'node:path'

import type { LadderStep } from '../verify/ladder.js'
import { PICTURES_STEP_NAME } from '../verify/ladder.js'
import { runPicturesStep } from './pictures.js'
import type { PicturesRecord } from './pictures.js'
import { agentTitle } from '../runtime/agent-title.js'
import { runtime } from '../runtime/runtime-state.js'
import type { RunCommandOptions } from '../runtime/supervised-runner.js'
import type { ExecutorDeps } from './executor.js'
import { issueOf } from './order-project.js'
import { unlinkBorrowedDependencies } from './worktree.js'
import type { Checkout } from './worktree.js'
import { firstLane, workspaceOf } from './run-context.js'
import type { RunContext } from './run-context.js'

/** A command in its own terminal tab in one checkout: what the tab says, and where it logs. */
interface CheckoutCommand {
  readonly title: string
  readonly command: string
  readonly logPath: string
  readonly env?: Record<string, string>
}

function commandIn(
  context: RunContext,
  checkout: Checkout,
  run: CheckoutCommand
): RunCommandOptions {
  return {
    worktreePath: checkout.path,
    workspaceId: workspaceOf(context.api, checkout),
    branch: checkout.branch,
    issue: issueOf(context.order),
    title: run.title,
    command: run.command,
    logPath: run.logPath,
    env: run.env,
  }
}

// A rung is a command, not a conversation: its inputs decide what it does and its
// exit status is the verdict. It runs visibly in its own tab in the lane's checkout,
// with no agent to spend a turn or transcript to read back.
export async function runLaneStep(
  context: RunContext,
  step: LadderStep,
  { logPath, fresh }: { readonly logPath: string; readonly fresh?: boolean }
): Promise<number | null> {
  if (step.command === null) return null
  const checkout = context.checkouts.get(firstLane(context.checkouts))
  const runner = runtime.supervisedRunner
  // Nothing ran, so nothing was measured — never a pass.
  if (checkout === undefined || runner === null) return null
  if (context.prepareFailed.has(firstLane(context.checkouts)))
    return notMeasuredBecauseUnprepared(logPath)
  if (step.name === PICTURES_STEP_NAME) return runPictures(context, step.command, logPath)
  // A repeat run exists to see whether the answer holds, so the cache must not give it.
  if (fresh !== true && (await context.passes.passed(checkout.path, step.command))) {
    await fs.promises.mkdir(path.dirname(logPath), { recursive: true })
    await fs.promises.writeFile(
      logPath,
      `${step.command} already passed on this exact commit earlier in this run; not run again.\n`
    )
    return 0
  }
  const exitCode = await runner.runCommand(
    commandIn(context, checkout, { title: step.name, command: step.command, logPath })
  )
  await context.passes.record(checkout.path, step.command, exitCode)
  return exitCode
}

// Never from the pass cache: a cached pass would leave no images. The command is told where
// to leave them, and what it left is recorded on the order and kept for the pull request.
async function runPictures(
  context: RunContext,
  command: string,
  logPath: string
): Promise<number | null> {
  const checkout = context.checkouts.get(firstLane(context.checkouts))
  const runner = runtime.supervisedRunner
  if (checkout === undefined || runner === null) return null
  const { exitCode, taken } = await runPicturesStep({
    featureDir: context.featureDir,
    now: Date.now,
    run: (folder) =>
      runner.runCommand(
        commandIn(context, checkout, {
          title: PICTURES_STEP_NAME,
          command,
          logPath,
          env: { FOUNDRY_PICTURES: folder },
        })
      ),
    record: (entry) => recordPictures(context, entry),
  })
  context.pictures.current = taken
  return exitCode
}

function recordPictures(context: RunContext, entry: PicturesRecord): Promise<void> {
  return context.store.record({
    at: new Date().toISOString(),
    orderId: context.order.id,
    actor: 'rule:line',
    action: 'verify.pictures',
    subject: PICTURES_STEP_NAME,
    reason: entry.reason,
    evidence: [...entry.evidence],
  })
}

// A check on a checkout whose dependencies never arrived says nothing about the change.
async function notMeasuredBecauseUnprepared(logPath: string): Promise<null> {
  await fs.promises.mkdir(path.dirname(logPath), { recursive: true })
  await fs.promises.writeFile(logPath, 'not measured: the checkout could not be prepared.\n')
  return null
}

/** What the line writes in the order's ledger: an action, what it was about, and why. */
export type LineRecorder = (action: string, subject: string, reason: string) => Promise<void>

/** The order's prepare command, run once in each checkout cut just now; a reattached one is left. */
export async function prepareNewCheckouts(
  context: RunContext,
  record: LineRecorder
): Promise<void> {
  const prepare = context.order.context.environment.prepare
  if (prepare === null) return
  for (const [lane, checkout] of context.checkouts) {
    if (checkout.created) await runPrepare(context, { lane, checkout, prepare }, record)
  }
}

async function runPrepare(
  context: RunContext,
  { lane, checkout, prepare }: { lane: number; checkout: Checkout; prepare: string },
  record: LineRecorder
): Promise<void> {
  const runner = runtime.supervisedRunner
  const logPath = path.join(context.featureDir, 'runs', `prepare-lane-${lane}.log`)
  // An install empties the folder it installs into; through a borrowed link that is the origin's.
  await unlinkBorrowedDependencies(checkout, { exec: context.exec, root: context.root })
  const exitCode =
    runner === null
      ? null
      : await runner.runCommand(
          commandIn(context, checkout, { title: 'Prepare the checkout', command: prepare, logPath })
        )
  if (exitCode === 0) {
    await record('checkout.prepared', checkout.repo, `\`${prepare}\` exited 0 in lane ${lane}`)
    return
  }
  context.prepareFailed.add(lane)
  const outcome = exitCode === null ? 'did not run' : `exited ${exitCode}`
  await record(
    'checkout.prepare-failed',
    checkout.repo,
    `\`${prepare}\` ${outcome} in lane ${lane}`
  )
}

// A broken install, mended in place. The borrowed links go first, so the
// install lands in this checkout and never writes into the origin's.
export async function reinstallDependencies(
  context: RunContext,
  where: 'change',
  logPath: string
): Promise<number | null> {
  const runner = runtime.supervisedRunner
  if (runner === null) return null
  const lane = firstLane(context.checkouts)
  const checkout = context.checkouts.get(lane) ?? null
  if (checkout === null) return null
  const command = context.order.context.environment.prepare
  if (command === null) return null
  await unlinkBorrowedDependencies(checkout, { exec: context.exec, root: context.root })
  return runner.runCommand(
    commandIn(context, checkout, { title: 'Reinstall dependencies', command, logPath })
  )
}

// A recipe `run` step that is not a slash instruction runs as a command in the lane's
// checkout, as `runLaneStep` runs a check, never through an agent that reports a pass.
export async function runRecipeCommand(
  context: RunContext,
  input: Parameters<ExecutorDeps['runCommand']>[0]
): Promise<number | null> {
  const checkout = context.checkouts.get(input.node.lane ?? firstLane(context.checkouts))
  const runner = runtime.supervisedRunner
  // Nothing ran, so nothing was measured — never a pass.
  if (checkout === undefined || runner === null) return null
  const exitCode = await runner.runCommand(
    commandIn(context, checkout, {
      title: agentTitle(input.title),
      command: input.command,
      logPath: input.logPath,
    })
  )
  await context.passes.record(checkout.path, input.command, exitCode)
  return exitCode
}
