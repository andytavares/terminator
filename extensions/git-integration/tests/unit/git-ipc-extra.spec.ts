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
import { bindWorkspaceRoots } from '../../src/ipc/repo-root'
import { channelRegistry } from './support/channels'

// ── helpers ───────────────────────────────────────────────────────────────────

type Handler = (payload: unknown) => Promise<unknown>

function buildRegistry() {
  bindWorkspaceRoots(() => ['/repo'])
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

beforeEach(() => {
  vi.clearAllMocks()
  const registry = buildRegistry()
  registerGitExtensionHandlers(registry.register, {
    signOff: () => false,
    maxDisplayedFiles: () => 500,
  })
  getHandler = registry.getHandler
})

// ── tests ─────────────────────────────────────────────────────────────────────

describe('git:status', () => {
  it('returns the status from getStatus, capped at the configured file limit', async () => {
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

  it('returns an error when getStatus throws', async () => {
    vi.mocked(gitService.getStatus).mockRejectedValue(new Error('not a git repository'))
    const result = (await getHandler('git:status')({ path: '/repo' })) as { error: string }
    expect(result.error).toContain('not a git repository')
  })
})

describe('git:diff-file', () => {
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
    expect(gitService.getDiff).toHaveBeenCalledWith('/repo', 'a.ts', {
      staged: true,
      isUntracked: false,
    })
    expect(result).toEqual({ diff: { path: 'a.ts', hunks: [], isBinary: false, truncated: false } })
  })
})

describe('git:diff-file — returns an error when getDiff throws', () => {
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

describe('git:unstage', () => {
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
      noVerify: true,
    })
    expect(gitService.commitChanges).toHaveBeenCalledWith('/repo', 'feat: add x', {
      signOff: false,
      noVerify: true,
      onOutput: expect.any(Function),
    })
    expect(result).toEqual({ commitHash: 'abc123' })
  })
})

describe('git:commit — defaults and streamed output', () => {
  it('defaults noVerify to false when omitted', async () => {
    vi.mocked(gitService.commitChanges).mockResolvedValue({ commitHash: 'abc123' })
    await getHandler('git:commit')({ repoRoot: '/repo', message: 'msg' })
    expect(gitService.commitChanges).toHaveBeenCalledWith('/repo', 'msg', {
      signOff: false,
      noVerify: false,
      onOutput: expect.any(Function),
    })
  })

  it('buffers onOutput lines so a poll during the commit can read them, then clears the buffer once the commit resolves', async () => {
    let captured: ((line: string) => void) | undefined
    vi.mocked(gitService.commitChanges).mockImplementation(async (_root, _msg, options) => {
      captured = options?.onOutput
      captured?.('running pre-commit hook')
      const poll = getHandler('git:commit-output-poll')
      const midCommit = (await poll({ repoRoot: '/repo' })) as { lines: string[] }
      expect(midCommit.lines).toEqual(['running pre-commit hook'])
      return { commitHash: 'abc123' }
    })

    await getHandler('git:commit')({ repoRoot: '/repo', message: 'msg' })

    const afterCommit = (await getHandler('git:commit-output-poll')({
      repoRoot: '/repo',
    })) as { lines: string[] }
    expect(afterCommit.lines).toEqual([])
  })
})

describe('git:commit-output-poll', () => {
  it('returns an empty lines array when no commit is in progress for that repo', async () => {
    const result = await getHandler('git:commit-output-poll')({ repoRoot: '/never-committed' })
    expect(result).toEqual({ lines: [] })
  })
})

describe('git:push handler (lines 96-110)', () => {
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
