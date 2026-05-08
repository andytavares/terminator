import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('../../../src/main/git/git-service', () => ({
  getStatus: vi.fn(),
  getDiff: vi.fn(),
  stageFiles: vi.fn(),
  unstageFiles: vi.fn(),
  commitChanges: vi.fn(),
  isGitRepo: vi.fn(),
  getGitRoot: vi.fn(),
  getCurrentBranch: vi.fn(),
  listBranches: vi.fn(),
  checkoutBranch: vi.fn(),
  suggestWorktreePath: vi.fn(),
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  listWorktrees: vi.fn(),
}))

import * as gitService from '../../../src/main/git/git-service'
import { registerGitHandlers } from '../../../src/main/ipc/git.ipc'

type Handler = (event: unknown, payload: unknown) => Promise<unknown>

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const found = calls.find(([c]) => c === channel)
  if (!found) throw new Error(`Handler for "${channel}" not registered`)
  return found[1] as Handler
}

describe('git:status IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerGitHandlers()
  })

  it('returns GitStatus for a valid git repo path', async () => {
    vi.mocked(gitService.getStatus).mockResolvedValue({
      branch: 'main',
      files: [{ path: 'src/main.ts', status: 'modified', staged: false, isBinary: false }],
      hasConflicts: false,
      truncated: false,
    })

    const handler = getHandler('git:status')
    const result = await handler({}, { path: '/tmp/repo', maxFiles: 500 })

    expect(gitService.getStatus).toHaveBeenCalledWith('/tmp/repo', 500)
    expect(result).toMatchObject({ branch: 'main', files: expect.any(Array) })
  })

  it('returns error for non-repo path', async () => {
    vi.mocked(gitService.getStatus).mockRejectedValue(new Error('not a git repository'))

    const handler = getHandler('git:status')
    const result = await handler({}, { path: '/tmp/not-a-repo', maxFiles: 500 }) as { error: string }
    expect(result.error).toBeDefined()
  })

  it('returns VALIDATION_ERROR for missing path', async () => {
    const handler = getHandler('git:status')
    const result = await handler({}, {}) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })
})

describe('git:diff-file IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerGitHandlers()
  })

  it('returns FileDiff for staged file', async () => {
    vi.mocked(gitService.getDiff).mockResolvedValue({
      path: 'src/main.ts',
      hunks: [],
      isBinary: false,
      truncated: false,
    })

    const handler = getHandler('git:diff-file')
    const result = await handler({}, { repoRoot: '/tmp/repo', path: 'src/main.ts', staged: true })
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

    const handler = getHandler('git:diff-file')
    const result = await handler({}, { repoRoot: '/tmp/repo', path: 'img.png', staged: false }) as { diff: { isBinary: boolean } }
    expect(result.diff.isBinary).toBe(true)
  })
})

describe('git:stage / git:unstage IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerGitHandlers()
  })

  it('stages a file', async () => {
    vi.mocked(gitService.stageFiles).mockResolvedValue(undefined)
    const handler = getHandler('git:stage')
    const result = await handler({}, { repoRoot: '/tmp/repo', paths: ['src/main.ts'] })
    expect(gitService.stageFiles).toHaveBeenCalledWith('/tmp/repo', ['src/main.ts'])
    expect(result).toMatchObject({ success: true })
  })

  it('returns error for empty paths array on stage', async () => {
    const handler = getHandler('git:stage')
    const result = await handler({}, { repoRoot: '/tmp/repo', paths: [] }) as { error: string }
    expect(result.error).toBeDefined()
  })

  it('unstages a file', async () => {
    vi.mocked(gitService.unstageFiles).mockResolvedValue(undefined)
    const handler = getHandler('git:unstage')
    const result = await handler({}, { repoRoot: '/tmp/repo', paths: ['src/main.ts'] })
    expect(result).toMatchObject({ success: true })
  })
})

describe('git:commit IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerGitHandlers()
  })

  it('commits staged changes and returns hash', async () => {
    vi.mocked(gitService.commitChanges).mockResolvedValue('abc123')
    const handler = getHandler('git:commit')
    const result = await handler({}, { repoRoot: '/tmp/repo', message: 'feat: add feature' })
    expect(result).toMatchObject({ commitHash: 'abc123' })
  })

  it('returns EMPTY_MESSAGE when message is empty', async () => {
    const handler = getHandler('git:commit')
    const result = await handler({}, { repoRoot: '/tmp/repo', message: '' }) as { error: string }
    expect(result.error).toBe('EMPTY_MESSAGE')
  })

  it('returns NOTHING_TO_COMMIT when no staged files', async () => {
    vi.mocked(gitService.commitChanges).mockRejectedValue(
      Object.assign(new Error('nothing to commit'), { code: 'NOTHING_TO_COMMIT' })
    )
    const handler = getHandler('git:commit')
    const result = await handler({}, { repoRoot: '/tmp/repo', message: 'test' }) as { error: string }
    expect(result.error).toBeDefined()
  })
})
