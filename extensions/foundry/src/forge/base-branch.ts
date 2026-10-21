import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

async function git(repoPath: string, args: string[]): Promise<string> {
  try {
    return (await run('git', args, { cwd: repoPath, timeout: 30_000 })).stdout.trim()
  } catch {
    return ''
  }
}

/**
 * The branch an order's work is cut from in this repository.
 *
 * What the repository is on: a `master` repository, or a branch stacked on
 * another branch, is as ordinary as `main`. When HEAD is detached the remote's
 * default stands in, and `main` only when git can say nothing at all.
 */
export async function baseBranchOfRepo(repoPath: string): Promise<string> {
  const current = await git(repoPath, ['symbolic-ref', '--short', '-q', 'HEAD'])
  if (current !== '') return current
  const remoteHead = await git(repoPath, [
    'symbolic-ref',
    '--short',
    '-q',
    'refs/remotes/origin/HEAD',
  ])
  return remoteHead.replace(/^origin\//, '') || 'main'
}
