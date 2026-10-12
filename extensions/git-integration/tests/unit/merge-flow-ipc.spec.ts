import { describe, it, expect, vi, beforeEach } from 'vitest'
import { bindShellToAnswers } from './support/shell'

const {
  mockBuildConflictSession,
  mockReadConflictBlocks,
  mockListConflictedFiles,
  mockReadFile,
  mockWriteFile,
  mockStoreGet,
  mockStoreSet,
  mockStoreDel,
  mockExecFile,
} = vi.hoisted(() => ({
  mockBuildConflictSession: vi.fn(),
  mockReadConflictBlocks: vi.fn(),
  mockListConflictedFiles: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockStoreGet: vi.fn(),
  mockStoreSet: vi.fn(),
  mockStoreDel: vi.fn(),
  mockExecFile: vi.fn(),
}))

// --- mock conflict-reader ---
vi.mock('../../src/git/conflict-reader', () => ({
  buildConflictSession: (...a: unknown[]) => mockBuildConflictSession(...a),
  readConflictBlocks: (...a: unknown[]) => mockReadConflictBlocks(...a),
  listConflictedFiles: (...a: unknown[]) => mockListConflictedFiles(...a),
}))

// --- mock fs/promises ---
vi.mock('fs/promises', () => ({
  readFile: (...a: unknown[]) => mockReadFile(...a),
}))
// How the file is replaced is merge-flow-atomic-write.spec.ts's subject; here, what is written.
vi.mock('../../src/utils/write-atomic', () => ({
  writeFileAtomic: (...a: unknown[]) => mockWriteFile(...a),
}))

// --- mock electron-store ---
vi.mock('electron-store', () => ({
  default: class {
    get = mockStoreGet
    set = mockStoreSet
    delete = mockStoreDel
  },
}))

// Each git command is answered by mockExecFile(command, args, options).
bindShellToAnswers((...args) => mockExecFile(...args))

import { registerMergeFlowHandlers } from '../../src/ipc/merge-flow.ipc'
import { bindWorkspaceRoots } from '../../src/ipc/repo-root'
import { channelRegistry } from './support/channels'

function makeRegister() {
  const registry = channelRegistry()
  registerMergeFlowHandlers(registry.register)
  return registry
}

beforeEach(() => {
  bindWorkspaceRoots(() => ['/repo'])
  mockBuildConflictSession.mockReset()
  mockReadConflictBlocks.mockReset()
  mockListConflictedFiles.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockResolvedValue(undefined)
  mockStoreGet.mockReset()
  mockStoreSet.mockReset()
  mockStoreDel.mockReset()
  mockExecFile.mockReset()
})

describe('git:conflicts-list', () => {
  it('returns ConflictSession on success', async () => {
    const bridge = makeRegister()
    const fakeSession = {
      repoRoot: '/repo',
      files: [],
      totalConflicts: 0,
      totalResolved: 0,
      isRebase: false,
      startedAt: '',
    }
    mockBuildConflictSession.mockResolvedValueOnce(fakeSession)

    const result = await bridge.invoke('git:conflicts-list', { repoRoot: '/repo' })
    expect(result).toEqual(fakeSession)
  })

  it('returns error string on exception', async () => {
    const bridge = makeRegister()
    mockBuildConflictSession.mockRejectedValueOnce(new Error('git failed'))
    const result = (await bridge.invoke('git:conflicts-list', { repoRoot: '/repo' })) as {
      error: string
    }
    expect(result.error).toContain('git failed')
  })
})

describe('git:resolve-conflict', () => {
  it('writes resolved text to file and returns success', async () => {
    const bridge = makeRegister()
    const originalConflictText = '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch'
    const fileContent = `${originalConflictText}\n`
    mockReadFile.mockResolvedValueOnce(fileContent)
    mockReadConflictBlocks.mockReturnValueOnce([
      {
        blockId: 'src/foo.ts#0',
        index: 0,
        oursText: 'ours',
        theirsText: 'theirs',
        baseText: '',
        contextBefore: [],
        contextAfter: [],
        originalConflictText,
        isResolved: false,
      },
    ])

    const result = await bridge.invoke('git:resolve-conflict', {
      repoRoot: '/repo',
      blockId: 'src/foo.ts#0',
      resolvedText: 'resolved',
      strategy: 'ours',
    })
    expect(result).toEqual({ success: true })
    expect(mockWriteFile).toHaveBeenCalledOnce()
  })
})

