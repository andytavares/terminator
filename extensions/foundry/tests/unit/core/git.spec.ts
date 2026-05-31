import { describe, it, expect, vi } from 'vitest'
import {
  getStatus,
  createCheckpoint,
  stashChanges,
  revertFiles,
  getDiffForFile,
  createWorktree,
  createWorktreeFromBranch,
  removeWorktree,
  mergeWorktreeBranch,
  listBranches,
  getDefaultBranch,
  getRemoteUrl,
  commitWorktreeChanges,
  pushBranch,
} from '../../../src/core/git.js'

// Mock child_process.execFile
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

// Mock fs/promises — stub all methods used by createWorktree and removeWorktree
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    // access: resolves by default (dir/file exists); individual tests can override
    access: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    readFile: vi.fn().mockResolvedValue(''),
    appendFile: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    symlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  }
})
import * as fsp from 'node:fs/promises'

import * as cp from 'node:child_process'
const mockExecFile = cp.execFile as ReturnType<typeof vi.fn>

function mockExec(stdout: string, stderr = '', error: Error | null = null) {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
    ) => {
      cb(error, { stdout, stderr })
    }
  )
}

describe('getStatus()', () => {
  it('returns isDirty: false for clean tree', async () => {
    mockExec('')
    const result = await getStatus('/workspace')
    expect(result).toEqual({ isDirty: false, modifiedFiles: [] })
  })

  it('returns isDirty: true with modified files', async () => {
    mockExec(' M src/foo.ts\n M src/bar.ts\n')
    const result = await getStatus('/workspace')
    expect(result).toEqual({ isDirty: true, modifiedFiles: ['src/foo.ts', 'src/bar.ts'] })
  })

  it('returns error on git failure', async () => {
    mockExec('', 'fatal: not a git repo', new Error('exit 128'))
    const result = await getStatus('/workspace')
    expect(result).toHaveProperty('error')
  })
})

describe('createCheckpoint()', () => {
  it('returns commitHash on success', async () => {
    mockExec('[main abc1234] foundry: checkpoint\n 0 files changed')
    const result = await createCheckpoint('/workspace', 'run-001')
    expect(result).toEqual({ commitHash: 'abc1234' })
  })

  it('returns error on failure', async () => {
    mockExec('', 'error', new Error('exit 1'))
    const result = await createCheckpoint('/workspace', 'run-001')
    expect(result).toHaveProperty('error')
  })
})

describe('stashChanges()', () => {
  it('returns ok on success', async () => {
    mockExec('Saved working directory')
    const result = await stashChanges('/workspace')
    expect(result).toEqual({ ok: true })
  })

  it('returns error on git failure', async () => {
    mockExec('', '', new Error('nothing to stash'))
    const result = await stashChanges('/workspace')
    expect(result).toHaveProperty('error')
  })
})

describe('revertFiles()', () => {
  it('returns ok with reverted file list', async () => {
    mockExec('')
    const result = await revertFiles('/workspace', ['src/a.ts', 'src/b.ts'])
    expect(result).toEqual({ ok: true, reverted: ['src/a.ts', 'src/b.ts'] })
  })

  it('returns error when git checkout fails', async () => {
    mockExec('', 'error', new Error('exit 1'))
    const result = await revertFiles('/workspace', ['src/a.ts'])
    expect(result).toHaveProperty('error')
  })
})

describe('createCheckpoint() edge cases', () => {
  it('returns commitHash as unknown when git output has no hash match', async () => {
    mockExec('no hash here at all\n')
    const result = await createCheckpoint('/workspace', 'run-001')
    if ('error' in result) throw new Error('unexpected error')
    expect(result.commitHash).toBe('unknown')
  })
})

describe('revertFiles() edge cases', () => {
  it('returns ok immediately for empty file list', async () => {
    const result = await revertFiles('/workspace', [])
    expect(result).toEqual({ ok: true, reverted: [] })
  })
})

