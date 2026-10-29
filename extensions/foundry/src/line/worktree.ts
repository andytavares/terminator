import * as fs from 'node:fs'
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

/** @internal */
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
  /** The folders the origin's install lends, from the order's environment. */
  readonly share: readonly string[]
}

export interface CheckoutDeps {
  readonly exec: ShellExec
  /** The resolved data root. Worktrees live under it, never in a repository. */
  readonly root: string
  /** Where a fallback to the local base branch is said; the caller decides where it goes. */
  readonly note?: (message: string) => void
}

/** Beside the lane's checkout: present when Foundry cut the lane's branch itself. */
export function createdBranchMarker(target: string): string {
  return `${target}.branch-created`
}

/**
 * The branch a lane works on.
 *
 * The tracker's own suggested name when the order carries one — an issue's
 * branch name is what the operator will recognise on the remote — and
 * otherwise one derived from the order id, which is unique by construction.
 */
export function branchFor(order: WorkOrder, lane: number): string {
  const fromSource = order.source.branch?.trim() ?? ''
  if (fromSource !== '') return fromSource
  const declared = order.plan.lanes.find((l) => l.ord === lane)?.branch.trim() ?? ''
  if (declared !== '') return declared
  const fromRepo = order.context.repos.find((r) => r.lane === lane)?.headBranch.trim() ?? ''
  if (fromRepo !== '') return fromRepo
  return `foundry/${order.id.toLowerCase()}`
}

export function checkoutPath(root: string, order: WorkOrder, repo: string): string {
  return path.join(orderDir(root, order.id), 'worktrees', repo)
}

// The scout and the architect's first turn both prepare lane 1 as an order
// starts. Each would see no worktree and run its own `worktree add`, and git
// refuses the second with "cannot lock ref … reference already exists".
const inFlight = new Map<string, Promise<Checkout>>()

/**
 * Prepare one lane's checkout, or find the one already there.
 *
 * Idempotent on purpose: a run that is resumed, retried or observed must not
 * get a second worktree, and `git worktree add` onto an existing path fails
 * rather than reusing it. Callers asking at once share one preparation.
 */
export function ensureCheckout(
  order: WorkOrder,
  lane: number,
  deps: CheckoutDeps
): Promise<Checkout> {
  return sharedCheckout({ order, lane, reattachOnly: false }, deps)
}

/** The lane's checkout on its existing branch, never a new or reset one: for pushed work,
 * a branch cut afresh from the base and force-pushed would replace the pull request. */
export function reattachCheckout(
  order: WorkOrder,
  lane: number,
  deps: CheckoutDeps
): Promise<Checkout> {
  return sharedCheckout({ order, lane, reattachOnly: true }, deps)
}

interface CheckoutRequest {
  readonly order: WorkOrder
  readonly lane: number
  readonly reattachOnly: boolean
}

function sharedCheckout(
  { order, lane, reattachOnly }: CheckoutRequest,
  deps: CheckoutDeps
): Promise<Checkout> {
  const repo = order.context.repos.find((r) => r.lane === lane)
  if (repo === undefined)
    return Promise.reject(new CheckoutFailedError(`lane ${lane}`, 'the order has no such lane'))

  const target = checkoutPath(deps.root, order, repo.name)
  const pending = inFlight.get(target)
  if (pending !== undefined) return pending
  const share = order.context.environment.share
  const plan = { repo, target, branch: branchFor(order, lane), reattachOnly, share }
  const preparing = prepareCheckout(plan, deps).finally(() => inFlight.delete(target))
  inFlight.set(target, preparing)
  return preparing
}

/** Where a lane's checkout goes, from which repository, on which branch. */
interface CheckoutPlan {
  readonly repo: WorkOrder['context']['repos'][number]
  readonly target: string
  readonly branch: string
  /** Only check out the existing branch; refuse when it is gone. */
  readonly reattachOnly: boolean
  readonly share: readonly string[]
}

type WorktreeState = 'absent' | 'present' | 'stale'

