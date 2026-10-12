// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockInvoke = vi.fn().mockResolvedValue({})

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as unknown as Record<string, unknown>).window = globalThis
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke: mockInvoke },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('mergeFlowAPI bridge', () => {
  it('listConflicts calls correct channel', async () => {
    const { mergeFlowAPI } = await import('../../src/api/merge-flow')
    await mergeFlowAPI.listConflicts('/repo')
    expect(mockInvoke).toHaveBeenCalledWith('git:conflicts-list', { repoRoot: '/repo' })
  })

  it('resolveConflict calls correct channel with all args', async () => {
    const { mergeFlowAPI } = await import('../../src/api/merge-flow')
    await mergeFlowAPI.resolveConflict('/repo', 'src/foo.ts#0', 'resolved', 'ours', 'prev', 'orig')
    expect(mockInvoke).toHaveBeenCalledWith('git:resolve-conflict', {
      repoRoot: '/repo',
      blockId: 'src/foo.ts#0',
      resolvedText: 'resolved',
      strategy: 'ours',
      currentResolvedText: 'prev',
      originalConflictText: 'orig',
    })
  })
})

describe('mergeFlowAPI bridge — resolveConflict calls correct channel without optional args', () => {
  it('resolveConflict calls correct channel without optional args', async () => {
    const { mergeFlowAPI } = await import('../../src/api/merge-flow')
    await mergeFlowAPI.resolveConflict('/repo', 'src/foo.ts#0', 'resolved', 'theirs')
    expect(mockInvoke).toHaveBeenCalledWith('git:resolve-conflict', {
      repoRoot: '/repo',
      blockId: 'src/foo.ts#0',
      resolvedText: 'resolved',
      strategy: 'theirs',
      currentResolvedText: undefined,
      originalConflictText: undefined,
    })
  })

  it('undoResolve calls correct channel', async () => {
    const { mergeFlowAPI } = await import('../../src/api/merge-flow')
    await mergeFlowAPI.undoResolve('/repo', 'src/foo.ts#0', 'resolved', 'original')
    expect(mockInvoke).toHaveBeenCalledWith('git:undo-resolve', {
      repoRoot: '/repo',
      blockId: 'src/foo.ts#0',
      resolvedText: 'resolved',
      originalConflictText: 'original',
    })
  })
})

describe('mergeFlowAPI bridge — mergeCommit calls correct channel', () => {
  it('mergeCommit calls correct channel', async () => {
    const { mergeFlowAPI } = await import('../../src/api/merge-flow')
    await mergeFlowAPI.mergeCommit('/repo', ['src/foo.ts', 'src/bar.ts'], 'Merge conflict resolved')
    expect(mockInvoke).toHaveBeenCalledWith('git:merge-commit', {
      repoRoot: '/repo',
      resolvedFilePaths: ['src/foo.ts', 'src/bar.ts'],
      commitMessage: 'Merge conflict resolved',
    })
  })

  it('restoreSession calls correct channel', async () => {
    const { mergeFlowAPI } = await import('../../src/api/merge-flow')
    await mergeFlowAPI.restoreSession('/repo')
    expect(mockInvoke).toHaveBeenCalledWith('git:session-restore', { repoRoot: '/repo' })
  })
})

describe('mergeFlowAPI bridge — persistSession calls correct channel', () => {
  it('persistSession calls correct channel', async () => {
    const { mergeFlowAPI } = await import('../../src/api/merge-flow')
    const session = {
      repoRoot: '/repo',
      files: [],
      totalConflicts: 1,
      totalResolved: 0,
      isRebase: false,
      startedAt: '2024-01-01',
    } as Parameters<typeof mergeFlowAPI.persistSession>[1]
    await mergeFlowAPI.persistSession('/repo', session)
    expect(mockInvoke).toHaveBeenCalledWith('git:session-persist', {
      repoRoot: '/repo',
      session,
    })
  })

  it('clearSession calls correct channel', async () => {
    const { mergeFlowAPI } = await import('../../src/api/merge-flow')
    await mergeFlowAPI.clearSession('/repo')
    expect(mockInvoke).toHaveBeenCalledWith('git:session-clear', { repoRoot: '/repo' })
  })
})

describe('mergeFlowAPI bridge — resetSession calls correct channel', () => {
  it('resetSession calls correct channel', async () => {
    const { mergeFlowAPI } = await import('../../src/api/merge-flow')
    const files = [{ filePath: 'src/foo.ts' }, { filePath: 'src/bar.ts' }]
    await mergeFlowAPI.resetSession('/repo', files)
    expect(mockInvoke).toHaveBeenCalledWith('git:session-reset', { repoRoot: '/repo', files })
  })

  it('preparePrWorktree calls correct channel', async () => {
    const { mergeFlowAPI } = await import('../../src/api/merge-flow')
    await mergeFlowAPI.preparePrWorktree('/repo', '/tmp/wt', 'feature/branch', 'main')
    expect(mockInvoke).toHaveBeenCalledWith('git:prepare-pr-worktree', {
      repoRoot: '/repo',
      worktreePath: '/tmp/wt',
      headRefName: 'feature/branch',
      baseRefName: 'main',
    })
  })
})