describe('git:undo-resolve', () => {
  it('replaces resolved text with original conflict markers', async () => {
    const bridge = makeRegister()
    const resolvedText = 'const x = 1\n'
    const original = '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch'
    const fileContent = `before\n${resolvedText}after\n`
    mockReadFile.mockResolvedValueOnce(fileContent)
    mockWriteFile.mockResolvedValueOnce(undefined)

    const result = await bridge.invoke('git:undo-resolve', {
      repoRoot: '/repo',
      blockId: 'src/foo.ts#0',
      resolvedText,
      originalConflictText: original,
    })
    expect(result).toEqual({ success: true })
    const written = mockWriteFile.mock.calls.at(-1)?.[1] as string
    expect(written).toContain(original)
    expect(written).not.toContain(resolvedText)
  })

  it('returns error when resolved text not found in file', async () => {
    const bridge = makeRegister()
    mockReadFile.mockResolvedValueOnce('completely different content\n')
    const result = (await bridge.invoke('git:undo-resolve', {
      repoRoot: '/repo',
      blockId: 'src/foo.ts#0',
      resolvedText: 'const x = 1\n',
      originalConflictText: '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch',
    })) as { error: string }
    expect(result.error).toMatch(/not found/i)
  })
})

describe('git:merge-commit', () => {
  it('runs git add + git commit and returns commitHash', async () => {
    const bridge = makeRegister()
    mockExecFile
      .mockReturnValueOnce('') // git add
      .mockReturnValueOnce('[main abc1234] merge commit\n') // git commit

    const result = (await bridge.invoke('git:merge-commit', {
      repoRoot: '/repo',
      resolvedFilePaths: ['src/foo.ts'],
      commitMessage: 'Resolved conflicts',
    })) as { commitHash: string }
    expect(result.commitHash).toBeTruthy()
  })

  it('includes push error when push fails but commit succeeds', async () => {
    const bridge = makeRegister()
    mockExecFile
      .mockReturnValueOnce('') // git add
      .mockReturnValueOnce('[main abc1234] merge commit\n') // git commit
      .mockReturnValueOnce(new Error('no upstream')) // rev-parse for upstream fails → triggers push error

    const result = (await bridge.invoke('git:merge-commit', {
      repoRoot: '/repo',
      resolvedFilePaths: ['src/foo.ts'],
      commitMessage: 'Resolved conflicts',
    })) as { commitHash: string; pushError?: string }
    expect(result.commitHash).toBeTruthy()
    expect(result.pushError).toContain('no upstream')
  })

  it('resolves upstream and pushes when upstream is configured', async () => {
    const bridge = makeRegister()
    mockExecFile
      .mockReturnValueOnce('') // git add
      .mockReturnValueOnce('[main abc1234] merge commit\n') // git commit
      .mockReturnValueOnce('origin/feature/branch') // rev-parse upstream
      .mockReturnValueOnce('') // git push

    const result = (await bridge.invoke('git:merge-commit', {
      repoRoot: '/repo',
      resolvedFilePaths: ['src/foo.ts'],
      commitMessage: 'Resolved conflicts',
    })) as { commitHash: string; pushError?: string }
    expect(result.commitHash).toBeTruthy()
    expect(result.pushError).toBeUndefined()
    // push call should use force-with-lease
    const pushCall = mockExecFile.mock.calls[3]
    expect(pushCall[1]).toContain('--force-with-lease')
  })

  it('returns error on commit failure', async () => {
    const bridge = makeRegister()
    mockExecFile
      .mockReturnValueOnce('') // git add
      .mockReturnValueOnce(new Error('commit failed'))

    const result = (await bridge.invoke('git:merge-commit', {
      repoRoot: '/repo',
      resolvedFilePaths: ['src/foo.ts'],
      commitMessage: 'Resolved conflicts',
    })) as { error: string }
    expect(result.error).toContain('commit failed')
  })
})

