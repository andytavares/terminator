import * as path from 'node:path'
import { orderDir } from '../data-root.js'
import type { WorkOrder } from '../order/schema.js'
import type { ShellExec } from './integrate.js'

// Somewhere for a lane's work to happen.
//
// A git worktree, one per lane, cut from the lane's own repository. It lives
// under the data root, not inside the repository: a checkout in
// `<repo>/.foundry-worktrees/` would be a directory Foundry created in a
// working tree it was only asked to change, which is the one thing it does not
// do (ADR-042). Git records the worktree under `.git/worktrees/`, which is
// metadata rather than working tree — `git status` stays clean, and that is
// what the portability test measures.

export class CheckoutFailedError extends Error {
  readonly code = 'CHECKOUT_FAILED'
  constructor(repo: string, stderr: string) {
    super(`Could not prepare a checkout for ${repo}: ${stderr.trim()}`)
    this.name = 'CheckoutFailedError'
  }
}

export interface Checkout {
  readonly repo: string
  /** The repository the worktree was cut from. */
  readonly origin: string
  readonly path: string
  readonly branch: string
  /** False when the worktree was already there — a resumed run. */
  readonly created: boolean
}

export interface CheckoutDeps {
  readonly exec: ShellExec
  /** The resolved data root. Worktrees live under it, never in a repository. */
  readonly root: string
}

/**
 * The branch a lane works on.
 *
 * The tracker's own suggested name when the order carries one — an issue's
 * branch name is what the operator will recognise on the remote — and
 * otherwise one derived from the order id, which is unique by construction.
 */
export function branchFor(order: WorkOrder, lane: number): string {
  const declared = order.plan.lanes.find((l) => l.ord === lane)?.branch.trim() ?? ''
  if (declared !== '') return declared
  const fromRepo = order.context.repos.find((r) => r.lane === lane)?.headBranch.trim() ?? ''
  if (fromRepo !== '') return fromRepo
  return `foundry/${order.id.toLowerCase()}`
}

export function checkoutPath(root: string, order: WorkOrder, repo: string): string {
  return path.join(orderDir(root, order.id), 'worktrees', repo)
}

/**
 * Prepare one lane's checkout, or find the one already there.
 *
 * Idempotent on purpose: a run that is resumed, retried or observed must not
 * get a second worktree, and `git worktree add` onto an existing path fails
 * rather than reusing it.
 */
export async function ensureCheckout(
  order: WorkOrder,
  lane: number,
  deps: CheckoutDeps
): Promise<Checkout> {
  const repo = order.context.repos.find((r) => r.lane === lane)
  if (repo === undefined)
    throw new CheckoutFailedError(`lane ${lane}`, 'the order has no such lane')

  const branch = branchFor(order, lane)
  const target = checkoutPath(deps.root, order, repo.name)

  // Ask git, rather than the filesystem: a directory that exists but is not a
  // registered worktree is not a checkout, and reusing it would put the agent
  // somewhere git does not know about.
  const listed = await deps.exec({
    command: 'git',
    args: ['worktree', 'list', '--porcelain'],
    cwd: repo.path,
    timeoutMs: 30_000,
  })
  if (listed.exitCode === 0 && listed.stdout.includes(`worktree ${target}`)) {
    return { repo: repo.name, origin: repo.path, path: target, branch, created: false }
  }

  // `-B` rather than `-b`: a branch left over from a previous attempt is reset
  // onto the base rather than failing the run with "already exists". The base
  // is named explicitly so this does not depend on what is checked out.
  const added = await deps.exec({
    command: 'git',
    args: ['worktree', 'add', '-B', branch, target, repo.baseBranch],
    cwd: repo.path,
    timeoutMs: 120_000,
  })
  if (added.exitCode !== 0) throw new CheckoutFailedError(repo.name, added.stderr)

  return { repo: repo.name, origin: repo.path, path: target, branch, created: true }
}

/**
 * Every lane's checkout, in lane order.
 *
 * All of them before any agent starts: a run that provisions lane 2 half way
 * through, and fails, has already spent lane 1's agent budget.
 */
export async function ensureCheckouts(
  order: WorkOrder,
  deps: CheckoutDeps
): Promise<Map<number, Checkout>> {
  const out = new Map<number, Checkout>()
  for (const repo of [...order.context.repos].sort((a, b) => a.lane - b.lane)) {
    out.set(repo.lane, await ensureCheckout(order, repo.lane, deps))
  }
  return out
}

/** Take a lane's checkout away again. Best effort; never throws. */
export async function removeCheckout(checkout: Checkout, deps: CheckoutDeps): Promise<boolean> {
  const removed = await deps.exec({
    command: 'git',
    args: ['worktree', 'remove', '--force', checkout.path],
    cwd: checkout.origin,
    timeoutMs: 60_000,
  })
  return removed.exitCode === 0
}