// Asked of git, since an unregistered directory is not a checkout. Stale: registered with
// the folder gone. Records are matched whole, so `<target>@baseline` is not `<target>`.
async function worktreeState(
  origin: string,
  target: string,
  deps: CheckoutDeps
): Promise<WorktreeState> {
  const listed = await deps.exec({
    command: 'git',
    args: ['worktree', 'list', '--porcelain'],
    cwd: origin,
    timeoutMs: 30_000,
  })
  if (listed.exitCode !== 0) return 'absent'
  const record = listed.stdout
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/))
    .find((lines) => lines.includes(`worktree ${resolvedPath(target)}`))
  if (record === undefined) return 'absent'
  const gone = record.some((line) => line.startsWith('prunable')) || !isDirectoryAt(target)
  return gone ? 'stale' : 'present'
}

async function branchExists(
  repo: CheckoutPlan['repo'],
  branch: string,
  deps: CheckoutDeps
): Promise<boolean> {
  const found = await deps.exec({
    command: 'git',
    args: ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
    cwd: repo.path,
    timeoutMs: 30_000,
  })
  return found.exitCode === 0
}

interface WorktreeAddition {
  readonly target: string
  /** The flags for a fresh add that cuts a new ref, before the target. */
  readonly how: readonly string[]
  /** The lane's branch: an existing one is checked out as it is, commits kept. */
  readonly branch?: string
  readonly reattachOnly?: boolean
}

// Locked at creation, without a race: a locked registration is never pruned, by Foundry
// or by anyone else running `git worktree prune` in the repository.
async function runAdd(
  repo: CheckoutPlan['repo'],
  args: readonly string[],
  deps: CheckoutDeps
): Promise<void> {
  const added = await deps.exec({
    command: 'git',
    args: ['worktree', 'add', '--lock', ...args],
    cwd: repo.path,
    timeoutMs: 120_000,
  })
  if (added.exitCode !== 0) throw new CheckoutFailedError(repo.name, added.stderr)
}

// Where a new branch is cut from: `origin/<base>` after one fetch, so a lane does not
// start behind the remote. No remote, or a failed fetch, falls back to the local base.
async function startPointFor(repo: CheckoutPlan['repo'], deps: CheckoutDeps): Promise<string> {
  const base = repo.baseBranch
  const remotes = await deps.exec({
    command: 'git',
    args: ['remote'],
    cwd: repo.path,
    timeoutMs: 30_000,
  })
  if (!remotes.stdout.split(/\r?\n/).includes('origin')) {
    deps.note?.(`${repo.name} has no origin remote; cut from the local ${base}`)
    return base
  }
  const fetched = await deps.exec({
    command: 'git',
    args: ['fetch', 'origin', base],
    cwd: repo.path,
    timeoutMs: 120_000,
  })
  if (fetched.exitCode === 0) return `origin/${base}`
  deps.note?.(
    `fetching origin/${base} failed (${fetched.stderr.trim()}); cut from the local ${base}`
  )
  return base
}

type Addition = 'present' | 'attached' | 'cut'

// A stale registration (folder gone, still locked) is replaced with `--force --force`,
// never `git worktree prune`: that drops every lane's stale registration, and those lanes
// would then be cut afresh from the base, losing their commits.
async function addWorktree(
  repo: CheckoutPlan['repo'],
  addition: WorktreeAddition,
  deps: CheckoutDeps
): Promise<Addition> {
  const { target, how, branch, reattachOnly } = addition
  const state = await worktreeState(repo.path, target, deps)
  if (state === 'present') return 'present'
  const force = state === 'stale' ? ['--force', '--force'] : []
  if (branch !== undefined && (await branchExists(repo, branch, deps))) {
    await runAdd(repo, [...force, target, branch], deps)
    return 'attached'
  }
  if (reattachOnly === true)
    throw new CheckoutFailedError(repo.name, `the branch ${branch ?? ''} no longer exists`)
  await runAdd(repo, [...force, ...how, target, await startPointFor(repo, deps)], deps)
  return 'cut'
}

function markBranchCreated(target: string): void {
  try {
    fs.writeFileSync(createdBranchMarker(target), '')
  } catch {
    // unmarked, the branch is kept at teardown: the safe side
  }
}

