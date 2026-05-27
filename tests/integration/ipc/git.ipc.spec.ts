import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

vi.mock('../../../src/main/git/git-service', () => ({
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

import * as gitService from '../../../src/main/git/git-service'
import { registerGitHandlers } from '../../../src/main/ipc/git.ipc'

// git:status, git:diff-file, git:stage, git:unstage, git:commit are registered by the
// git-integration extension via api.ipc.registerHandler(). Tests for those live in
// tests/integration/ipc/git-extension.ipc.spec.ts

type Handler = (event: unknown, payload: unknown) => Promise<unknown>

function getHandler(channel: string): Handler {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const found = calls.find(([c]) => c === channel)
  if (!found) throw new Error(`Handler for "${channel}" not registered`)
  return found[1] as Handler
}

describe('core git IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerGitHandlers()
  })

  it('git:is-repo returns true for a git repo', async () => {
    vi.mocked(gitService.isGitRepo).mockResolvedValue(true)
    vi.mocked(gitService.getGitRoot).mockResolvedValue('/tmp/repo')
    const handler = getHandler('git:is-repo')
    const result = await handler({}, { path: '/tmp/repo' })
    expect(result).toMatchObject({ isRepo: true, root: '/tmp/repo' })
  })

  it('git:is-repo returns false for a non-repo path', async () => {
    vi.mocked(gitService.isGitRepo).mockResolvedValue(false)
    const handler = getHandler('git:is-repo')
    const result = await handler({}, { path: '/tmp/not-repo' })
    expect(result).toMatchObject({ isRepo: false })
  })

  it('git:current-branch returns the current branch', async () => {
    vi.mocked(gitService.getCurrentBranch).mockResolvedValue('feature/my-branch')
    const handler = getHandler('git:current-branch')
    const result = await handler({}, { path: '/tmp/repo' })
    expect(result).toMatchObject({ branch: 'feature/my-branch' })
  })

  it('git:checkout switches to branch', async () => {
    vi.mocked(gitService.checkoutBranch).mockResolvedValue(undefined)
    const handler = getHandler('git:checkout')
    const result = await handler({}, { path: '/tmp/repo', branch: 'main' })
    expect(result).toMatchObject({ success: true })
  })

  it('git:is-repo returns false for invalid payload', async () => {
    const handler = getHandler('git:is-repo')
    const result = await handler({}, {})
    expect(result).toMatchObject({ isRepo: false })
  })

  it('git:is-repo returns false when service throws', async () => {
    vi.mocked(gitService.isGitRepo).mockRejectedValue(new Error('no git'))
    const handler = getHandler('git:is-repo')
    const result = await handler({}, { path: '/tmp/repo' })
    expect(result).toMatchObject({ isRepo: false })
  })

  it('git:current-branch returns INVALID_PATH for empty path', async () => {
    const handler = getHandler('git:current-branch')
    const result = await handler({}, { path: '' })
    expect(result).toMatchObject({ error: 'INVALID_PATH' })
  })

  it('git:current-branch returns error string when service throws', async () => {
    vi.mocked(gitService.getCurrentBranch).mockRejectedValue(new Error('detached HEAD'))
    const handler = getHandler('git:current-branch')
    const result = (await handler({}, { path: '/tmp/repo' })) as { error: string }
    expect(result.error).toContain('detached HEAD')
  })

  it('git:list-branches returns empty array for invalid payload', async () => {
    const handler = getHandler('git:list-branches')
    const result = await handler({}, {})
    expect(result).toMatchObject({ branches: [] })
  })

  it('git:list-branches returns branches on success', async () => {
    vi.mocked(gitService.listBranches).mockResolvedValue(['main', 'feature'])
    const handler = getHandler('git:list-branches')
    const result = await handler({}, { path: '/tmp/repo' })
    expect(result).toMatchObject({ branches: ['main', 'feature'] })
  })

  it('git:list-branches returns empty array when service throws', async () => {
    vi.mocked(gitService.listBranches).mockRejectedValue(new Error('fail'))
    const handler = getHandler('git:list-branches')
    const result = await handler({}, { path: '/tmp/repo' })
    expect(result).toMatchObject({ branches: [] })
  })

  it('git:checkout returns VALIDATION_ERROR for missing branch', async () => {
    const handler = getHandler('git:checkout')
    const result = await handler({}, { path: '/tmp/repo' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('git:checkout returns error string when checkout fails', async () => {
    vi.mocked(gitService.checkoutBranch).mockRejectedValue(new Error('conflict'))
    const handler = getHandler('git:checkout')
    const result = (await handler({}, { path: '/tmp/repo', branch: 'feature' })) as {
      error: string
    }
    expect(result.error).toContain('conflict')
  })

  it('git:create-branch returns VALIDATION_ERROR for missing branch', async () => {
    const handler = getHandler('git:create-branch')
    const result = await handler({}, { path: '/tmp/repo' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('git:create-branch returns success', async () => {
    vi.mocked(gitService.createBranch).mockResolvedValue(undefined)
    const handler = getHandler('git:create-branch')
    const result = await handler({}, { path: '/tmp/repo', branch: 'feature/new' })
    expect(result).toMatchObject({ success: true })
    expect(gitService.createBranch).toHaveBeenCalledWith('/tmp/repo', 'feature/new')
  })

  it('git:create-branch returns error string on failure', async () => {
    vi.mocked(gitService.createBranch).mockRejectedValue(new Error('branch already exists'))
    const handler = getHandler('git:create-branch')
    const result = (await handler({}, { path: '/tmp/repo', branch: 'feature/new' })) as {
      error: string
    }
    expect(result.error).toContain('branch already exists')
  })

  it('git:suggest-worktree-path returns empty path for invalid payload', async () => {
    const handler = getHandler('git:suggest-worktree-path')
    const result = await handler({}, {})
    expect(result).toMatchObject({ path: '' })
  })

  it('git:suggest-worktree-path returns suggested path', async () => {
    vi.mocked(gitService.suggestWorktreePath).mockReturnValue('/repo-feature')
    const handler = getHandler('git:suggest-worktree-path')
    const result = await handler({}, { repoRoot: '/repo', branch: 'feature' })
    expect(result).toMatchObject({ path: '/repo-feature' })
  })

  it('git:suggest-worktree-path passes optional baseDir', async () => {
    vi.mocked(gitService.suggestWorktreePath).mockReturnValue('/base/feature')
    const handler = getHandler('git:suggest-worktree-path')
    await handler({}, { repoRoot: '/repo', branch: 'feature', baseDir: '/base' })
    expect(gitService.suggestWorktreePath).toHaveBeenCalledWith('/repo', 'feature', '/base')
  })

  it('git:create-worktree returns VALIDATION_ERROR for invalid payload', async () => {
    const handler = getHandler('git:create-worktree')
    const result = await handler({}, { repoRoot: '/repo' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('git:create-worktree returns success', async () => {
    vi.mocked(gitService.createWorktree).mockResolvedValue(undefined)
    const handler = getHandler('git:create-worktree')
    const result = await handler(
      {},
      {
        repoRoot: '/repo',
        worktreePath: '/wt',
        branch: 'feature',
        isNewBranch: true,
      }
    )
    expect(result).toMatchObject({ success: true })
  })

  it('git:create-worktree returns error string on failure', async () => {
    vi.mocked(gitService.createWorktree).mockRejectedValue(new Error('branch exists'))
    const handler = getHandler('git:create-worktree')
    const result = (await handler(
      {},
      {
        repoRoot: '/repo',
        worktreePath: '/wt',
        branch: 'feature',
        isNewBranch: false,
      }
    )) as { error: string }
    expect(result.error).toContain('branch exists')
  })

  it('git:remove-worktree returns VALIDATION_ERROR for invalid payload', async () => {
    const handler = getHandler('git:remove-worktree')
    const result = await handler({}, { repoRoot: '/repo' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('git:remove-worktree returns success', async () => {
    vi.mocked(gitService.removeWorktree).mockResolvedValue(undefined)
    const handler = getHandler('git:remove-worktree')
    const result = await handler({}, { repoRoot: '/repo', worktreePath: '/wt' })
    expect(result).toMatchObject({ success: true })
  })

  it('git:remove-worktree returns error string on failure', async () => {
    vi.mocked(gitService.removeWorktree).mockRejectedValue(new Error('not found'))
    const handler = getHandler('git:remove-worktree')
    const result = (await handler({}, { repoRoot: '/repo', worktreePath: '/wt' })) as {
      error: string
    }
    expect(result.error).toContain('not found')
  })

  it('git:list-worktrees returns empty array for invalid payload', async () => {
    const handler = getHandler('git:list-worktrees')
    const result = await handler({}, {})
    expect(result).toMatchObject({ worktrees: [] })
  })

  it('git:list-worktrees returns worktrees on success', async () => {
    const trees = [{ path: '/wt', branch: 'feature', isMain: false }]
    vi.mocked(gitService.listWorktrees).mockResolvedValue(
      trees as unknown as Awaited<ReturnType<typeof gitService.listWorktrees>>
    )
    const handler = getHandler('git:list-worktrees')
    const result = await handler({}, { path: '/repo' })
    expect(result).toMatchObject({ worktrees: trees })
  })

  it('git:list-worktrees returns empty array when service throws', async () => {
    vi.mocked(gitService.listWorktrees).mockRejectedValue(new Error('fail'))
    const handler = getHandler('git:list-worktrees')
    const result = await handler({}, { path: '/repo' })
    expect(result).toMatchObject({ worktrees: [] })
  })
})
