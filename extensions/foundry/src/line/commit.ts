import type { ShellExec } from './integrate.js'

/**
 * Commit whatever is uncommitted in a checkout.
 *
 * Returns whether a commit was made: false when the tree was clean, and also
 * when git could not stage or commit, because a caller that pushes afterwards
 * must not claim it published what was never committed.
 */
export async function commitWorktree(
  cwd: string,
  message: string,
  exec: ShellExec
): Promise<boolean> {
  const status = await exec({ command: 'git', args: ['status', '--porcelain'], cwd })
  if (status.exitCode !== 0 || status.stdout.trim() === '') return false

  const added = await exec({ command: 'git', args: ['add', '-A'], cwd })
  if (added.exitCode !== 0) return false

  const committed = await exec({ command: 'git', args: ['commit', '-m', message], cwd })
  return committed.exitCode === 0
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