async function prepareCheckout(plan: CheckoutPlan, deps: CheckoutDeps): Promise<Checkout> {
  const { repo, target, branch, reattachOnly, share } = plan
  // `-b`: a branch that already exists is attached as it is, never reset, because it may
  // be the operator's own (a tracker's suggested name).
  const added = await addWorktree(repo, { target, how: ['-b', branch], branch, reattachOnly }, deps)
  if (added === 'cut') markBranchCreated(target)
  const checkout = {
    repo: repo.name,
    origin: repo.path,
    path: target,
    branch,
    created: added !== 'present',
    share,
  }
  await provisionDependencies(checkout, deps)
  return checkout
}

/** Every directory holding a tracked file, the root as `.`; null when git cannot say. */
async function trackedDirs(checkout: Checkout, deps: CheckoutDeps): Promise<string[] | null> {
  const listed = await deps.exec({
    command: 'git',
    args: ['ls-files', '-z'],
    cwd: checkout.path,
    timeoutMs: 30_000,
  })
  if (listed.exitCode !== 0) return null
  const dirs = listed.stdout
    .split('\0')
    .filter((file) => file !== '')
    .map((file) => path.dirname(file))
  return [...new Set(dirs)]
}

// Beside every directory holding a tracked file, the root included, so one entry covers
// a monorepo's per-package installs; never inside the shared folder itself.
async function lendingPlaces(checkout: Checkout, deps: CheckoutDeps): Promise<string[] | null> {
  const dirs = await trackedDirs(checkout, deps)
  if (dirs === null) return null
  return checkout.share.flatMap((entry) =>
    dirs.filter((dir) => !dir.split('/').includes(entry)).map((dir) => path.join(dir, entry))
  )
}

/**
 * Give a lane's worktree the origin's installed dependencies.
 *
 * `git worktree add` copies no installed dependencies, so every check command in
 * the lane fails before it ever reads the change. Symlinking each folder of the
 * order's share list in from the origin is safe only where the repository already
 * ignores it: anything else would leave an untracked file in a target
 * repository, which is the one thing rule 1 forbids, so a link that
 * `git check-ignore` disowns is removed again immediately. Never throws — a
 * failure here should not turn "the checkout was fine, the tools were slow"
 * into a checkout failure.
 * @internal
 */
export async function provisionDependencies(
  checkout: Checkout,
  deps: CheckoutDeps
): Promise<string[]> {
  const linked: string[] = []
  if (checkout.share.length === 0) return linked
  try {
    for (const place of (await lendingPlaces(checkout, deps)) ?? []) {
      if (await lendFolder(checkout, place, deps)) linked.push(place)
    }
  } catch {
    return linked
  }
  return linked
}

/** Links the origin's folder at `place` into the checkout, where git ignores it. */
async function lendFolder(checkout: Checkout, place: string, deps: CheckoutDeps): Promise<boolean> {
  const originFolder = path.join(checkout.origin, place)
  const worktreeFolder = path.join(checkout.path, place)
  if (!isDirectoryAt(originFolder) || entryExists(worktreeFolder)) return false
  try {
    fs.symlinkSync(originFolder, worktreeFolder, 'dir')
  } catch {
    return false
  }
  const ignored = await deps.exec({
    command: 'git',
    args: ['check-ignore', '-q', place],
    cwd: checkout.path,
    timeoutMs: 30_000,
  })
  if (ignored.exitCode === 0) return true
  try {
    fs.unlinkSync(worktreeFolder)
  } catch {
    // best effort — nothing else to do if this fails too
  }
  return false
}

// git lists a worktree with symlinks resolved (macOS `/var` is `/private/var`); the target
// itself may not exist yet, so the nearest existing ancestor is resolved.
function resolvedPath(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    return path.join(resolvedPath(path.dirname(target)), path.basename(target))
  }
}

function isDirectoryAt(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory()
  } catch {
    return false
  }
}

/** Whether anything is at `target`, a dangling link included — never overwrite what is there. */
function entryExists(target: string): boolean {
  try {
    fs.lstatSync(target)
    return true
  } catch {
    return false
  }
}

