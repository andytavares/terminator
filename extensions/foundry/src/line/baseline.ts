import * as fs from 'node:fs'
import * as path from 'node:path'

import { orderDir } from '../data-root.js'
import type { LedgerEntry } from '../ledger/append.js'
import type { WorkOrder } from '../order/schema.js'
import type { RunCommandOptions } from '../runtime/supervised-runner.js'
import { safeFilename } from './execution-parts.js'
import type { ShellExec } from './integrate.js'
import { issueOf } from './order-project.js'
import { ensureBaselineCheckout, removeBaseCheckout } from './worktree.js'
import { leadRepo } from '../order/lead-repo.js'
import type { Checkout } from './worktree.js'

// Commands run on a fresh checkout of the base branch, because a person asked for them
// (the operator's Prove, ADR 137). Nothing runs there on its own.

export interface BaselineDeps {
  readonly root: string
  /** The current time, ISO 8601. */
  readonly now: () => string
  readonly exec: ShellExec
  readonly runCommand: (options: RunCommandOptions) => Promise<number | null>
  readonly workspaceOf: (origin: string) => string
  readonly record: (entry: LedgerEntry) => Promise<void>
  /** Deletes the sidebar project that points at a checkout; true when one did. */
  readonly removeProjectAt?: (worktreePath: string) => boolean
}

interface Proof {
  readonly order: WorkOrder
  readonly deps: BaselineDeps
  /** The lane whose repository is used. */
  readonly lane: number
  readonly baseBranch: string
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

// One base checkout per order: two runs at once would each remove the other's.
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
    // The run opened a sidebar project for the checkout; it must not outlive the checkout,
    // so it goes first: a throwing removal below would otherwise leave it behind.
    proof.deps.removeProjectAt?.(checkout.path)
    await removeBaseCheckout(checkout, proof.deps)
  }
}

// Queued behind any run already going for the order: two would remove each
// other's @baseline checkout. Throws when it cannot check out.
export function runOnFreshBase(
  order: WorkOrder,
  deps: BaselineDeps,
  commands: readonly string[]
): Promise<FreshBaseRun> {
  return inQueue(order.id, () => runCommandsOnBase(proofOf(order, deps), commands))
}

function proofOf(order: WorkOrder, deps: BaselineDeps): Proof {
  const repo = leadRepo(order)
  if (repo === undefined) throw new Error('The order has no repository.')
  return { order, deps, lane: repo.lane, baseBranch: repo.baseBranch }
}