describe('getDiffForFile()', () => {
  it('returns unified diff with line counts', async () => {
    const diff = `diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,4 @@\n+import bar\n foo\n bar\n baz\n`
    mockExec(diff)
    const result = await getDiffForFile('/workspace', 'src/foo.ts')
    if ('error' in result) throw new Error('unexpected error')
    expect(result.unifiedDiff).toContain('+import bar')
    expect(result.linesAdded).toBeGreaterThanOrEqual(1)
  })

  it('returns empty diff when file is unchanged', async () => {
    mockExec('')
    const result = await getDiffForFile('/workspace', 'src/unchanged.ts')
    expect(result).toEqual({ unifiedDiff: '', linesAdded: 0, linesRemoved: 0 })
  })

  it('handles relative file path (not absolute)', async () => {
    const diff = `--- a/src/rel.ts\n+++ b/src/rel.ts\n@@ -1 +1 @@\n-old\n+new\n`
    mockExec(diff)
    // relative path — skips the absolute-path slice branch
    const result = await getDiffForFile('/workspace', 'src/rel.ts')
    if ('error' in result) throw new Error('unexpected error')
    expect(result.unifiedDiff).toContain('+new')
    expect(result.linesAdded).toBe(1)
    expect(result.linesRemoved).toBe(1)
  })

  it('strips workspaceRoot prefix from absolute path', async () => {
    const diff = `--- a/src/abs.ts\n+++ b/src/abs.ts\n@@ -1 +1 @@\n-x\n+y\n`
    mockExec(diff)
    // absolute path that starts with workspaceRoot — triggers the slice branch
    const result = await getDiffForFile('/workspace', '/workspace/src/abs.ts')
    if ('error' in result) throw new Error('unexpected error')
    expect(result.unifiedDiff).toContain('+y')
  })

  it('returns error when git diff fails', async () => {
    mockExec('', 'fatal error', new Error('exit 128'))
    const result = await getDiffForFile('/workspace', 'src/foo.ts')
    expect(result).toHaveProperty('error')
  })
})

describe('createWorktree()', () => {
  it('returns worktreePath inside .worktrees/ and branch with label', async () => {
    mockExec('')
    const result = await createWorktree(
      '/workspace',
      'abc12345-1234-1234-1234-123456789abc',
      'add-auth-middleware'
    )
    expect(result).toHaveProperty('worktreePath')
    expect(result).toHaveProperty('branch')
    expect(result).toHaveProperty('label')
    if ('branch' in result) {
      expect(result.branch).toBe('foundry/add-auth-middleware')
      expect(result.worktreePath).toContain('.worktrees')
      expect(result.label).toBe('add-auth-middleware')
    }
  })

  it('falls back to run-XXXX slug when no label provided', async () => {
    mockExec('')
    const result = await createWorktree('/workspace', 'abc12345-1234-1234-1234-123456789abc')
    if ('branch' in result) expect(result.branch).toMatch(/^foundry\/run-/)
  })

  it('returns error on git failure', async () => {
    mockExec('', '', new Error('not a git repo'))
    const result = await createWorktree(
      '/workspace',
      'abc12345-1234-1234-1234-123456789abc',
      'test-label'
    )
    expect(result).toHaveProperty('error')
  })

  it('returns error with helpful message when repo has no commits (HEAD invalid)', async () => {
    // First call is rev-parse HEAD — fails in an empty repo
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
      ) => {
        cb(new Error("fatal: ambiguous argument 'HEAD': unknown revision"), {
          stdout: '',
          stderr: '',
        })
      }
    )
    const result = await createWorktree(
      '/workspace',
      'abc12345-1234-1234-1234-123456789abc',
      'test-label'
    )
    expect(result).toHaveProperty('error')
    if ('error' in result) expect(result.error).toContain('no commits')
  })
})

describe('removeWorktree()', () => {
  it('returns ok when removal succeeds', async () => {
    mockExec('')
    const result = await removeWorktree('/workspace', '/tmp/wt', 'foundry/run-abc12345')
    expect(result).toHaveProperty('ok', true)
  })

  it('returns error but does not throw on git failure', async () => {
    mockExec('', '', new Error('no such worktree'))
    const result = await removeWorktree('/workspace', '/tmp/wt', 'foundry/run-abc12345')
    expect(result).toHaveProperty('error')
  })

  it('returns error even when fallback fs.rm also fails', async () => {
    mockExec('', '', new Error('no such worktree'))
    vi.mocked(fsp.rm).mockRejectedValueOnce(new Error('rm failed'))
    const result = await removeWorktree('/workspace', '/tmp/wt', 'foundry/run-abc12345')
    expect(result).toHaveProperty('error')
  })
})

