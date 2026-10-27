import { NETWORK_STEP_TIMEOUT_MS, timeoutNotice } from './integrate.js'
import type { ShellExec } from './integrate.js'

// Rebasing a lane back onto its base after a predecessor merged (or the base
// otherwise moved), so the lane's own merge never fights the one that already
// landed. GitHub does the rebase (`gh pr update-branch --rebase`); no
// auto-resolution, no retries — a conflict is handed back as GitHub reported it.

export type RestackResult =
  | { readonly kind: 'rebased'; readonly pushed: boolean; readonly checkoutBehind?: true }
  | {
      readonly kind: 'conflict'
      /** Empty: `gh` does not say which files conflict. */
      readonly files: readonly string[]
      readonly reason?: string
    }
  | { readonly kind: 'failed'; readonly reason: string }

type Lane = { cwd: string; branch: string; base: string }

export async function restack(lane: Lane, exec: ShellExec): Promise<RestackResult> {
  const update = await exec({
    command: 'gh',
    args: ['pr', 'update-branch', lane.branch, '--rebase'],
    cwd: lane.cwd,
    timeoutMs: NETWORK_STEP_TIMEOUT_MS,
  })
  if (update.timedOut) {
    return {
      kind: 'failed',
      reason: timeoutNotice('gh pr update-branch', NETWORK_STEP_TIMEOUT_MS),
    }
  }
  if (update.exitCode !== 0) {
    const reason = `GitHub could not rebase the branch: ${update.stderr.trim()}`
    // Only a conflict is the operator's to resolve; auth or network trouble is retried next tick.
    return /conflict/i.test(update.stderr)
      ? { kind: 'conflict', files: [], reason }
      : { kind: 'failed', reason }
  }
  return (await pullCleanCheckout(lane, exec))
    ? { kind: 'rebased', pushed: true }
    : { kind: 'rebased', pushed: true, checkoutBehind: true }
}

// Brings a clean checkout onto the rebased branch; false when left behind. `--rebase`, not
// `--ff-only`: GitHub rewrote the lane's commits, so the local copies are never an ancestor.
async function pullCleanCheckout(lane: Lane, exec: ShellExec): Promise<boolean> {
  const status = await exec({ command: 'git', args: ['status', '--porcelain'], cwd: lane.cwd })
  if (status.exitCode !== 0 || status.stdout.trim() !== '') return false
  const pull = await exec({
    command: 'git',
    args: ['pull', '--rebase', 'origin', lane.branch],
    cwd: lane.cwd,
    timeoutMs: NETWORK_STEP_TIMEOUT_MS,
  })
  if (pull.exitCode === 0 && !pull.timedOut) return true
  // A pull that stopped part-way leaves a rebase in progress; the checkout stays as it was.
  await exec({ command: 'git', args: ['rebase', '--abort'], cwd: lane.cwd })
  return false
}
