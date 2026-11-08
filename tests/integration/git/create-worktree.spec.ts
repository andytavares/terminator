import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createWorktree, getCurrentBranch } from '../../../src/main/git/git-service'
import { makeTempDir } from '../../support/temp-dir'

// Each lane of a task is a branch of its own in a worktree beside the repository, made by real git.

/** A repository with one commit, so a new branch has something to start from. */
function repositoryWithACommit(): string {
  const repo = makeTempDir('create-worktree-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'Start')
  return repo
}

describe('createWorktree', () => {
  it('checks out a new branch in its own folder and leaves the repository on its branch', async () => {
    const repo = repositoryWithACommit()
    const worktreePath = join(repo, '.worktrees', 'rate-limits')

    await createWorktree({ repoRoot: repo, worktreePath, branch: 'rate-limits', isNewBranch: true })

    expect(await getCurrentBranch(worktreePath)).toBe('rate-limits')
    expect(await getCurrentBranch(repo)).toBe('main')
  })
})