describe('mergeWorktreeBranch()', () => {
  it('returns ok when merge succeeds', async () => {
    mockExec('Already up to date.')
    const result = await mergeWorktreeBranch('/workspace', 'foundry/run-abc12345')
    expect(result).toHaveProperty('ok', true)
  })

  it('returns error when merge fails', async () => {
    mockExec('', '', new Error('merge conflict'))
    const result = await mergeWorktreeBranch('/workspace', 'foundry/run-abc12345')
    expect(result).toHaveProperty('error')
  })
})

describe('listBranches()', () => {
  it('returns branches with current branch marked', async () => {
    const gitOutput = `* main\n  feat/auth\n  fix/bug-123\n`
    mockExec(gitOutput)
    const result = await listBranches('/workspace')
    if ('error' in result) throw new Error(result.error)
    expect(result.branches).toHaveLength(3)
    const main = result.branches.find((b) => b.name === 'main')
    expect(main?.current).toBe(true)
    const auth = result.branches.find((b) => b.name === 'feat/auth')
    expect(auth?.current).toBe(false)
  })

  it('returns sorted branch list with current branch first', async () => {
    const gitOutput = `  zebra\n* alpha\n  beta\n`
    mockExec(gitOutput)
    const result = await listBranches('/workspace')
    if ('error' in result) throw new Error(result.error)
    expect(result.branches[0].name).toBe('alpha')
    expect(result.branches[0].current).toBe(true)
  })

  it('returns error on git failure', async () => {
    mockExec('', 'fatal: not a git repo', new Error('exit 128'))
    const result = await listBranches('/workspace')
    expect(result).toHaveProperty('error')
  })

  it('handles empty branch list', async () => {
    mockExec('')
    const result = await listBranches('/workspace')
    if ('error' in result) throw new Error(result.error)
    expect(result.branches).toHaveLength(0)
  })
})

describe('createWorktreeFromBranch()', () => {
  it('creates worktree with explicit baseBranch and featureBranch', async () => {
    mockExec('')
    const result = await createWorktreeFromBranch('/workspace', 'fix/auth-timeout', 'main')
    if ('error' in result) throw new Error(result.error)
    expect(result.worktreePath).toContain('.worktrees')
    expect(result.worktreePath).toContain('fix-auth-timeout')
    expect(result.featureBranch).toBe('fix/auth-timeout')
  })

  it('converts slashes to dashes in the worktree directory name', async () => {
    mockExec('')
    const result = await createWorktreeFromBranch('/workspace', 'feat/add/thing', 'main')
    if ('error' in result) throw new Error(result.error)
    expect(result.worktreePath).toContain('feat-add-thing')
  })

  it('fails fast when feature branch already exists', async () => {
    // Exec call 1: git rev-parse HEAD — succeeds (repo has commits)
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
      ) => {
        cb(null, { stdout: 'abc1234', stderr: '' })
      }
    )
    // Exec call 2: git branch --list <featureBranch> — returns non-empty (branch exists)
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
      ) => {
        cb(null, { stdout: '  fix/auth-timeout\n', stderr: '' })
      }
    )
    const result = await createWorktreeFromBranch('/workspace', 'fix/auth-timeout', 'main')
    expect(result).toHaveProperty('error')
    if ('error' in result) expect(result.error).toContain('already exists')
  })

  it('returns error when repo has no commits', async () => {
    // First exec call in createWorktreeFromBranch is git rev-parse HEAD
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
      ) => {
        cb(new Error("fatal: ambiguous argument 'HEAD': unknown revision"), {
          stdout: '',
          stderr: '',
        })
      }
    )
    const result = await createWorktreeFromBranch('/workspace', 'fix/thing', 'main')
    expect(result).toHaveProperty('error')
    if ('error' in result) expect(result.error).toContain('no commits')
  })

  it('returns error on git worktree add failure', async () => {
    mockExec('', '', new Error('git worktree failed'))
    const result = await createWorktreeFromBranch('/workspace', 'fix/thing', 'main')
    expect(result).toHaveProperty('error')
  })
})

