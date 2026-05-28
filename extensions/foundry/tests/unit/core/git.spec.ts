import { describe, it, expect, vi } from 'vitest'
import {
  getStatus,
  createCheckpoint,
  stashChanges,
  revertFiles,
  getDiffForFile,
  createWorktree,
  removeWorktree,
  mergeWorktreeBranch,
} from '../../../src/core/git.js'

// Mock child_process.execFile
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

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
})

describe('createWorktree()', () => {
  it('returns worktreePath and branch on success', async () => {
    mockExec('')
    const result = await createWorktree('/workspace', 'abc12345-1234-1234-1234-123456789abc')
    expect(result).toHaveProperty('worktreePath')
    expect(result).toHaveProperty('branch')
    if ('branch' in result) expect(result.branch).toMatch(/^foundry\/run-/)
  })

  it('returns error on git failure', async () => {
    mockExec('', '', new Error('not a git repo'))
    const result = await createWorktree('/workspace', 'abc12345-1234-1234-1234-123456789abc')
    expect(result).toHaveProperty('error')
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
