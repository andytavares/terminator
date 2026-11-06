// "Keep the default branch up to date": fast-forward each local repository's default branch
// on every Home refresh. Never merges, rebases or touches a dirty checkout.

type Exec = (cwd: string, args: string[]) => Promise<string>

export type AutoPullOutcome = 'merged' | 'fetched' | 'skipped'

/** The path of the worktree that has `branch` checked out, from `worktree list --porcelain`. */
function checkoutOf(porcelain: string, branch: string): string | null {
  for (const block of porcelain.split('\n\n')) {
    const path = block.match(/^worktree (.+)$/m)?.[1]
    if (path && new RegExp(`^branch refs/heads/${branch}$`, 'm').test(block)) return path
  }
  return null
}

/** Fast-forwards `branch` in the checkout that has it, when that is clean with no local commits. */
async function mergeInCheckout(
  exec: Exec,
  checkout: string,
  branch: string
): Promise<AutoPullOutcome> {
  const dirty = await exec(checkout, ['status', '--porcelain'])
  await exec(checkout, ['fetch', 'origin', branch])
  const ahead = await exec(checkout, ['rev-list', '--count', `origin/${branch}..${branch}`])
  if (dirty !== '' || ahead !== '0') return 'skipped'
  await exec(checkout, ['merge', '--ff-only', `origin/${branch}`])
  return 'merged'
}

/** Brings the default branch of `repoRoot` up to date with origin, or skips when it cannot do so safely. */
export async function autoPullDefault(exec: Exec, repoRoot: string): Promise<AutoPullOutcome> {
  const head = await exec(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  const branch = head.replace(/^origin\//, '')
  const checkout = checkoutOf(await exec(repoRoot, ['worktree', 'list', '--porcelain']), branch)
  if (checkout !== null) return mergeInCheckout(exec, checkout, branch)
  await exec(repoRoot, ['fetch', 'origin', `${branch}:${branch}`])
  return 'fetched'
}
