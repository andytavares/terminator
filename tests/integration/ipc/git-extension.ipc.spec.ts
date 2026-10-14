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
import { bindWorkspaceRoots } from '../../../extensions/git-integration/src/ipc/repo-root'
import { channelRegistry } from '../../../extensions/git-integration/tests/unit/support/channels'

type Handler = (payload: unknown) => Promise<unknown>

function buildRegistry() {
  bindWorkspaceRoots(() => ['/tmp/repo', '/tmp/not-a-repo'])
  const registry = channelRegistry()
  return {
    register: registry.register,
    getHandler:
      (channel: string): Handler =>
      (payload) =>
        registry.invoke(channel, payload),
  }
}

let getHandler: (channel: string) => Handler

/** Registers the extension's git handlers afresh before each case. */
function useGitHandlers(): void {
  beforeEach(() => {
    vi.clearAllMocks()
    const registry = buildRegistry()
    registerGitExtensionHandlers(registry.register, {
      signOff: () => false,
      maxDisplayedFiles: () => 500,
    })
    getHandler = registry.getHandler
  })
}

describe('git-integration extension: git:status IPC handler', () => {
  useGitHandlers()

  it('returns GitStatus for a valid git repo path', async () => {
    vi.mocked(gitService.getStatus).mockResolvedValue({
      branch: 'main',
      files: [{ path: 'src/main.ts', status: 'modified', staged: false, isBinary: false }],
      hasConflicts: false,
      truncated: false,
    })

    const result = await getHandler('git:status')({ path: '/tmp/repo' })
    expect(gitService.getStatus).toHaveBeenCalledWith('/tmp/repo', 500)
    expect(result).toMatchObject({ branch: 'main', files: expect.any(Array) })
  })

  it('returns error for non-repo path', async () => {
    vi.mocked(gitService.getStatus).mockRejectedValue(new Error('not a git repository'))
    const result = await getHandler('git:status')({ path: '/tmp/not-a-repo' })
    expect(result).toEqual({ error: 'Error: not a git repository' })
  })
})

describe('git-integration extension: git:diff-file IPC handler', () => {
  useGitHandlers()

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
    expect(gitService.getDiff).toHaveBeenCalledWith('/tmp/repo', 'src/main.ts', {
      staged: true,
      isUntracked: undefined,
    })
    expect(result).toMatchObject({ diff: expect.objectContaining({ path: 'src/main.ts' }) })
  })
})

describe('git-integration extension: git:diff-file IPC handler — binary files', () => {
  useGitHandlers()

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
  useGitHandlers()

  it('stages a file', async () => {
    vi.mocked(gitService.stageFiles).mockResolvedValue(undefined)
    const result = await getHandler('git:stage')({ repoRoot: '/tmp/repo', paths: ['src/main.ts'] })
    expect(gitService.stageFiles).toHaveBeenCalledWith('/tmp/repo', ['src/main.ts'])
    expect(result).toMatchObject({ success: true })
  })

  it('unstages a file', async () => {
    vi.mocked(gitService.unstageFiles).mockResolvedValue(undefined)
    const result = await getHandler('git:unstage')({
      repoRoot: '/tmp/repo',
      paths: ['src/main.ts'],
    })
    expect(gitService.unstageFiles).toHaveBeenCalledWith('/tmp/repo', ['src/main.ts'])
    expect(result).toMatchObject({ success: true })
  })
})

describe('git-integration extension: git:commit IPC handler', () => {
  useGitHandlers()

  it('commits staged changes and returns hash', async () => {
    vi.mocked(gitService.commitChanges).mockResolvedValue({ commitHash: 'abc123' })
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
})

describe('git-integration extension: git:commit IPC handler — refusals and hooks', () => {
  useGitHandlers()

  it('returns NOTHING_TO_COMMIT when no staged files', async () => {
    vi.mocked(gitService.commitChanges).mockResolvedValue({ error: 'NOTHING_TO_COMMIT' })
    const result = (await getHandler('git:commit')({ repoRoot: '/tmp/repo', message: 'test' })) as {
      error: string
    }
    expect(result.error).toBe('NOTHING_TO_COMMIT')
  })

  it('returns hook error with hookOutput when a pre-commit hook fails', async () => {
    vi.mocked(gitService.commitChanges).mockResolvedValue({
      error: 'HOOK_FAILED',
      hookOutput: 'lint: 3 errors',
      isHookFailure: true,
    })
    const result = (await getHandler('git:commit')({
      repoRoot: '/tmp/repo',
      message: 'test',
    })) as { error: string; hookOutput?: string; isHookFailure?: boolean }
    expect(result.error).toBe('HOOK_FAILED')
    expect(result.hookOutput).toBe('lint: 3 errors')
    expect(result.isHookFailure).toBe(true)
  })
})

describe('git-integration extension: git:commit IPC handler — skipping hooks', () => {
  useGitHandlers()

  it('passes noVerify to commitChanges', async () => {
    vi.mocked(gitService.commitChanges).mockResolvedValue({ commitHash: 'def456' })
    await getHandler('git:commit')({ repoRoot: '/tmp/repo', message: 'skip', noVerify: true })
    expect(gitService.commitChanges).toHaveBeenCalledWith('/tmp/repo', 'skip', {
      signOff: false,
      noVerify: true,
      onOutput: expect.any(Function),
    })
  })
})
