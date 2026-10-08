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
  fetchRemotes: vi.fn(),
  checkoutBranch: vi.fn(),
  createBranch: vi.fn(),
  suggestWorktreePath: vi.fn(),
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  listWorktrees: vi.fn(),
  getChangeStats: vi.fn(),
}))
vi.mock('../../../src/main/git/git-service.js', () => gitService)

const stores = vi.hoisted(() => ({
  getGlobalSettings: vi.fn(),
  getWorkspaceSettings: vi.fn(),
  listWorkspaces: vi.fn(),
  listProjects: vi.fn(),
}))
vi.mock('../../../src/main/storage/settings-store.js', () => ({
  getGlobalSettings: stores.getGlobalSettings,
  getWorkspaceSettings: stores.getWorkspaceSettings,
}))
vi.mock('../../../src/main/storage/workspace-store.js', () => ({
  listWorkspaces: stores.listWorkspaces,
  listProjects: stores.listProjects,
}))

import { registerGitHandlers } from '../../../src/main/ipc/git.ipc.js'

function handler(channel: string) {
  return mockHandle.mock.calls.find(([ch]) => ch === channel)![1] as (
    event: unknown,
    payload?: unknown
  ) => Promise<unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  stores.getGlobalSettings.mockReturnValue({ git: { branchExcludePatterns: [] } })
  stores.getWorkspaceSettings.mockReturnValue({})
  stores.listWorkspaces.mockReturnValue([])
  stores.listProjects.mockReturnValue([])
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
  const b = (name: string) => ({ name, isCurrent: false, isRemote: true })
  const all = [b('main'), b('gh-readonly-queue/main/pr-248-3f1a'), b('trunk-merge/pr-9'), b('dev')]

  it('hides branches matching the global exclusion patterns', async () => {
    gitService.listBranches.mockResolvedValue(all)
    stores.getGlobalSettings.mockReturnValue({
      git: { branchExcludePatterns: ['gh-readonly-queue/*', 'trunk-merge/*'] },
    })
    const r = (await handler('git:list-branches')({}, { path: '/r' })) as {
      branches: { name: string }[]
    }
    expect(r.branches.map((x) => x.name)).toEqual(['main', 'dev'])
  })

  it("uses the owning workspace's own patterns over the global ones", async () => {
    gitService.listBranches.mockResolvedValue(all)
    stores.getGlobalSettings.mockReturnValue({ git: { branchExcludePatterns: ['trunk-merge/*'] } })
    stores.listWorkspaces.mockReturnValue([
      { id: 'other', folderPath: '/elsewhere' },
      { id: 'ws', folderPath: '/repos/app' },
    ])
    stores.getWorkspaceSettings.mockImplementation((id: string) =>
      id === 'ws' ? { overrides: { git: { branchExcludePatterns: ['gh-readonly-queue/*'] } } } : {}
    )
    // A worktree inside the workspace's folder belongs to it.
    const r = (await handler('git:list-branches')({}, { path: '/repos/app/.worktrees/feat' })) as {
      branches: { name: string }[]
    }
    expect(r.branches.map((x) => x.name)).toEqual(['main', 'trunk-merge/pr-9', 'dev'])
  })

  it("finds the workspace through a project's worktree outside its folder", async () => {
    gitService.listBranches.mockResolvedValue(all)
    stores.listWorkspaces.mockReturnValue([{ id: 'ws', folderPath: '/repos/app' }])
    stores.listProjects.mockReturnValue([{ id: 'p', worktreePath: '/wt/app-feat' }])
    stores.getWorkspaceSettings.mockReturnValue({
      overrides: { git: { branchExcludePatterns: ['trunk-merge/*'] } },
    })
    const r = (await handler('git:list-branches')({}, { path: '/wt/app-feat' })) as {
      branches: { name: string }[]
    }
    expect(r.branches.map((x) => x.name)).toEqual([
      'main',
      'gh-readonly-queue/main/pr-248-3f1a',
      'dev',
    ])
  })

  it('does not take a sibling folder with the same prefix for the workspace', async () => {
    gitService.listBranches.mockResolvedValue(all)
    stores.listWorkspaces.mockReturnValue([{ id: 'ws', folderPath: '/repos/app' }])
    stores.getWorkspaceSettings.mockReturnValue({
      overrides: { git: { branchExcludePatterns: ['trunk-merge/*'] } },
    })
    const r = (await handler('git:list-branches')({}, { path: '/repos/app-two' })) as {
      branches: { name: string }[]
    }
    expect(r.branches).toHaveLength(4)
  })
})

describe('git:fetch', () => {
  it('fetches, and reports the failure rather than throwing', async () => {
    gitService.fetchRemotes.mockResolvedValue(undefined)
    await expect(handler('git:fetch')({}, { path: '/r' })).resolves.toEqual({ success: true })
    expect(gitService.fetchRemotes).toHaveBeenCalledWith('/r')
    await expect(handler('git:fetch')({}, {})).resolves.toEqual({ error: 'VALIDATION_ERROR' })
    gitService.fetchRemotes.mockRejectedValue(new Error('Could not resolve host'))
    await expect(handler('git:fetch')({}, { path: '/r' })).resolves.toEqual({
      error: 'Error: Could not resolve host',
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

describe('git:change-stats', () => {
  it('returns the service result for a valid path', async () => {
    gitService.getChangeStats.mockResolvedValue({ added: 12, removed: 3, files: 2 })
    await expect(handler('git:change-stats')({}, { path: '/repo' })).resolves.toEqual({
      added: 12,
      removed: 3,
      files: 2,
    })
    expect(gitService.getChangeStats).toHaveBeenCalledWith('/repo')
  })

  it('maps an invalid payload to an error envelope', async () => {
    await expect(handler('git:change-stats')({}, {})).resolves.toEqual({
      error: 'VALIDATION_ERROR',
    })
  })

  it('resolves with an error envelope rather than rejecting across the boundary', async () => {
    gitService.getChangeStats.mockRejectedValue(new Error('not a git repository'))
    const result = (await handler('git:change-stats')({}, { path: '/tmp' })) as {
      error: string
    }
    expect(result.error).toContain('not a git repository')
  })
})
