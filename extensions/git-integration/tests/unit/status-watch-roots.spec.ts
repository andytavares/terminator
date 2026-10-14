import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { statusWatchRoots } from '../../src/git/git-service'
import { bindRealShell } from './support/shell'
import { GIT_FREE_ENV, runGitIn } from './support/git-repo'
import { makeTempDir } from '../../../../tests/support/temp-dir'

function repositoryWithOneCommit(): string {
  const repo = join(makeTempDir('watch-roots-'), 'repo')
  mkdirSync(join(repo, 'packages', 'ui'), { recursive: true })
  runGitIn(repo, ['init', '-q', '-b', 'main'])
  runGitIn(repo, ['config', 'user.email', 'test@example.test'])
  runGitIn(repo, ['config', 'user.name', 'Test'])
  writeFileSync(join(repo, 'packages', 'ui', 'a.ts'), 'a\n')
  runGitIn(repo, ['add', '.'])
  runGitIn(repo, ['commit', '-q', '-m', 'first'])
  return repo
}

describe('statusWatchRoots', () => {
  beforeEach(() => bindRealShell(GIT_FREE_ENV))

  it('is the working tree alone when the git directory is inside it', async () => {
    const repo = repositoryWithOneCommit()
    expect(await statusWatchRoots(repo)).toEqual([repo])
  })

  it('adds the repository’s git directory for a linked worktree, whose index is kept there', async () => {
    const repo = repositoryWithOneCommit()
    const worktree = join(makeTempDir('watch-roots-linked-'), 'feature')
    runGitIn(repo, ['worktree', 'add', '-q', '-b', 'feature', worktree])
    expect(await statusWatchRoots(worktree)).toEqual([worktree, join(repo, '.git')])
  })

  it('adds the git directory for a folder inside a working tree', async () => {
    const repo = repositoryWithOneCommit()
    const folder = join(repo, 'packages', 'ui')
    expect(await statusWatchRoots(folder)).toEqual([folder, join(repo, '.git')])
  })

  it('rejects for a folder that is not in a repository', async () => {
    await expect(statusWatchRoots(makeTempDir('watch-roots-plain-'))).rejects.toThrow()
  })
})