/**
 * Take back the links `provisionDependencies` lent a checkout.
 *
 * Only links: an install the checkout made itself stays. Run before a
 * reinstall, which would otherwise write through the link into the origin's
 * own install. Never throws.
 */
export async function unlinkBorrowedDependencies(
  checkout: Checkout,
  deps: CheckoutDeps
): Promise<string[]> {
  const unlinked: string[] = []
  try {
    for (const place of (await lendingPlaces(checkout, deps)) ?? []) {
      if (unlinkIfLink(path.join(checkout.path, place))) unlinked.push(place)
    }
  } catch {
    return unlinked
  }
  return unlinked
}

function unlinkIfLink(target: string): boolean {
  try {
    if (!fs.lstatSync(target).isSymbolicLink()) return false
    fs.unlinkSync(target)
    return true
  } catch {
    // absent, or not ours to remove
    return false
  }
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

/** Take a lane's checkout away again. Best effort; never throws. @internal */
export async function removeCheckout(checkout: Checkout, deps: CheckoutDeps): Promise<boolean> {
  await unlockCheckout(checkout.origin, checkout.path, deps)
  const removed = await deps.exec({
    command: 'git',
    args: ['worktree', 'remove', '--force', checkout.path],
    cwd: checkout.origin,
    timeoutMs: 60_000,
  })
  return removed.exitCode === 0
}

/** Lanes are created locked; git refuses to remove a locked worktree without it. Best effort. */
export async function unlockCheckout(
  origin: string,
  target: string,
  deps: Pick<CheckoutDeps, 'exec'>
): Promise<void> {
  await deps.exec({
    command: 'git',
    args: ['worktree', 'unlock', target],
    cwd: origin,
    timeoutMs: 30_000,
  })
}

/**
 * A checkout of a lane's base branch as it is, without the lane's change.
 *
 * It answers whether a failing check was already failing before the change.
 * Detached, so no branch of the repository moves and the lane's own branch is
 * untouched; it sits beside the lane's checkout, under the data root, for the
 * same reason that one does.
 */
export async function ensureBaseCheckout(
  order: WorkOrder,
  lane: number,
  deps: CheckoutDeps
): Promise<Checkout> {
  return detachedBaseCheckout({ order, lane, suffix: '@base', fresh: false }, deps)
}

/** Never the line's `@base`, and always new: a crash's leftover stands at an older commit. */
export async function ensureBaselineCheckout(
  order: WorkOrder,
  lane: number,
  deps: CheckoutDeps
): Promise<Checkout> {
  return detachedBaseCheckout({ order, lane, suffix: '@baseline', fresh: true }, deps)
}

interface BaseCheckoutPlan {
  readonly order: WorkOrder
  readonly lane: number
  readonly suffix: string
  /** Remove any checkout already at the target first. */
  readonly fresh: boolean
}

async function detachedBaseCheckout(
  { order, lane, suffix, fresh }: BaseCheckoutPlan,
  deps: CheckoutDeps
): Promise<Checkout> {
  const repo = order.context.repos.find((r) => r.lane === lane)
  if (repo === undefined)
    throw new CheckoutFailedError(`lane ${lane}`, 'the order has no such lane')

  const target = `${checkoutPath(deps.root, order, repo.name)}${suffix}`
  const share = order.context.environment.share
  const leftover = {
    repo: repo.name,
    origin: repo.path,
    path: target,
    branch: repo.baseBranch,
    share,
  }
  if (fresh) await removeBaseCheckout({ ...leftover, created: false }, deps)
  const added = await addWorktree(repo, { target, how: ['--detach'] }, deps)

  const checkout = { ...leftover, created: added !== 'present' }
  await provisionDependencies(checkout, deps)
  return checkout
}

/** Take a base checkout away. Best effort; never throws. */
export async function removeBaseCheckout(checkout: Checkout, deps: CheckoutDeps): Promise<void> {
  try {
    await removeCheckout(checkout, deps)
  } catch {
    // nothing left to do if cleanup itself fails
  }
}
