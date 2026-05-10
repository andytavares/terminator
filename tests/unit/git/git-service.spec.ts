import { describe, it, expect, vi, beforeEach } from 'vitest'

// git-service.ts does: const execFile = promisify(execFileCb)
// Node's real execFile has a [util.promisify.custom] symbol that makes promisify
// resolve with {stdout, stderr}. Our mock must replicate that by attaching a
// vi.fn() to the well-known symbol so util.promisify delegates to it.

const PROMISIFY_CUSTOM = Symbol.for('nodejs.util.promisify.custom')

const { execFileMock } = vi.hoisted(() => {
  const CUSTOM = Symbol.for('nodejs.util.promisify.custom')
  const execFileMock = vi.fn()
  ;(execFileMock as any)[CUSTOM] = vi.fn()
  return { execFileMock }
})

vi.mock('child_process', () => ({ execFile: execFileMock }))

// Convenience helpers — update the promisify.custom mock (the path actually invoked)
function mockResolve(stdout: string) {
  ;(execFileMock as any)[PROMISIFY_CUSTOM].mockResolvedValue({ stdout, stderr: '' })
}

function mockReject(message: string) {
  ;(execFileMock as any)[PROMISIFY_CUSTOM].mockRejectedValue(new Error(message))
}

import {
  getStatus,
  getDiff,
  stageFiles,
  unstageFiles,
  commitChanges,
  isGitRepo,
  getGitRoot,
  getCurrentBranch,
  listBranches,
  checkoutBranch,
  suggestWorktreePath,
  listWorktrees,
  createWorktree,
  removeWorktree,
} from '../../../src/main/git/git-service'

const customMock = () => (execFileMock as any)[PROMISIFY_CUSTOM]

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── getStatus ───────────────────────────────────────────────────────────────

describe('getStatus', () => {
  it('returns parsed status with branch name', async () => {
    customMock().mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('status'))
        return Promise.resolve({ stdout: '?? new-file.ts\0', stderr: '' })
      return Promise.resolve({ stdout: 'main\n', stderr: '' })
    })

    const result = await getStatus('/repo')
    expect(result.branch).toBe('main')
    expect(result.files).toHaveLength(1)
    expect(result.files[0].status).toBe('untracked')
  })

  it('falls back to HEAD when branch command fails', async () => {
    customMock().mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('status')) return Promise.resolve({ stdout: '', stderr: '' })
      return Promise.reject(new Error('not a repo'))
    })

    const result = await getStatus('/repo')
    expect(result.branch).toBe('HEAD')
  })

  it('passes maxFiles to parser', async () => {
    const files = Array.from({ length: 10 }, (_, i) => `?? file${i}.ts`).join('\0')
    customMock().mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('status')) return Promise.resolve({ stdout: files + '\0', stderr: '' })
      return Promise.resolve({ stdout: 'main', stderr: '' })
    })

    const result = await getStatus('/repo', 3)
    expect(result.files).toHaveLength(3)
    expect(result.truncated).toBe(true)
  })
})

// ─── getDiff ─────────────────────────────────────────────────────────────────

describe('getDiff', () => {
  it('calls git diff without --cached for unstaged', async () => {
    mockResolve('@@ -1,1 +1,1 @@\n-old\n+new\n')
    const result = await getDiff('/repo', 'src/app.ts', false)
    const args: string[] = customMock().mock.calls[0][1]
    expect(args).not.toContain('--cached')
    expect(result.path).toBe('src/app.ts')
  })

  it('calls git diff --cached for staged changes', async () => {
    mockResolve('@@ -1,1 +1,1 @@\n-old\n+new\n')
    await getDiff('/repo', 'src/app.ts', true)
    const args: string[] = customMock().mock.calls[0][1]
    expect(args).toContain('--cached')
  })

  it('attaches path to parsed diff result', async () => {
    mockResolve('')
    const result = await getDiff('/repo', 'src/util.ts', false)
    expect(result.path).toBe('src/util.ts')
  })
})

// ─── stageFiles / unstageFiles ────────────────────────────────────────────────

describe('stageFiles', () => {
  it('calls git add with the given paths', async () => {
    mockResolve('')
    await stageFiles('/repo', ['src/a.ts', 'src/b.ts'])
    const args: string[] = customMock().mock.calls[0][1]
    expect(args).toContain('add')
    expect(args).toContain('src/a.ts')
    expect(args).toContain('src/b.ts')
  })
})

describe('unstageFiles', () => {
  it('calls git restore --staged with the given paths', async () => {
    mockResolve('')
    await unstageFiles('/repo', ['src/a.ts'])
    const args: string[] = customMock().mock.calls[0][1]
    expect(args).toContain('restore')
    expect(args).toContain('--staged')
    expect(args).toContain('src/a.ts')
  })
})

// ─── commitChanges ────────────────────────────────────────────────────────────

describe('commitChanges', () => {
  it('returns short hash from commit output', async () => {
    mockResolve('[main abc1234] feat: add something\n 1 file changed')
    const hash = await commitChanges('/repo', 'feat: add something')
    expect(hash).toBe('abc1234')
  })

  it('returns empty string when hash cannot be parsed', async () => {
    mockResolve('nothing useful here')
    const hash = await commitChanges('/repo', 'feat: add something')
    expect(hash).toBe('')
  })

  it('appends --signoff when signOff is true', async () => {
    mockResolve('[main abc1234] signed commit')
    await commitChanges('/repo', 'signed commit', true)
    const args: string[] = customMock().mock.calls[0][1]
    expect(args).toContain('--signoff')
  })

  it('does not append --signoff by default', async () => {
    mockResolve('[main abc1234] unsigned commit')
    await commitChanges('/repo', 'unsigned commit')
    const args: string[] = customMock().mock.calls[0][1]
    expect(args).not.toContain('--signoff')
  })
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
  it('lists local branches', async () => {
    mockResolve(' |main\n |feature/x\n')
    const branches = await listBranches('/repo')
    expect(branches.some((b) => b.name === 'main')).toBe(true)
    expect(branches.some((b) => b.name === 'feature/x')).toBe(true)
  })

  it('marks current branch with isCurrent', async () => {
    mockResolve('*|main\n |other\n')
    const branches = await listBranches('/repo')
    expect(branches.find((b) => b.name === 'main')?.isCurrent).toBe(true)
    expect(branches.find((b) => b.name === 'other')?.isCurrent).toBe(false)
  })

  it('deduplicates remote branches that have a local equivalent', async () => {
    mockResolve(' |main\n |remotes/origin/main\n |remotes/origin/remote-only\n')
    const branches = await listBranches('/repo')
    const mainBranches = branches.filter((b) => b.name === 'main')
    expect(mainBranches).toHaveLength(1)
    expect(mainBranches[0].isRemote).toBe(false)
    expect(branches.some((b) => b.name === 'remote-only')).toBe(true)
  })

  it('omits HEAD from remote branch list', async () => {
    mockResolve(' |remotes/origin/HEAD\n |main\n')
    const branches = await listBranches('/repo')
    expect(branches.some((b) => b.name === 'HEAD')).toBe(false)
  })

  it('returns empty array for empty output', async () => {
    mockResolve('')
    expect(await listBranches('/repo')).toHaveLength(0)
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
