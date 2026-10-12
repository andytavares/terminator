import * as fs from 'node:fs'
import * as path from 'node:path'

import { installCommandFor } from '../verify/toolchain-probe.js'
import type { LadderStep } from '../verify/ladder.js'
import { agentTitle } from '../runtime/agent-title.js'
import { runtime } from '../runtime/runtime-state.js'
import type { RunCommandOptions } from '../runtime/supervised-runner.js'
import type { ExecutorDeps } from './executor.js'
import { issueOf } from './order-project.js'
import { ensureBaseCheckout, removeBaseCheckout, unlinkBorrowedDependencies } from './worktree.js'
import type { Checkout } from './worktree.js'
import { firstLane, workspaceOf } from './run-context.js'
import type { RunContext } from './run-context.js'

/** A command in its own terminal tab in one checkout: what the tab says, and where it logs. */
interface CheckoutCommand {
  readonly title: string
  readonly command: string
  readonly logPath: string
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
  }
}

// A rung is a command, not a conversation: its inputs fully determine what
// it does and its verdict is its exit status. So it runs in a terminal tab
// of its own in the lane's checkout — visible, like everything else here —
// with no agent in between to spend a turn on it or a transcript to read
// the answer back out of.
export async function runStep(
  context: RunContext,
  step: LadderStep,
  logPath: string
): Promise<number | null> {
  if (step.command === null) return null
  const checkout = context.checkouts.get(firstLane(context.checkouts))
  const runner = runtime.supervisedRunner
  // Nothing ran, so nothing was measured — never a pass.
  if (checkout === undefined || runner === null) return null
  if (await context.passes.passed(checkout.path, step.command)) {
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

// The same rung on the base branch, to tell a failure the change caused
// from one that was already there. Never reads or writes the pass cache:
// a pass on the base says nothing about the change, and the reverse.
export async function runStepOnBase(
  context: RunContext,
  step: LadderStep,
  logPath: string
): Promise<number | null> {
  if (step.command === null) return null
  const runner = runtime.supervisedRunner
  if (runner === null) return null
  const { order, exec, root, base } = context
  const lane = firstLane(context.checkouts)
  try {
    base.current ??= await ensureBaseCheckout(order, lane, { exec, root })
  } catch {
    return null
  }
  const baseBranch = order.context.repos.find((r) => r.lane === lane)?.baseBranch ?? 'base'
  return runner.runCommand(
    commandIn(context, base.current, {
      title: `${step.name} on ${baseBranch}`,
      command: step.command,
      logPath,
    })
  )
}

// A broken install, mended in place. The borrowed links go first, so the
// install lands in this checkout and never writes into the origin's.
export async function reinstall(
  context: RunContext,
  where: 'change' | 'base',
  logPath: string
): Promise<number | null> {
  const runner = runtime.supervisedRunner
  if (runner === null) return null
  const lane = firstLane(context.checkouts)
  const checkout = where === 'base' ? context.base.current : (context.checkouts.get(lane) ?? null)
  if (checkout === null) return null
  const command = installCommandFor(checkout.path)
  if (command === null) return null
  await unlinkBorrowedDependencies(checkout, { exec: context.exec, root: context.root })
  return runner.runCommand(
    commandIn(context, checkout, { title: 'Reinstall dependencies', command, logPath })
  )
}

export async function releaseBase(context: RunContext): Promise<void> {
  const checkout = context.base.current
  if (checkout === null) return
  context.base.current = null
  await removeBaseCheckout(checkout, { exec: context.exec, root: context.root })
}

// A recipe `run` step whose command is not a slash instruction runs as a
// command in the lane's checkout, the same way `runStep` runs a gate's
// check — visible, and never handed to an agent that would report a
// pass regardless of what the command did.
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
