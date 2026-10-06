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