describe('git:resolve-conflict — branch paths', () => {
  it('uses currentResolvedText when originalConflictText not in file', async () => {
    const bridge = makeRegister()
    const currentResolvedText = 'already resolved\n'
    // file contains the previously-resolved text, not the original conflict markers
    mockReadFile.mockResolvedValueOnce(`before\n${currentResolvedText}after\n`)

    const result = await bridge.invoke('git:resolve-conflict', {
      repoRoot: '/repo',
      blockId: 'src/foo.ts#0',
      resolvedText: 'new resolution',
      strategy: 'ours',
      currentResolvedText,
      originalConflictText: '<<<NOT IN FILE>>>',
    })
    expect(result).toEqual({ success: true })
    const written = mockWriteFile.mock.calls.at(-1)?.[1] as string
    expect(written).toContain('new resolution')
    expect(written).not.toContain(currentResolvedText)
  })

  it('falls back to index-based lookup when neither text found', async () => {
    const bridge = makeRegister()
    const fileContent = '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n'
    mockReadFile.mockResolvedValueOnce(fileContent)
    // readConflictBlocks returns a block at index 0
    mockReadConflictBlocks.mockReturnValueOnce([
      {
        blockId: 'src/foo.ts#0',
        index: 0,
        oursText: 'ours',
        theirsText: 'theirs',
        baseText: '',
        contextBefore: [],
        contextAfter: [],
        originalConflictText: '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch',
        isResolved: false,
      },
    ])

    const result = await bridge.invoke('git:resolve-conflict', {
      repoRoot: '/repo',
      blockId: 'src/foo.ts#0',
      resolvedText: 'resolved via index',
      strategy: 'theirs',
      // no originalConflictText, no currentResolvedText — forces fallback
    })
    expect(result).toEqual({ success: true })
  })

  it('returns soft success when block index not found (already consumed)', async () => {
    const bridge = makeRegister()
    // file has no conflict markers and neither text matches
    mockReadFile.mockResolvedValueOnce('clean content\n')
    // readConflictBlocks returns empty — block already consumed
    mockReadConflictBlocks.mockReturnValueOnce([])

    const countBefore = mockWriteFile.mock.calls.length
    const result = await bridge.invoke('git:resolve-conflict', {
      repoRoot: '/repo',
      blockId: 'src/foo.ts#0',
      resolvedText: 'resolved',
      strategy: 'ours',
    })
    expect(result).toEqual({ success: true })
    // writeFile must not have been called in this invocation
    expect(mockWriteFile.mock.calls.length).toBe(countBefore)
  })

  it('returns error on readFile exception', async () => {
    const bridge = makeRegister()
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'))
    const result = (await bridge.invoke('git:resolve-conflict', {
      repoRoot: '/repo',
      blockId: 'src/foo.ts#0',
      resolvedText: 'resolved',
      strategy: 'ours',
    })) as { error: string }
    expect(result.error).toContain('ENOENT')
  })
})

