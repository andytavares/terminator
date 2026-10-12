import { timeoutNotice } from './integrate.js'
import type { ExecResult, ShellExec } from './integrate.js'

// The commit runs the repository's own hooks, which may lint and test.
const COMMIT_TIMEOUT_MS = 300_000
const LOCAL_STEP_TIMEOUT_MS = 30_000

/**
 * What committing a checkout came to.
 *
 * A refusal is told apart from a clean tree: a pre-commit hook rejecting the
 * work was reported as "made no change", and the operator had no way to see
 * that the builder had written everything and a test it added was failing.
 */
export type CommitOutcome =
  | { readonly kind: 'committed' }
  | { readonly kind: 'clean' }
  | {
      readonly kind: 'refused'
      readonly command: string
      readonly exitCode: number | null
      /** What git, and any hook it ran, printed. */
      readonly output: string
    }

function refused(command: string, result: ExecResult, timeoutMs: number): CommitOutcome {
  return {
    kind: 'refused',
    command,
    exitCode: result.exitCode,
    output: result.timedOut
      ? timeoutNotice(command, timeoutMs)
      : [result.stdout, result.stderr]
          .map((text) => text.trim())
          .filter(Boolean)
          .join('\n'),
  }
}

/**
 * Commit whatever is uncommitted in a checkout.
 *
 * Anything but `committed` means nothing was committed, because a caller that
 * pushes afterwards must not claim it published what was never committed.
 */
export async function commitWorktree(
  cwd: string,
  message: string,
  exec: ShellExec
): Promise<CommitOutcome> {
  const status = await exec({
    command: 'git',
    args: ['status', '--porcelain'],
    cwd,
    timeoutMs: LOCAL_STEP_TIMEOUT_MS,
  })
  if (status.exitCode !== 0 || status.timedOut) {
    return refused('git status', status, LOCAL_STEP_TIMEOUT_MS)
  }
  if (status.stdout.trim() === '') return { kind: 'clean' }

  const added = await exec({
    command: 'git',
    args: ['add', '-A'],
    cwd,
    timeoutMs: LOCAL_STEP_TIMEOUT_MS,
  })
  if (added.exitCode !== 0 || added.timedOut) {
    return refused('git add', added, LOCAL_STEP_TIMEOUT_MS)
  }

  const committed = await exec({
    command: 'git',
    args: ['commit', '-m', message],
    cwd,
    timeoutMs: COMMIT_TIMEOUT_MS,
  })
  if (committed.exitCode !== 0 || committed.timedOut) {
    return refused('git commit', committed, COMMIT_TIMEOUT_MS)
  }
  return { kind: 'committed' }
}

/**
 * Whether the checkout's head was committed at or after `startedAt`.
 *
 * An agent may commit its own work and leave a clean tree behind. Git keeps
 * whole seconds, so a commit in the step's first second still counts.
 */
export async function committedSince(
  cwd: string,
  startedAt: string,
  exec: ShellExec
): Promise<boolean> {
  const head = await exec({ command: 'git', args: ['log', '-1', '--format=%ct'], cwd })
  if (head.exitCode !== 0) return false
  return Number(head.stdout.trim()) >= Math.floor(Date.parse(startedAt) / 1000)
}
