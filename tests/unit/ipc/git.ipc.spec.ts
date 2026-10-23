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

const log = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('../../../src/main/logger.js', () => ({ logger: log }))

vi.mock('electron-store', async () =>
  (await import('../../support/stores')).inMemoryElectronStore()
)

let workspaceStore: typeof import('../../../src/main/storage/workspace-store.js')
let settingsStore: typeof import('../../../src/main/storage/settings-store.js')

function handler(channel: string) {
  return mockHandle.mock.calls.find(([ch]) => ch === channel)![1] as (
    event: unknown,
    payload?: unknown
  ) => Promise<unknown>
}

/** A workspace at `folderPath`, with its own exclusion patterns when given. */
function workspaceAt(folderPath: string, branchExcludePatterns?: string[]): string {
  const created = workspaceStore.createWorkspace({
    name: folderPath,
    folderPath,
    color: '#4A90E2',
    tags: [],
  })
  if (!('workspace' in created)) throw new Error(`could not create ${folderPath}`)
  if (branchExcludePatterns) {
    settingsStore.updateWorkspaceSettings(created.workspace.id, { git: { branchExcludePatterns } })
  }
  return created.workspace.id
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  workspaceStore = await import('../../../src/main/storage/workspace-store.js')
  settingsStore = await import('../../../src/main/storage/settings-store.js')
  const { registerGitHandlers } = await import('../../../src/main/ipc/git.ipc.js')
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

  it('returns isRepo false when git said the path is not a repository', async () => {
    gitService.isGitRepo.mockResolvedValue(false)
    await expect(handler('git:is-repo')({}, { path: '/x' })).resolves.toEqual({ isRepo: false })
  })

  it('returns an error, not isRepo false, when git could not answer', async () => {
    gitService.isGitRepo.mockRejectedValue(new Error('git rev-parse timed out'))
    await expect(handler('git:is-repo')({}, { path: '/x' })).resolves.toEqual({
      error: 'Error: git rev-parse timed out',
    })
  })

  // The dialog says only "Could not read the git repository"; the log is where git's own words go.
  it("writes git's own error and the folder to the log when git could not answer", async () => {
    gitService.isGitRepo.mockRejectedValue(new Error('fatal: not a git repository'))
    await handler('git:is-repo')({}, { path: '/x' })
    expect(log.warn).toHaveBeenCalledWith(
      'git could not answer git:is-repo for /x: Error: fatal: not a git repository'
    )
  })
})

describe('git:current-branch', () => {
  it('returns the branch', async () => {
    gitService.getCurrentBranch.mockResolvedValue('main')
    await expect(handler('git:current-branch')({}, { path: '/r' })).resolves.toEqual({
      branch: 'main',
    })
  })

  it('maps errors to an error envelope', async () => {
    gitService.getCurrentBranch.mockRejectedValue(new Error('detached'))
    await expect(handler('git:current-branch')({}, { path: '/r' })).resolves.toEqual({
      error: 'Error: detached',
    })
  })

  it("writes git's own error and the folder to the log", async () => {
    gitService.getCurrentBranch.mockRejectedValue(new Error('detached'))
    await handler('git:current-branch')({}, { path: '/r' })
    expect(log.warn).toHaveBeenCalledWith(
      'git could not answer git:current-branch for /r: Error: detached'
    )
  })
})

const b = (name: string) => ({ name, isCurrent: false, isRemote: true })
const all = [b('main'), b('gh-readonly-queue/main/pr-248-3f1a'), b('trunk-merge/pr-9'), b('dev')]

describe('git:list-branches', () => {
  it('returns branches, and an empty list on error', async () => {
    gitService.listBranches.mockResolvedValue(['main', 'dev'])
    await expect(handler('git:list-branches')({}, { path: '/r' })).resolves.toEqual({
      branches: ['main', 'dev'],
    })
    gitService.listBranches.mockRejectedValue(new Error('io'))
    await expect(handler('git:list-branches')({}, { path: '/r' })).resolves.toEqual({
      branches: [],
    })
  })
})