describe('git:session-restore', () => {
  it('returns null session when nothing stored', async () => {
    const bridge = makeRegister()
    mockStoreGet.mockReturnValueOnce(undefined)
    const result = (await bridge.invoke('git:session-restore', { repoRoot: '/repo' })) as {
      session: null
    }
    expect(result.session).toBeNull()
  })

  it('returns stored session when present and valid', async () => {
    const bridge = makeRegister()
    const storedSession = {
      repoRoot: '/repo',
      files: [
        {
          filePath: 'src/foo.ts',
          conflictCount: 1,
          resolvedCount: 0,
          blocks: [],
          conflictDescription: '',
          oursAuthor: { name: 'A', commitHash: 'a', timestamp: '' },
          theirsAuthor: { name: 'B', commitHash: 'b', timestamp: '' },
        },
      ],
      totalConflicts: 1,
      totalResolved: 0,
      isRebase: false,
      startedAt: '',
    }
    mockStoreGet.mockReturnValueOnce(storedSession)
    mockListConflictedFiles.mockResolvedValueOnce(['src/foo.ts'])
    const result = (await bridge.invoke('git:session-restore', { repoRoot: '/repo' })) as {
      session: unknown
    }
    expect(result.session).toEqual(storedSession)
  })

  it('clears session and returns null when no conflicted files remain in working tree', async () => {
    const bridge = makeRegister()
    const storedSession = {
      repoRoot: '/repo',
      files: [{ filePath: 'src/foo.ts' }],
      totalConflicts: 1,
      totalResolved: 0,
      isRebase: false,
      startedAt: '',
    }
    mockStoreGet.mockReturnValueOnce(storedSession)
    // No conflicted files — merge was already completed externally
    mockListConflictedFiles.mockResolvedValueOnce([])
    const result = (await bridge.invoke('git:session-restore', { repoRoot: '/repo' })) as {
      session: null
    }
    expect(result.session).toBeNull()
    expect(mockStoreDel).toHaveBeenCalledOnce()
  })

  it('returns null when stored session has 0 conflicts (stale empty session)', async () => {
    const bridge = makeRegister()
    const staleSession = {
      repoRoot: '/repo',
      files: [],
      totalConflicts: 0,
      totalResolved: 0,
      isRebase: false,
      startedAt: '',
    }
    mockStoreGet.mockReturnValueOnce(staleSession)
    mockListConflictedFiles.mockResolvedValueOnce(['src/foo.ts'])
    const result = (await bridge.invoke('git:session-restore', { repoRoot: '/repo' })) as {
      session: null
    }
    expect(result.session).toBeNull()
    expect(mockStoreDel).toHaveBeenCalledOnce()
  })
})

describe('git:session-persist — error path', () => {
  it('returns error when store.set throws', async () => {
    const bridge = makeRegister()
    mockStoreSet.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    const result = (await bridge.invoke('git:session-persist', {
      repoRoot: '/repo',
      session: { totalConflicts: 1 },
    })) as { error: string }
    expect(result.error).toContain('disk full')
  })
})

describe('git:session-persist', () => {
  it('persists session and returns success', async () => {
    const bridge = makeRegister()
    mockStoreSet.mockReturnValueOnce(undefined)
    const session = {
      repoRoot: '/repo',
      files: [],
      totalConflicts: 0,
      totalResolved: 0,
      isRebase: false,
      startedAt: '',
    }
    const result = await bridge.invoke('git:session-persist', { repoRoot: '/repo', session })
    expect(result).toEqual({ success: true })
    expect(mockStoreSet).toHaveBeenCalledOnce()
  })
})

describe('git:session-clear', () => {
  it('clears session and returns success', async () => {
    const bridge = makeRegister()
    mockStoreDel.mockReturnValueOnce(undefined)
    const result = await bridge.invoke('git:session-clear', { repoRoot: '/repo' })
    expect(result).toEqual({ success: true })
    expect(mockStoreDel).toHaveBeenCalledOnce()
  })

  it('returns success even when store.delete throws', async () => {
    const bridge = makeRegister()
    mockStoreDel.mockImplementationOnce(() => {
      throw new Error('store error')
    })
    const result = await bridge.invoke('git:session-clear', { repoRoot: '/repo' })
    expect(result).toEqual({ success: true })
  })
})

describe('git:session-reset', () => {
  it('runs git checkout --conflict=merge for each file and clears store', async () => {
    const bridge = makeRegister()
    // promisify wrapper calls mockExecFile(...args) and expects a string return
    mockExecFile.mockReturnValue('')
    const result = await bridge.invoke('git:session-reset', {
      repoRoot: '/repo',
      files: [{ filePath: 'src/foo.ts' }, { filePath: 'src/bar.ts' }],
    })
    expect(result).toEqual({ success: true })
    expect(mockStoreDel).toHaveBeenCalledOnce()
    // git called twice — once per file
    expect(mockExecFile).toHaveBeenCalledTimes(2)
    const firstCall = mockExecFile.mock.calls[0]
    expect(firstCall[0]).toBe('git')
    expect(firstCall[1]).toContain('--conflict=merge')
    expect(firstCall[1]).toContain('src/foo.ts')
  })

  it('returns error when git command fails', async () => {
    const bridge = makeRegister()
    mockExecFile.mockReturnValue(new Error('git error'))
    const result = (await bridge.invoke('git:session-reset', {
      repoRoot: '/repo',
      files: [{ filePath: 'src/foo.ts' }],
    })) as { error: string }
    expect(result.error).toBeTruthy()
  })
})

