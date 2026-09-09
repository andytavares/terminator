import * as fs from 'node:fs'
import * as path from 'node:path'
import { orderDir } from '../data-root.js'
import { branchFor, checkoutPath } from './worktree.js'
import type { CheckoutDeps } from './worktree.js'
import type { WorkOrder } from '../order/schema.js'

// Taking a run away again.
//
// `removeCheckout` shipped with the feature that cuts worktrees, was exported,
// was tested, and was called by nothing — so every run Foundry has ever done
// left its checkout behind, registered in the target repository's
// `.git/worktrees/`, along with its branch. Measured on one machine: four
// prunable registrations and four branches for a single ask, retried by hand
// because a cancelled order can never be started again.
//
// Two operations, because they answer different questions. `tearDownRun`
// destroys what the *run* made and keeps the order, which is what "start over"
// means: the ask, the criteria and the plan are the expensive part and there
// is no reason to retype them. `deleteOrder` takes the lot.
//
// Everything here is best effort and nothing throws. A teardown that stops at
// its first failure leaves a half-destroyed run — an order still marked
// `running` with no way out — which is strictly worse than one that finishes
// and names the parts it could not remove.

export interface TeardownResult {
  /** What is actually gone. Goes into the ledger, so it cannot be a guess. */
  readonly removed: readonly string[]
  /** What could not be removed, with git's own words. Never thrown. */
  readonly failed: readonly string[]
}

/** What went wrong, in one sentence, whatever was thrown. */
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Remove a path if it is there. Absence is the goal, not an error. */
function rmIfPresent(target: string, label: string, removed: string[], failed: string[]): void {
  try {
    if (!fs.existsSync(target)) return
    fs.rmSync(target, { recursive: true, force: true })
    removed.push(label)
  } catch (error) {
    failed.push(`${label}: ${reason(error)}`)
  }
}

/**
 * Everything one lane left in a repository: its checkout and its branch.
 *
 * The worktree is removed from the repository that owns it — git records the
 * registration under the origin's `.git/worktrees/`, so removing the directory
 * from under the data root would leave that behind and the next
 * `worktree add` onto the same path would fail. `prune` afterwards is what
 * makes starting over work a second time.
 */
async function tearDownLane(
  order: WorkOrder,
  lane: number,
  deps: CheckoutDeps,
  removed: string[],
  failed: string[]
): Promise<void> {
  const repo = order.context.repos.find((r) => r.lane === lane)
  if (repo === undefined) return

  const branch = branchFor(order, lane)
  const target = checkoutPath(deps.root, order, repo.name)

  const gone = await deps.exec({
    command: 'git',
    args: ['worktree', 'remove', '--force', target],
    cwd: repo.path,
    timeoutMs: 60_000,
  })
  if (gone.exitCode === 0) removed.push(`the checkout at ${target}`)
  else failed.push(`the checkout at ${target}: ${gone.stderr.trim()}`)

  // Unconditional: the point of pruning is the registration left by a
  // directory that is already gone, which is exactly the case where the
  // removal above just failed.
  await deps.exec({
    command: 'git',
    args: ['worktree', 'prune'],
    cwd: repo.path,
    timeoutMs: 30_000,
  })

  // `-D`, not `-d`: the branch holds work that was deliberately thrown away,
  // and git refusing to delete it because it is unmerged is the normal case
  // rather than a warning worth stopping for. The operator confirmed this.
  const branchGone = await deps.exec({
    command: 'git',
    args: ['branch', '-D', branch],
    cwd: repo.path,
    timeoutMs: 30_000,
  })
  if (branchGone.exitCode === 0) removed.push(`the branch ${branch}`)
  else failed.push(`the branch ${branch}: ${branchGone.stderr.trim()}`)
}

/**
 * Destroy the run and keep the order.
 *
 * What goes: every lane's checkout and branch, the run graph, the gates the
 * run raised, and the rung outputs. What stays: `order.json`, `order.md` and
 * the ledger — the record of what was asked for and everything that has
 * happened to it, which a restart has no reason to lose.
 */
export async function tearDownRun(order: WorkOrder, deps: CheckoutDeps): Promise<TeardownResult> {
  const removed: string[] = []
  const failed: string[] = []

  let dir: string
  try {
    dir = orderDir(deps.root, order.id)
  } catch (error) {
    return { removed, failed: [reason(error)] }
  }

  for (const lane of [...order.plan.lanes].sort((a, b) => a.ord - b.ord)) {
    await tearDownLane(order, lane.ord, deps, removed, failed)
  }

  rmIfPresent(path.join(dir, 'run-graph.json'), 'the run graph', removed, failed)
  rmIfPresent(path.join(dir, 'gates.json'), 'the gates it raised', removed, failed)
  rmIfPresent(path.join(dir, 'rungs'), 'what its rungs handed back', removed, failed)
  rmIfPresent(path.join(dir, 'lanes'), 'its lane records', removed, failed)
  // Last, and after git has been told: an empty `worktrees` directory is
  // normal, and a non-empty one means a removal above failed.
  rmIfPresent(path.join(dir, 'worktrees'), 'its worktrees directory', removed, failed)

  return { removed, failed }
}

/**
 * Destroy the run and the order with it.
 *
 * The ledger goes too. That is a real loss — it is the durable record of what
 * was decided and by whom — and it is what "delete" was asked to mean: an
 * order kept as a hidden `cancelled` row is the state that had people making a
 * fourth branch by hand. `Discard` still exists for the case where the record
 * is worth keeping.
 */
export async function deleteOrder(order: WorkOrder, deps: CheckoutDeps): Promise<TeardownResult> {
  const run = await tearDownRun(order, deps)
  const removed = [...run.removed]
  const failed = [...run.failed]

  let dir: string
  try {
    // Throws for an id that would resolve anywhere but directly under the
    // orders directory. This is the call where that guard is load-bearing:
    // everything else it protects writes a file, and this one removes a tree.
    dir = orderDir(deps.root, order.id)
  } catch (error) {
    return { removed, failed: [...failed, reason(error)] }
  }

  rmIfPresent(dir, `the order ${order.id} and its whole record`, removed, failed)
  return { removed, failed }
}
