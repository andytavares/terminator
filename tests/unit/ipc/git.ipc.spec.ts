import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle } = vi.hoisted(() => ({ mockHandle: vi.fn() }))

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, on: vi.fn(), removeHandler: vi.fn() },
}))

const gitService = vi.hoisted(() => ({
  isGitRepo: vi.fn(),
  getGitRoot: vi.fn(),
  getCurrentBranch: vi.fn(),
  listBranches: vi.fn(),
  checkoutBranch: vi.fn(),
  createBranch: vi.fn(),
  suggestWorktreePath: vi.fn(),
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  listWorktrees: vi.fn(),
}))
vi.mock('../../../src/main/git/git-service.js', () => gitService)

import { registerGitHandlers } from '../../../src/main/ipc/git.ipc.js'

function handler(channel: string) {
  return mockHandle.mock.calls.find(([ch]) => ch === channel)![1] as (
    event: unknown,
    payload?: unknown
  ) => Promise<unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  registerGitHandlers()
})

describe('git:is-repo', () => {
  it('returns root when the path is a repo', async () => {
    gitService.isGitRepo.mockResolvedValue(true)
    gitService.getGitRoot.mockResolvedValue('/repo')
    await expect(handler('git:is-repo')({}, { path: '/repo/sub' })).resolves.toEqual({
      isRepo: true,
      root: '/repo',
    })
  })

  it('returns isRepo false for non-repos, invalid payloads, and thrown errors', async () => {
    gitService.isGitRepo.mockResolvedValue(false)
    await expect(handler('git:is-repo')({}, { path: '/x' })).resolves.toEqual({ isRepo: false })
    await expect(handler('git:is-repo')({}, {})).resolves.toEqual({ isRepo: false })
    gitService.isGitRepo.mockRejectedValue(new Error('io'))
    await expect(handler('git:is-repo')({}, { path: '/x' })).resolves.toEqual({ isRepo: false })
  })
})

describe('git:current-branch', () => {
  it('returns the branch', async () => {
    gitService.getCurrentBranch.mockResolvedValue('main')
    await expect(handler('git:current-branch')({}, { path: '/r' })).resolves.toEqual({
      branch: 'main',
    })
  })

  it('maps invalid payloads and errors to error envelopes', async () => {
    await expect(handler('git:current-branch')({}, {})).resolves.toEqual({ error: 'INVALID_PATH' })
    gitService.getCurrentBranch.mockRejectedValue(new Error('detached'))
    await expect(handler('git:current-branch')({}, { path: '/r' })).resolves.toEqual({
      error: 'Error: detached',
    })
  })
})

describe('git:list-branches', () => {
  it('returns branches, and an empty list on invalid payload or error', async () => {
    gitService.listBranches.mockResolvedValue(['main', 'dev'])
    await expect(handler('git:list-branches')({}, { path: '/r' })).resolves.toEqual({
      branches: ['main', 'dev'],
    })
    await expect(handler('git:list-branches')({}, {})).resolves.toEqual({ branches: [] })
    gitService.listBranches.mockRejectedValue(new Error('io'))
    await expect(handler('git:list-branches')({}, { path: '/r' })).resolves.toEqual({
      branches: [],
    })
  })
})

describe('git:checkout and git:create-branch', () => {
  it('dispatches to the service and reports success', async () => {
    gitService.checkoutBranch.mockResolvedValue(undefined)
    gitService.createBranch.mockResolvedValue(undefined)
    await expect(handler('git:checkout')({}, { path: '/r', branch: 'dev' })).resolves.toEqual({
      success: true,
    })
    expect(gitService.checkoutBranch).toHaveBeenCalledWith('/r', 'dev')
    await expect(handler('git:create-branch')({}, { path: '/r', branch: 'new' })).resolves.toEqual({
      success: true,
    })
    expect(gitService.createBranch).toHaveBeenCalledWith('/r', 'new')
  })

  it('maps invalid payloads and errors to error envelopes', async () => {
    await expect(handler('git:checkout')({}, { path: '/r' })).resolves.toEqual({
      error: 'VALIDATION_ERROR',
    })
    gitService.checkoutBranch.mockRejectedValue(new Error('conflict'))
    await expect(handler('git:checkout')({}, { path: '/r', branch: 'dev' })).resolves.toEqual({
      error: 'Error: conflict',
    })
    await expect(handler('git:create-branch')({}, {})).resolves.toEqual({
      error: 'VALIDATION_ERROR',
    })
    gitService.createBranch.mockRejectedValue(new Error('exists'))
    await expect(handler('git:create-branch')({}, { path: '/r', branch: 'x' })).resolves.toEqual({
      error: 'Error: exists',
    })
  })
})

describe('git:suggest-worktree-path', () => {
  it('returns the suggested path, or an empty path on invalid payload', async () => {
    gitService.suggestWorktreePath.mockReturnValue('/wt/dev')
    await expect(
      handler('git:suggest-worktree-path')({}, { repoRoot: '/r', branch: 'dev' })
    ).resolves.toEqual({ path: '/wt/dev' })
    await expect(handler('git:suggest-worktree-path')({}, { repoRoot: '/r' })).resolves.toEqual({
      path: '',
    })
  })
})

describe('git:create-worktree and git:remove-worktree', () => {
  const createPayload = { repoRoot: '/r', worktreePath: '/wt', branch: 'dev', isNewBranch: true }

  it('dispatches to the service and reports success', async () => {
    gitService.createWorktree.mockResolvedValue(undefined)
    gitService.removeWorktree.mockResolvedValue(undefined)
    await expect(handler('git:create-worktree')({}, createPayload)).resolves.toEqual({
      success: true,
    })
    expect(gitService.createWorktree).toHaveBeenCalledWith('/r', '/wt', 'dev', true)
    await expect(
      handler('git:remove-worktree')({}, { repoRoot: '/r', worktreePath: '/wt' })
    ).resolves.toEqual({ success: true })
    expect(gitService.removeWorktree).toHaveBeenCalledWith('/r', '/wt')
  })

  it('maps invalid payloads and errors to error envelopes', async () => {
    await expect(handler('git:create-worktree')({}, {})).resolves.toEqual({
      error: 'VALIDATION_ERROR',
    })
    gitService.createWorktree.mockRejectedValue(new Error('dirty'))
    await expect(handler('git:create-worktree')({}, createPayload)).resolves.toEqual({
      error: 'Error: dirty',
    })
    await expect(handler('git:remove-worktree')({}, {})).resolves.toEqual({
      error: 'VALIDATION_ERROR',
    })
    gitService.removeWorktree.mockRejectedValue(new Error('locked'))
    await expect(
      handler('git:remove-worktree')({}, { repoRoot: '/r', worktreePath: '/wt' })
    ).resolves.toEqual({ error: 'Error: locked' })
  })
})

describe('git:list-worktrees', () => {
  it('returns worktrees, and an empty list on invalid payload or error', async () => {
    gitService.listWorktrees.mockResolvedValue([{ path: '/wt' }])
    await expect(handler('git:list-worktrees')({}, { path: '/r' })).resolves.toEqual({
      worktrees: [{ path: '/wt' }],
    })
    await expect(handler('git:list-worktrees')({}, {})).resolves.toEqual({ worktrees: [] })
    gitService.listWorktrees.mockRejectedValue(new Error('io'))
    await expect(handler('git:list-worktrees')({}, { path: '/r' })).resolves.toEqual({
      worktrees: [],
    })
  })
})
