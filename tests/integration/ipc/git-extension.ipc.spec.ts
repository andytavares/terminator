import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../extensions/git-integration/src/git/git-service', () => ({
  getStatus: vi.fn(),
  getDiff: vi.fn(),
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  commitChanges: vi.fn(),
}))

import * as gitService from '../../../extensions/git-integration/src/git/git-service'
import { registerGitExtensionHandlers } from '../../../extensions/git-integration/src/ipc/git.ipc'

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

describe('git-integration extension: git:status IPC handler', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('returns GitStatus for a valid git repo path', async () => {
    vi.mocked(gitService.getStatus).mockResolvedValue({
      branch: 'main',
      files: [{ path: 'src/main.ts', status: 'modified', staged: false, isBinary: false }],
      hasConflicts: false,
      truncated: false,
    })

    const result = await getHandler('git:status')({ path: '/tmp/repo', maxFiles: 500 })
    expect(gitService.getStatus).toHaveBeenCalledWith('/tmp/repo', 500)
    expect(result).toMatchObject({ branch: 'main', files: expect.any(Array) })
  })

  it('returns error for non-repo path', async () => {
    vi.mocked(gitService.getStatus).mockRejectedValue(new Error('not a git repository'))
    const result = (await getHandler('git:status')({ path: '/tmp/not-a-repo', maxFiles: 500 })) as {
      error: string
    }
    expect(result.error).toBeDefined()
  })

  it('returns VALIDATION_ERROR for missing path', async () => {
    const result = (await getHandler('git:status')({})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })
})

describe('git-integration extension: git:diff-file IPC handler', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('returns FileDiff for staged file', async () => {
    vi.mocked(gitService.getDiff).mockResolvedValue({
      path: 'src/main.ts',
      hunks: [],
      isBinary: false,
      truncated: false,
    })

    const result = await getHandler('git:diff-file')({
      repoRoot: '/tmp/repo',
      path: 'src/main.ts',
      staged: true,
    })
    expect(gitService.getDiff).toHaveBeenCalledWith('/tmp/repo', 'src/main.ts', true)
    expect(result).toMatchObject({ diff: expect.objectContaining({ path: 'src/main.ts' }) })
  })

  it('returns binary flag for binary file', async () => {
    vi.mocked(gitService.getDiff).mockResolvedValue({
      path: 'img.png',
      hunks: [],
      isBinary: true,
      truncated: false,
    })
    const result = (await getHandler('git:diff-file')({
      repoRoot: '/tmp/repo',
      path: 'img.png',
      staged: false,
    })) as { diff: { isBinary: boolean } }
    expect(result.diff.isBinary).toBe(true)
  })
})

describe('git-integration extension: git:stage / git:unstage IPC handlers', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('stages a file', async () => {
    vi.mocked(gitService.stageFiles).mockResolvedValue(undefined)
    const result = await getHandler('git:stage')({ repoRoot: '/tmp/repo', paths: ['src/main.ts'] })
    expect(gitService.stageFiles).toHaveBeenCalledWith('/tmp/repo', ['src/main.ts'])
    expect(result).toMatchObject({ success: true })
  })

  it('returns error for empty paths array on stage', async () => {
    const result = (await getHandler('git:stage')({ repoRoot: '/tmp/repo', paths: [] })) as {
      error: string
    }
    expect(result.error).toBeDefined()
  })

  it('unstages a file', async () => {
    vi.mocked(gitService.unstageFiles).mockResolvedValue(undefined)
    const result = await getHandler('git:unstage')({
      repoRoot: '/tmp/repo',
      paths: ['src/main.ts'],
    })
    expect(result).toMatchObject({ success: true })
  })
})

describe('git-integration extension: git:commit IPC handler', () => {
  let getHandler: (channel: string) => Handler

  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register)
    getHandler = registry.getHandler
  })

  it('commits staged changes and returns hash', async () => {
    vi.mocked(gitService.commitChanges).mockResolvedValue('abc123')
    const result = await getHandler('git:commit')({
      repoRoot: '/tmp/repo',
      message: 'feat: add feature',
    })
    expect(result).toMatchObject({ commitHash: 'abc123' })
  })

  it('returns EMPTY_MESSAGE when message is empty', async () => {
    const result = (await getHandler('git:commit')({ repoRoot: '/tmp/repo', message: '' })) as {
      error: string
    }
    expect(result.error).toBe('EMPTY_MESSAGE')
  })

  it('returns NOTHING_TO_COMMIT when no staged files', async () => {
    vi.mocked(gitService.commitChanges).mockRejectedValue(
      Object.assign(new Error('nothing to commit'), { code: 'NOTHING_TO_COMMIT' })
    )
    const result = (await getHandler('git:commit')({ repoRoot: '/tmp/repo', message: 'test' })) as {
      error: string
    }
    expect(result.error).toBeDefined()
  })
})