describe('git:list-branches — exclusion patterns', () => {
  it('hides branches matching the global exclusion patterns', async () => {
    gitService.listBranches.mockResolvedValue(all)
    settingsStore.updateGlobalSettings({
      git: { branchExcludePatterns: ['gh-readonly-queue/*', 'trunk-merge/*'] },
    })
    const r = (await handler('git:list-branches')({}, { path: '/r' })) as {
      branches: { name: string }[]
    }
    expect(r.branches.map((x) => x.name)).toEqual(['main', 'dev'])
  })

  it("uses the owning workspace's own patterns over the global ones", async () => {
    gitService.listBranches.mockResolvedValue(all)
    settingsStore.updateGlobalSettings({ git: { branchExcludePatterns: ['trunk-merge/*'] } })
    workspaceAt('/elsewhere', ['dev'])
    workspaceAt('/repos/app', ['gh-readonly-queue/*'])
    // A worktree inside the workspace's folder belongs to it.
    const r = (await handler('git:list-branches')({}, { path: '/repos/app/.worktrees/feat' })) as {
      branches: { name: string }[]
    }
    expect(r.branches.map((x) => x.name)).toEqual(['main', 'trunk-merge/pr-9', 'dev'])
  })
})

describe("git:list-branches — which workspace's patterns", () => {
  it("finds the workspace through a project's worktree outside its folder", async () => {
    gitService.listBranches.mockResolvedValue(all)
    const workspaceId = workspaceAt('/repos/app', ['trunk-merge/*'])
    workspaceStore.createProject({
      workspaceId,
      name: 'feat',
      worktreePath: '/wt/app-feat',
      isWorktree: true,
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
    workspaceAt('/repos/app', ['trunk-merge/*'])
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

  it('maps errors to error envelopes', async () => {
    gitService.checkoutBranch.mockRejectedValue(new Error('conflict'))
    await expect(handler('git:checkout')({}, { path: '/r', branch: 'dev' })).resolves.toEqual({
      error: 'Error: conflict',
    })
    gitService.createBranch.mockRejectedValue(new Error('exists'))
    await expect(handler('git:create-branch')({}, { path: '/r', branch: 'x' })).resolves.toEqual({
      error: 'Error: exists',
    })
  })
})

describe('git:suggest-worktree-path', () => {
  it('returns the suggested path', async () => {
    gitService.suggestWorktreePath.mockReturnValue('/wt/dev')
    await expect(
      handler('git:suggest-worktree-path')({}, { repoRoot: '/r', branch: 'dev' })
    ).resolves.toEqual({ path: '/wt/dev' })
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
    expect(gitService.createWorktree).toHaveBeenCalledWith({
      repoRoot: '/r',
      worktreePath: '/wt',
      branch: 'dev',
      isNewBranch: true,
    })
    await expect(
      handler('git:remove-worktree')({}, { repoRoot: '/r', worktreePath: '/wt' })
    ).resolves.toEqual({ success: true })
    expect(gitService.removeWorktree).toHaveBeenCalledWith('/r', '/wt')
  })

  it('maps errors to error envelopes', async () => {
    gitService.createWorktree.mockRejectedValue(new Error('dirty'))
    await expect(handler('git:create-worktree')({}, createPayload)).resolves.toEqual({
      error: 'Error: dirty',
    })
    gitService.removeWorktree.mockRejectedValue(new Error('locked'))
    await expect(
      handler('git:remove-worktree')({}, { repoRoot: '/r', worktreePath: '/wt' })
    ).resolves.toEqual({ error: 'Error: locked' })
  })
})

describe('git:list-worktrees', () => {
  it('returns worktrees, and an empty list on error', async () => {
    gitService.listWorktrees.mockResolvedValue([{ path: '/wt' }])
    await expect(handler('git:list-worktrees')({}, { path: '/r' })).resolves.toEqual({
      worktrees: [{ path: '/wt' }],
    })
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

  it('resolves with an error envelope rather than rejecting across the boundary', async () => {
    gitService.getChangeStats.mockRejectedValue(new Error('not a git repository'))
    const result = (await handler('git:change-stats')({}, { path: '/tmp' })) as {
      error: string
    }
    expect(result.error).toContain('not a git repository')
  })
})
