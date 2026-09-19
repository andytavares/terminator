/**
 * Additional coverage for extensions/git-integration/src/ipc/git.ipc.ts
 * Covers: git:status, git:diff-file, git:stage (error and success), git:unstage
 * (validation and error), git:commit, git:commit-output-poll, and git:push
 * (which delegates to git-service's pushBranch()).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── hoisted mocks ─────────────────────────────────────────────────────────────

vi.mock('../../src/git/git-service', () => ({
  getStatus: vi.fn(),
  getDiff: vi.fn(),
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  commitChanges: vi.fn(),
  pushBranch: vi.fn(),
}))

import * as gitService from '../../src/git/git-service'
import { registerGitExtensionHandlers } from '../../src/ipc/git.ipc'

// ── helpers ───────────────────────────────────────────────────────────────────

type Handler = (payload: unknown) => Promise<unknown>

function buildRegistry(): {
  register: (channel: string, handler: Handler) => void
  getHandler: (channel: string) => Handler
} {
  const handlers = new Map<string, Handler>()
  return {
    register: (channel, handler) => handlers.set(channel, handler as Handler),
    getHandler: (channel) => {
      const h = handlers.get(channel)
      if (!h) throw new Error(`Handler for "${channel}" not registered`)
      return h
    },
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('git:status', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('returns VALIDATION_ERROR for a missing path', async () => {
    const result = (await getHandler('git:status')({})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns the status from getStatus, defaulting maxFiles to 500', async () => {
    vi.mocked(gitService.getStatus).mockResolvedValue({
      branch: 'main',
      files: [],
      hasConflicts: false,
      truncated: false,
    })
    const result = await getHandler('git:status')({ path: '/repo' })
    expect(gitService.getStatus).toHaveBeenCalledWith('/repo', 500)
    expect(result).toEqual({ branch: 'main', files: [], hasConflicts: false, truncated: false })
  })

  it('forwards a caller-supplied maxFiles', async () => {
    vi.mocked(gitService.getStatus).mockResolvedValue({
      branch: 'main',
      files: [],
      hasConflicts: false,
      truncated: false,
    })
    await getHandler('git:status')({ path: '/repo', maxFiles: 10 })
    expect(gitService.getStatus).toHaveBeenCalledWith('/repo', 10)
  })

  it('returns an error when getStatus throws', async () => {
    vi.mocked(gitService.getStatus).mockRejectedValue(new Error('not a git repository'))
    const result = (await getHandler('git:status')({ path: '/repo' })) as { error: string }
    expect(result.error).toContain('not a git repository')
  })
})

describe('git:diff-file', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('returns VALIDATION_ERROR when staged is missing', async () => {
    const result = (await getHandler('git:diff-file')({
      repoRoot: '/repo',
      path: 'a.ts',
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('wraps the diff from getDiff, passing staged and isUntracked through', async () => {
    vi.mocked(gitService.getDiff).mockResolvedValue({
      path: 'a.ts',
      hunks: [],
      isBinary: false,
      truncated: false,
    })
    const result = await getHandler('git:diff-file')({
      repoRoot: '/repo',
      path: 'a.ts',
      staged: true,
      isUntracked: false,
    })
    expect(gitService.getDiff).toHaveBeenCalledWith('/repo', 'a.ts', true, false)
    expect(result).toEqual({ diff: { path: 'a.ts', hunks: [], isBinary: false, truncated: false } })
  })

  it('returns an error when getDiff throws', async () => {
    vi.mocked(gitService.getDiff).mockRejectedValue(new Error('no such path'))
    const result = (await getHandler('git:diff-file')({
      repoRoot: '/repo',
      path: 'a.ts',
      staged: false,
    })) as { error: string }
    expect(result.error).toContain('no such path')
  })
})

describe('git:stage', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('returns success when stageFiles succeeds', async () => {
    vi.mocked(gitService.stageFiles).mockResolvedValue(undefined)
    const result = await getHandler('git:stage')({ repoRoot: '/repo', paths: ['src/main.ts'] })
    expect(gitService.stageFiles).toHaveBeenCalledWith('/repo', ['src/main.ts'])
    expect(result).toEqual({ success: true })
  })

  it('returns error when stageFiles throws', async () => {
    vi.mocked(gitService.stageFiles).mockRejectedValue(new Error('permission denied'))
    const result = (await getHandler('git:stage')({
      repoRoot: '/repo',
      paths: ['src/main.ts'],
    })) as { error: string }
    expect(result.error).toContain('permission denied')
  })
})

describe('git:unstage — validation error (line 62-63) and error path (line 74-75)', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await getHandler('git:unstage')({ paths: ['src/main.ts'] })) as {
      error: string
    }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns VALIDATION_ERROR for empty paths array', async () => {
    const result = (await getHandler('git:unstage')({
      repoRoot: '/repo',
      paths: [],
    })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns error when unstageFiles throws', async () => {
    vi.mocked(gitService.unstageFiles).mockRejectedValue(new Error('index locked'))
    const result = (await getHandler('git:unstage')({
      repoRoot: '/repo',
      paths: ['src/main.ts'],
    })) as { error: string }
    expect(result.error).toContain('index locked')
  })

  it('returns success when unstageFiles succeeds', async () => {
    vi.mocked(gitService.unstageFiles).mockResolvedValue(undefined)
    const result = await getHandler('git:unstage')({ repoRoot: '/repo', paths: ['src/foo.ts'] })
    expect(result).toMatchObject({ success: true })
  })
})

describe('git:commit', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('returns VALIDATION_ERROR for a missing repoRoot', async () => {
    const result = (await getHandler('git:commit')({ message: 'msg' })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns EMPTY_MESSAGE for a blank message and never calls commitChanges', async () => {
    const result = (await getHandler('git:commit')({
      repoRoot: '/repo',
      message: '   ',
    })) as { error: string }
    expect(result.error).toBe('EMPTY_MESSAGE')
    expect(gitService.commitChanges).not.toHaveBeenCalled()
  })

  it('forwards the trimmed args to commitChanges and returns its result', async () => {
    vi.mocked(gitService.commitChanges).mockResolvedValue({ commitHash: 'abc123' })
    const result = await getHandler('git:commit')({
      repoRoot: '/repo',
      message: 'feat: add x',
      signOff: true,
      noVerify: true,
    })
    expect(gitService.commitChanges).toHaveBeenCalledWith(
      '/repo',
      'feat: add x',
      true,
      true,
      expect.any(Function)
    )
    expect(result).toEqual({ commitHash: 'abc123' })
  })

  it('defaults signOff and noVerify to false when omitted', async () => {
    vi.mocked(gitService.commitChanges).mockResolvedValue({ commitHash: 'abc123' })
    await getHandler('git:commit')({ repoRoot: '/repo', message: 'msg' })
    expect(gitService.commitChanges).toHaveBeenCalledWith(
      '/repo',
      'msg',
      false,
      false,
      expect.any(Function)
    )
  })

  it('buffers onOutput lines so a poll during the commit can read them, then clears the buffer once the commit resolves', async () => {
    let captured: ((line: string) => void) | undefined
    vi.mocked(gitService.commitChanges).mockImplementation(
      async (_root, _msg, _s, _n, onOutput) => {
        captured = onOutput
        captured?.('running pre-commit hook')
        const poll = getHandler('git:commit-output-poll')
        const midCommit = (await poll({ repoRoot: '/repo' })) as { lines: string[] }
        expect(midCommit.lines).toEqual(['running pre-commit hook'])
        return { commitHash: 'abc123' }
      }
    )

    await getHandler('git:commit')({ repoRoot: '/repo', message: 'msg' })

    const afterCommit = (await getHandler('git:commit-output-poll')({
      repoRoot: '/repo',
    })) as { lines: string[] }
    expect(afterCommit.lines).toEqual([])
  })
})

describe('git:commit-output-poll', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('returns an empty lines array for a missing repoRoot', async () => {
    const result = await getHandler('git:commit-output-poll')({})
    expect(result).toEqual({ lines: [] })
  })

  it('returns an empty lines array when no commit is in progress for that repo', async () => {
    const result = await getHandler('git:commit-output-poll')({ repoRoot: '/never-committed' })
    expect(result).toEqual({ lines: [] })
  })
})

describe('git:push handler (lines 96-110)', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('returns VALIDATION_ERROR for missing repoRoot', async () => {
    const result = (await getHandler('git:push')({})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('delegates to pushBranch with the repo root', async () => {
    vi.mocked(gitService.pushBranch).mockResolvedValue({
      success: true,
      branch: 'main',
      remote: 'origin',
    })
    const result = await getHandler('git:push')({ repoRoot: '/repo' })
    expect(gitService.pushBranch).toHaveBeenCalledWith('/repo')
    expect(result).toEqual({ success: true, branch: 'main', remote: 'origin' })
  })

  it('returns pushBranch errors unchanged', async () => {
    vi.mocked(gitService.pushBranch).mockResolvedValue({ error: 'NO_UPSTREAM' })
    const result = (await getHandler('git:push')({ repoRoot: '/repo' })) as { error: string }
    expect(result.error).toBe('NO_UPSTREAM')
  })
})

describe('git:pr-status and git:pr-create stubs', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('git:pr-status returns { pr: null }', async () => {
    const result = await getHandler('git:pr-status')({})
    expect(result).toEqual({ pr: null })
  })

  it('git:pr-create returns NOT_IMPLEMENTED', async () => {
    const result = (await getHandler('git:pr-create')({})) as { error: string }
    expect(result.error).toBe('NOT_IMPLEMENTED')
  })
})
