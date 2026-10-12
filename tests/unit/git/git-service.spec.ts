import { describe, it, expect, vi, beforeEach } from 'vitest'

// git-service.ts does: const execFile = promisify(execFileCb)
// Node's real execFile has a [util.promisify.custom] symbol that makes promisify
// resolve with {stdout, stderr}. Our mock must replicate that by attaching a
// vi.fn() to the well-known symbol so util.promisify delegates to it.

const PROMISIFY_CUSTOM = Symbol.for('nodejs.util.promisify.custom')

const { execFileMock } = vi.hoisted(() => {
  const CUSTOM = Symbol.for('nodejs.util.promisify.custom')
  const execFileMock = vi.fn()
  ;(execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[CUSTOM] = vi.fn()
  return { execFileMock }
})

vi.mock('child_process', () => ({ execFile: execFileMock }))

// Convenience helpers — update the promisify.custom mock (the path actually invoked)
function mockResolve(stdout: string) {
  ;(execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[
    PROMISIFY_CUSTOM
  ].mockResolvedValue({ stdout, stderr: '' })
}

function mockReject(message: string) {
  ;(execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[
    PROMISIFY_CUSTOM
  ].mockRejectedValue(new Error(message))
}

import {
  isGitRepo,
  getGitRoot,
  getCurrentBranch,
  listBranches,
  fetchRemotes,
  checkoutBranch,
  suggestWorktreePath,
  listWorktrees,
  createWorktree,
  removeWorktree,
  getChangeStats,
} from '../../../src/main/git/git-service'

const customMock = () =>
  (execFileMock as unknown as Record<symbol, ReturnType<typeof vi.fn>>)[PROMISIFY_CUSTOM]

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── isGitRepo ────────────────────────────────────────────────────────────────

describe('isGitRepo', () => {
  it('returns true when rev-parse succeeds', async () => {
    mockResolve('.git')
    expect(await isGitRepo('/repo')).toBe(true)
  })

  it('returns false when rev-parse fails', async () => {
    mockReject('not a git repository')
    expect(await isGitRepo('/not-a-repo')).toBe(false)
  })
})

// ─── getGitRoot ───────────────────────────────────────────────────────────────

describe('getGitRoot', () => {
  it('returns trimmed repo root path', async () => {
    mockResolve('/home/user/project\n')
    expect(await getGitRoot('/home/user/project/src')).toBe('/home/user/project')
  })
})

// ─── getCurrentBranch ─────────────────────────────────────────────────────────

describe('getCurrentBranch', () => {
  it('returns branch name', async () => {
    mockResolve('feature/my-branch\n')
    expect(await getCurrentBranch('/repo')).toBe('feature/my-branch')
  })

  it('returns HEAD when branch output is empty', async () => {
    mockResolve('\n')
    expect(await getCurrentBranch('/repo')).toBe('HEAD')
  })
})

// ─── listBranches ─────────────────────────────────────────────────────────────

describe('listBranches', () => {
  // The shape `git branch -a --format=%(HEAD)|%(refname)` prints: full refs,
  // remote-tracking ones under refs/remotes/<remote>/. `git remote` answers
  // second.
  function mockRefs(refs: string, remotes = 'origin\nupstream\n') {
    customMock().mockImplementation((_cmd: string, args: string[]) =>
      Promise.resolve({ stdout: args[0] === 'remote' ? remotes : refs, stderr: '' })
    )
  }

  it('lists local branches', async () => {
    mockRefs(' |refs/heads/main\n |refs/heads/feature/x\n')
    const branches = await listBranches('/repo')
    expect(branches.map((b) => b.name)).toEqual(['main', 'feature/x'])
  })

  it('marks current branch with isCurrent', async () => {
    mockRefs('*|refs/heads/main\n |refs/heads/other\n')
    const branches = await listBranches('/repo')
    expect(branches.find((b) => b.name === 'main')?.isCurrent).toBe(true)
    expect(branches.find((b) => b.name === 'other')?.isCurrent).toBe(false)
  })

  it('never lists a remote-tracking ref under its remote prefix', async () => {
    mockRefs(
      ' |refs/heads/main\n |refs/remotes/origin/HEAD\n |refs/remotes/origin/main\n |refs/remotes/upstream/feature/y\n'
    )
    const names = (await listBranches('/repo')).map((b) => b.name)
    expect(names.some((n) => n.startsWith('origin') || n.startsWith('upstream'))).toBe(false)
  })

  it('lists a branch that exists only on a remote by its bare name', async () => {
    mockRefs(' |refs/heads/main\n |refs/remotes/origin/main\n |refs/remotes/origin/remote-only\n')
    const branches = await listBranches('/repo')
    expect(branches.filter((b) => b.name === 'main')).toEqual([
      { name: 'main', isCurrent: false, isRemote: false },
    ])
    expect(branches.find((b) => b.name === 'remote-only')).toEqual({
      name: 'remote-only',
      isCurrent: false,
      isRemote: true,
    })
  })

  it('lists a branch on two remotes once', async () => {
    mockRefs(' |refs/remotes/origin/shared\n |refs/remotes/upstream/shared\n')
    expect((await listBranches('/repo')).map((b) => b.name)).toEqual(['shared'])
  })

  it('omits the remote HEAD pointer', async () => {
    mockRefs(' |refs/remotes/origin/HEAD\n |refs/heads/main\n')
    const branches = await listBranches('/repo')
    expect(branches.map((b) => b.name)).toEqual(['main'])
  })

  it('filters out pull request refs', async () => {
    mockRefs(
      ' |refs/heads/main\n |refs/remotes/origin/pull/123/head\n |refs/remotes/origin/pull/456/head\n'
    )
    const branches = await listBranches('/repo')
    expect(branches.map((b) => b.name)).toEqual(['main'])
  })

  it('skips remote-tracking refs no configured remote owns', async () => {
    mockRefs(
      ' |refs/heads/main\n |refs/remotes/pull/140/head\n |refs/remotes/gone/topic\n',
      'origin\n'
    )
    expect((await listBranches('/repo')).map((b) => b.name)).toEqual(['main'])
  })

  it('returns empty array for empty output', async () => {
    mockRefs('')
    expect(await listBranches('/repo')).toHaveLength(0)
  })
})

// ─── fetchRemotes ─────────────────────────────────────────────────────────────

describe('fetchRemotes', () => {
  it('fetches every remote and prunes branches deleted upstream', async () => {
    mockResolve('')
    await fetchRemotes('/repo')
    const [, args, opts] = customMock().mock.calls[0]
    expect(args).toEqual(['fetch', '--all', '--prune'])
    expect(opts.cwd).toBe('/repo')
  })

  it('rejects when the fetch fails', async () => {
    mockReject('Could not resolve host')
    await expect(fetchRemotes('/repo')).rejects.toThrow('Could not resolve host')
  })
})

// ─── checkoutBranch ───────────────────────────────────────────────────────────

describe('checkoutBranch', () => {
  it('calls git checkout with the branch name', async () => {
    mockResolve('')
    await checkoutBranch('/repo', 'feature/new')
    const args: string[] = customMock().mock.calls[0][1]
    expect(args).toContain('checkout')
    expect(args).toContain('feature/new')
  })
})

// ─── suggestWorktreePath ──────────────────────────────────────────────────────

describe('suggestWorktreePath', () => {
  it('defaults to repoRoot/.worktrees/<safeBranch>', () => {
    expect(suggestWorktreePath('/repo', 'feature/my-branch')).toBe(
      '/repo/.worktrees/feature-my-branch'
    )
  })

  it('uses baseDir when provided', () => {
    expect(suggestWorktreePath('/repo', 'feature/x', '/worktrees')).toBe('/worktrees/feature-x')
  })

  it('replaces slashes, backslashes, colons, and spaces in branch name', () => {
    expect(suggestWorktreePath('/repo', 'feat/my branch:v2')).toContain('feat-my-branch-v2')
  })
})

// ─── listWorktrees ────────────────────────────────────────────────────────────

describe('listWorktrees', () => {
  it('parses porcelain worktree list', async () => {
    const output = [
      'worktree /repo',
      'HEAD abc1234',
      'branch refs/heads/main',
      '',
      'worktree /worktrees/feature-x',
      'HEAD def5678',
      'branch refs/heads/feature/x',
      '',
    ].join('\n')
    mockResolve(output)
    const worktrees = await listWorktrees('/repo')
    expect(worktrees).toHaveLength(2)
    expect(worktrees[0]).toMatchObject({ path: '/repo', branch: 'main', isMain: true })
    expect(worktrees[1]).toMatchObject({
      path: '/worktrees/feature-x',
      branch: 'feature/x',
      isMain: false,
    })
  })

  it('uses HEAD as branch fallback when branch line is absent', async () => {
    mockResolve('worktree /detached\nHEAD abc1234\n\n')
    const worktrees = await listWorktrees('/detached')
    expect(worktrees[0].branch).toBe('HEAD')
  })
})

// ─── createWorktree ───────────────────────────────────────────────────────────

describe('createWorktree', () => {
  it('uses -b flag when creating a new branch', async () => {
    mockResolve('')
    await createWorktree('/repo', '/worktrees/new-feature', 'new-feature', true)
    const args: string[] = customMock().mock.calls[0][1]
    expect(args).toContain('-b')
    expect(args).toContain('new-feature')
  })

  it('does not use -b flag for existing branch', async () => {
    mockResolve('')
    await createWorktree('/repo', '/worktrees/main', 'main', false)
    const args: string[] = customMock().mock.calls[0][1]
    expect(args).not.toContain('-b')
    expect(args).toContain('main')
  })
})

// ─── removeWorktree ───────────────────────────────────────────────────────────

describe('removeWorktree', () => {
  it('calls git worktree remove --force', async () => {
    mockResolve('')
    await removeWorktree('/repo', '/worktrees/old-feature')
    const args: string[] = customMock().mock.calls[0][1]
    expect(args).toContain('remove')
    expect(args).toContain('--force')
    expect(args).toContain('/worktrees/old-feature')
  })
})

// ─── getChangeStats ──────────────────────────────────────────────────────────

describe('getChangeStats', () => {
  it('sums the numstat columns across files', async () => {
    mockResolve(['12\t3\tsrc/a.ts', '4\t0\tsrc/b.ts', '0\t9\tsrc/c.ts'].join('\n'))
    expect(await getChangeStats('/repo')).toEqual({ added: 16, removed: 12, files: 3 })
  })

  it('runs diff against HEAD so staged and unstaged work both count', async () => {
    mockResolve('1\t1\ta.ts')
    await getChangeStats('/repo')
    const [cmd, args, opts] = customMock().mock.calls[0]
    expect(cmd).toBe('git')
    expect(args).toEqual(['diff', '--numstat', 'HEAD'])
    expect(opts).toMatchObject({ cwd: '/repo' })
  })

  it('counts a binary file but adds nothing for it — git reports dashes, not numbers', async () => {
    mockResolve(['5\t2\tsrc/a.ts', '-\t-\tassets/logo.png'].join('\n'))
    expect(await getChangeStats('/repo')).toEqual({ added: 5, removed: 2, files: 2 })
  })

  it('reports zeroes for a clean tree', async () => {
    mockResolve('')
    expect(await getChangeStats('/repo')).toEqual({ added: 0, removed: 0, files: 0 })
  })

  it('reports zeroes for a repository with no commits rather than throwing', async () => {
    mockReject("fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree")
    expect(await getChangeStats('/repo')).toEqual({ added: 0, removed: 0, files: 0 })
  })

  it('rejects when the directory is not a git repository', async () => {
    mockReject('fatal: not a git repository (or any of the parent directories): .git')
    await expect(getChangeStats('/tmp')).rejects.toThrow(/not a git repository/)
  })

  it('rejects when git times out', async () => {
    mockReject('spawn ETIMEDOUT')
    await expect(getChangeStats('/repo')).rejects.toThrow(/ETIMEDOUT/)
  })

  it('ignores malformed rows rather than producing NaN', async () => {
    mockResolve(['3\t1\tok.ts', 'garbage', ''].join('\n'))
    expect(await getChangeStats('/repo')).toEqual({ added: 3, removed: 1, files: 1 })
  })
})