describe('getDefaultBranch()', () => {
  it('returns branch name from remote symbolic-ref', async () => {
    mockExec('origin/main\n')
    const result = await getDefaultBranch('/workspace')
    expect(result).toBe('main')
  })

  it('strips origin/ prefix from symbolic-ref output', async () => {
    mockExec('origin/master\n')
    const result = await getDefaultBranch('/workspace')
    expect(result).toBe('master')
  })

  it('falls back to "main" when symbolic-ref fails and main branch exists', async () => {
    // First call (symbolic-ref) fails
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
      ) => {
        cb(new Error('no remote HEAD'), { stdout: '', stderr: '' })
      }
    )
    // Second call (rev-parse main) succeeds
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
      ) => {
        cb(null, { stdout: 'abc1234', stderr: '' })
      }
    )
    const result = await getDefaultBranch('/workspace')
    expect(result).toBe('main')
  })

  it('falls back to "main" when all git commands fail', async () => {
    mockExec('', '', new Error('not a git repo'))
    const result = await getDefaultBranch('/workspace')
    expect(result).toBe('main')
  })
})

describe('getRemoteUrl()', () => {
  it('returns remote URL when origin exists', async () => {
    mockExec('https://github.com/org/repo.git\n')
    const result = await getRemoteUrl('/workspace')
    expect(result).toBe('https://github.com/org/repo.git')
  })

  it('returns null when remote origin is not set', async () => {
    mockExec('', '', new Error('no remote origin'))
    const result = await getRemoteUrl('/workspace')
    expect(result).toBeNull()
  })

  it('returns null for empty stdout', async () => {
    mockExec('')
    const result = await getRemoteUrl('/workspace')
    expect(result).toBeNull()
  })
})

describe('commitWorktreeChanges()', () => {
  it('returns commitHash on successful commit', async () => {
    // git add -A succeeds
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
      ) => {
        cb(null, { stdout: '', stderr: '' })
      }
    )
    // git commit returns standard output with hash
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
      ) => {
        cb(null, { stdout: '[main abc1234] foundry: auto-commit\n 2 files changed', stderr: '' })
      }
    )
    const result = await commitWorktreeChanges('/workspace/wt', 'foundry: auto-commit')
    expect(result).toHaveProperty('ok', true)
    if ('ok' in result) expect(result.commitHash).toBe('abc1234')
  })

  it('returns error when git commit fails', async () => {
    mockExec('', '', new Error('nothing to commit'))
    const result = await commitWorktreeChanges('/workspace/wt', 'foundry: auto-commit')
    expect(result).toHaveProperty('error')
  })
})

describe('pushBranch()', () => {
  it('returns ok on successful push', async () => {
    mockExec('')
    const result = await pushBranch('/workspace', 'foundry/run-abc12345')
    expect(result).toHaveProperty('ok', true)
  })

  it('returns error when push fails', async () => {
    mockExec('', 'error: failed to push', new Error('exit 1'))
    const result = await pushBranch('/workspace', 'foundry/run-abc12345')
    expect(result).toHaveProperty('error')
  })
})

describe('getDiffForFile() edge cases', () => {
  it('returns empty diff when file has no changes', async () => {
    // git diff HEAD succeeds but returns empty
    mockExec('')
    const result = await getDiffForFile('/workspace', 'src/unchanged.ts')
    if ('error' in result) throw new Error(result.error)
    expect(result.unifiedDiff).toBe('')
    expect(result.linesAdded).toBe(0)
  })

  it('returns error when both HEAD diff and no-index diff fail with empty output', async () => {
    // git diff HEAD fails (new file — headFailed path)
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
      ) => {
        cb(new Error('exit 128'), { stdout: '', stderr: 'fatal: bad object HEAD' })
      }
    )
    // git diff --no-index also fails with empty output
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
      ) => {
        cb(new Error('not a git repo'), { stdout: '', stderr: '' })
      }
    )
    const result = await getDiffForFile('/workspace', 'src/new.ts')
    expect(result).toHaveProperty('error')
  })
})
