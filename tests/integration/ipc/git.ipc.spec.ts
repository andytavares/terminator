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
})
