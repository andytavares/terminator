import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir } from '../../support/temp-dir'
import {
  createBranch,
  createWorktree,
  fetchRemotes,
  getChangeStats,
  getCurrentBranch,
  listBranches,
  listWorktrees,
} from '../../../src/main/git/git-service'

// The sidebar's branch cards, against real git: the unit specs fake git's output, so only a real
// repository shows that git accepts the arguments and the parsers read what it prints.

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** A repository on main with one commit. */
function repository(): string {
  const repo = makeTempDir('branches-repo-')
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.test')
  git(repo, 'config', 'user.name', 'Test')
  writeFileSync(join(repo, 'README.md'), '# Test\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'root')
  return repo
}

/** A clone of a `repository()`, which is its origin. */
function clonedRepository(): { repo: string; origin: string } {
  const origin = repository()
  const repo = join(makeTempDir('branches-clone-'), 'clone')
  git(origin, 'clone', '-q', origin, repo)
  return { repo, origin }
}

const branchNames = async (repo: string): Promise<string[]> =>
  (await listBranches(repo)).map((branch) => branch.name)

describe('git-service against a real repository — the branch a card is named by', () => {
  it('names the branch the working tree is on, and follows a checkout made outside the app', async () => {
    const repo = repository()
    await expect(getCurrentBranch(repo)).resolves.toBe('main')
    git(repo, 'checkout', '-q', '-b', 'feature/renamed-by-git')
    await expect(getCurrentBranch(repo)).resolves.toBe('feature/renamed-by-git')
  })

  it('counts a staged change', async () => {
    const repo = repository()
    writeFileSync(join(repo, 'README.md'), '# Changed\n'.repeat(3))
    git(repo, 'add', 'README.md')
    await expect(getChangeStats(repo)).resolves.toMatchObject({ added: 3, removed: 1 })
  })
})

describe('git-service against a real repository — listing and making branches', () => {
  it('lists a branch made on the remote only after a fetch', async () => {
    const { repo, origin } = clonedRepository()
    git(origin, 'branch', 'pushed-elsewhere')
    expect(await branchNames(repo)).not.toContain('pushed-elsewhere')
    await fetchRemotes(repo)
    expect(await branchNames(repo)).toContain('pushed-elsewhere')
  })

  it('creates a new branch in the repository and checks it out', async () => {
    const repo = repository()
    await createBranch(repo, 'made-in-app')
    expect(git(repo, 'branch', '--list', 'made-in-app')).toContain('made-in-app')
    await expect(getCurrentBranch(repo)).resolves.toBe('made-in-app')
  })

  it('creates a worktree on a new branch', async () => {
    const repo = repository()
    const worktreePath = join(repo, '.worktrees', 'feature-busy-state')
    await createWorktree({
      repoRoot: repo,
      worktreePath,
      branch: 'feature/busy-state',
      isNewBranch: true,
    })
    expect(await listWorktrees(repo)).toContainEqual(
      expect.objectContaining({ path: worktreePath, branch: 'feature/busy-state' })
    )
    await expect(getCurrentBranch(worktreePath)).resolves.toBe('feature/busy-state')
  })
})