describe('git:prepare-pr-worktree', () => {
  it('returns error when head remote ref not found', async () => {
    const bridge = makeRegister()
    // rev-parse for origin/headRef fails; origin/baseRef succeeds
    mockExecFile
      .mockReturnValueOnce(new Error('unknown ref')) // origin/head
      .mockReturnValueOnce('abc123') // origin/base

    const result = (await bridge.invoke('git:prepare-pr-worktree', {
      repoRoot: '/repo',
      worktreePath: '/tmp/wt',
      headRefName: 'feature',
      baseRefName: 'main',
    })) as { error: string }
    expect(result.error).toContain("'origin/feature' not found")
  })

  it('returns error when base remote ref not found', async () => {
    const bridge = makeRegister()
    mockExecFile
      .mockReturnValueOnce('abc123') // origin/head succeeds
      .mockReturnValueOnce(new Error('unknown ref')) // origin/base fails

    const result = (await bridge.invoke('git:prepare-pr-worktree', {
      repoRoot: '/repo',
      worktreePath: '/tmp/wt',
      headRefName: 'feature',
      baseRefName: 'main',
    })) as { error: string }
    expect(result.error).toContain("'origin/main' not found")
  })

  it('returns hasConflicts: false on clean merge', async () => {
    const bridge = makeRegister()
    mockExecFile
      .mockReturnValueOnce('abc123') // rev-parse head
      .mockReturnValueOnce('def456') // rev-parse base
      .mockReturnValueOnce('') // worktree add
      .mockReturnValueOnce('') // git merge — succeeds (clean)

    const result = (await bridge.invoke('git:prepare-pr-worktree', {
      repoRoot: '/repo',
      worktreePath: '/tmp/wt',
      headRefName: 'feature',
      baseRefName: 'main',
    })) as { hasConflicts: boolean }
    expect(result.hasConflicts).toBe(false)
  })

  it('returns hasConflicts: true when merge produces conflict markers', async () => {
    const bridge = makeRegister()
    mockExecFile
      .mockReturnValueOnce('abc123') // rev-parse head
      .mockReturnValueOnce('def456') // rev-parse base
      .mockReturnValueOnce('') // worktree add
      .mockReturnValueOnce(new Error('CONFLICT')) // git merge exits non-zero

    mockListConflictedFiles.mockResolvedValueOnce(['src/foo.ts'])

    const result = (await bridge.invoke('git:prepare-pr-worktree', {
      repoRoot: '/repo',
      worktreePath: '/tmp/wt',
      headRefName: 'feature',
      baseRefName: 'main',
    })) as { hasConflicts: boolean }
    expect(result.hasConflicts).toBe(true)
  })

  it('returns error when merge fails with no conflict markers', async () => {
    const bridge = makeRegister()
    mockExecFile
      .mockReturnValueOnce('abc123') // rev-parse head
      .mockReturnValueOnce('def456') // rev-parse base
      .mockReturnValueOnce('') // worktree add
      .mockReturnValueOnce(new Error('unrelated histories')) // merge fails
      .mockReturnValueOnce('') // worktree remove cleanup

    mockListConflictedFiles.mockResolvedValueOnce([]) // no conflict markers

    const result = (await bridge.invoke('git:prepare-pr-worktree', {
      repoRoot: '/repo',
      worktreePath: '/tmp/wt',
      headRefName: 'feature',
      baseRefName: 'main',
    })) as { error: string }
    expect(result.error).toContain('no conflict markers')
  })

  it('returns error and cleans up worktree on outer exception', async () => {
    const bridge = makeRegister()
    mockExecFile
      .mockReturnValueOnce('abc123') // rev-parse head
      .mockReturnValueOnce('def456') // rev-parse base
      .mockReturnValueOnce(new Error('worktree add failed')) // worktree add
      .mockReturnValueOnce('') // worktree remove cleanup

    const result = (await bridge.invoke('git:prepare-pr-worktree', {
      repoRoot: '/repo',
      worktreePath: '/tmp/wt',
      headRefName: 'feature',
      baseRefName: 'main',
    })) as { error: string }
    expect(result.error).toContain('worktree add failed')
  })
})
