import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

const mockWebContentsSend = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ webContents: { send: mockWebContentsSend } }]),
  },
}))

vi.mock('../../../src/main/storage/workspace-store', () => ({
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  updateWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  reorderWorkspaces: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProjectBranch: vi.fn(),
  renameProject: vi.fn(),
  reorderProjects: vi.fn(),
  deleteProject: vi.fn(),
  getProjectById: vi.fn(),
}))

vi.mock('../../../src/main/git/git-service', () => ({
  removeWorktree: vi.fn(),
}))

vi.mock('../../../src/main/extensions/workspace-events', () => ({
  emitWorkspaceDelete: vi.fn(),
  emitProjectDelete: vi.fn(),
}))

import * as store from '../../../src/main/storage/workspace-store'
import * as gitService from '../../../src/main/git/git-service'
import {
  registerWorkspaceHandlers,
  setActiveWorkspaceContext,
  getActiveWorkspaceContext,
} from '../../../src/main/ipc/workspace.ipc'

function captureHandler(channel: string): (event: unknown, payload?: unknown) => unknown {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const match = calls.find(([ch]) => ch === channel)
  if (!match) throw new Error(`No handler registered for channel: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => unknown
}

describe('workspace IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerWorkspaceHandlers()
  })

  describe('workspace:list', () => {
    it('returns workspaces from store', () => {
      const workspaces = [{ id: '1', name: 'WS1' }]
      vi.mocked(store.listWorkspaces).mockReturnValue(
        workspaces as unknown as ReturnType<typeof store.listWorkspaces>
      )
      const handler = captureHandler('workspace:list')
      const result = handler({}) as { workspaces: unknown[] }
      expect(result.workspaces).toEqual(workspaces)
    })
  })

  describe('workspace:create', () => {
    it('forwards payload to createWorkspace and returns result', () => {
      const ws = { id: '2', name: 'New WS' }
      vi.mocked(store.createWorkspace).mockReturnValue({ workspace: ws } as unknown as ReturnType<
        typeof store.createWorkspace
      >)
      const handler = captureHandler('workspace:create')
      const result = handler({}, { name: 'New WS', folderPath: '/a', color: '#fff', tags: [] })
      expect(result).toEqual({ workspace: ws })
    })
  })

  describe('workspace:update', () => {
    it('forwards payload to updateWorkspace and returns result', () => {
      const ws = { id: '1', name: 'Updated' }
      vi.mocked(store.updateWorkspace).mockReturnValue({ workspace: ws } as unknown as ReturnType<
        typeof store.createWorkspace
      >)
      const handler = captureHandler('workspace:update')
      const result = handler({}, { id: '1', name: 'Updated' })
      expect(result).toEqual({ workspace: ws })
    })
  })

  describe('workspace:delete', () => {
    it('calls deleteWorkspace with the id', () => {
      vi.mocked(store.deleteWorkspace).mockReturnValue(
        undefined as unknown as ReturnType<typeof store.deleteWorkspace>
      )
      const handler = captureHandler('workspace:delete')
      handler({}, { id: 'ws-1' })
      expect(store.deleteWorkspace).toHaveBeenCalledWith('ws-1')
    })
  })

  describe('workspace:reorder', () => {
    it('calls reorderWorkspaces with payload', () => {
      vi.mocked(store.reorderWorkspaces).mockReturnValue(
        undefined as unknown as ReturnType<typeof store.deleteWorkspace>
      )
      const handler = captureHandler('workspace:reorder')
      handler({}, ['id1', 'id2'])
      expect(store.reorderWorkspaces).toHaveBeenCalledWith(['id1', 'id2'])
    })
  })

  describe('project:list', () => {
    it('returns projects for the given workspaceId', () => {
      const projects = [{ id: 'p1', workspaceId: 'ws-1' }]
      vi.mocked(store.listProjects).mockReturnValue(
        projects as unknown as ReturnType<typeof store.listProjects>
      )
      const handler = captureHandler('project:list')
      const result = handler({}, { workspaceId: 'ws-1' }) as { projects: unknown[] }
      expect(store.listProjects).toHaveBeenCalledWith('ws-1')
      expect(result.projects).toEqual(projects)
    })
  })

  describe('project:create', () => {
    it('calls createProject with payload and returns result', () => {
      const project = { id: 'p2', workspaceId: 'ws-1', name: 'MyProject' }
      vi.mocked(store.createProject).mockReturnValue({ project } as unknown as ReturnType<
        typeof store.createProject
      >)
      const handler = captureHandler('project:create')
      const result = handler({}, { workspaceId: 'ws-1', name: 'MyProject' })
      expect(result).toEqual({ project })
    })

    it('broadcasts workspace:project-added to all BrowserWindows on success', () => {
      const project = { id: 'p2', workspaceId: 'ws-1', name: 'MyProject' }
      vi.mocked(store.createProject).mockReturnValue({ project } as unknown as ReturnType<
        typeof store.createProject
      >)
      const handler = captureHandler('project:create')
      handler({}, { workspaceId: 'ws-1', name: 'MyProject' })
      expect(mockWebContentsSend).toHaveBeenCalledWith('workspace:project-added', project)
    })

    it('does not broadcast when createProject returns an error', () => {
      vi.mocked(store.createProject).mockReturnValue({
        error: 'DUPLICATE_NAME',
      } as unknown as ReturnType<typeof store.createProject>)
      const handler = captureHandler('project:create')
      handler({}, { workspaceId: 'ws-1', name: 'Dup' })
      expect(mockWebContentsSend).not.toHaveBeenCalledWith(
        'workspace:project-added',
        expect.anything()
      )
    })
  })

  describe('project:update-branch', () => {
    it('calls updateProjectBranch with payload and returns result', () => {
      const project = { id: 'p1', gitBranch: 'main' }
      vi.mocked(store.updateProjectBranch).mockReturnValue({ project } as unknown as ReturnType<
        typeof store.createProject
      >)
      const handler = captureHandler('project:update-branch')
      const result = handler({}, { id: 'p1', gitBranch: 'main' })
      expect(result).toEqual({ project })
    })
  })

  describe('project:rename', () => {
    it('calls renameProject with payload and returns result', () => {
      const project = { id: 'p1', name: 'Renamed' }
      vi.mocked(store.renameProject).mockReturnValue({ project } as unknown as ReturnType<
        typeof store.createProject
      >)
      const handler = captureHandler('project:rename')
      const result = handler({}, { id: 'p1', name: 'Renamed' })
      expect(result).toEqual({ project })
    })
  })

  describe('project:reorder', () => {
    it('calls reorderProjects with payload', () => {
      vi.mocked(store.reorderProjects).mockReturnValue(
        undefined as unknown as ReturnType<typeof store.deleteWorkspace>
      )
      const handler = captureHandler('project:reorder')
      handler({}, { workspaceId: 'ws-1', ids: ['p2', 'p1'] })
      expect(store.reorderProjects).toHaveBeenCalledWith({ workspaceId: 'ws-1', ids: ['p2', 'p1'] })
    })
  })

  describe('project:delete', () => {
    it('calls deleteProject when project is not found', async () => {
      vi.mocked(store.getProjectById).mockReturnValue(undefined)
      vi.mocked(store.deleteProject).mockReturnValue(
        undefined as unknown as ReturnType<typeof store.deleteWorkspace>
      )
      const handler = captureHandler('project:delete')
      await handler({}, { id: 'p1' })
      expect(store.deleteProject).toHaveBeenCalledWith('p1')
    })

    it('calls deleteProject when project is not a worktree', async () => {
      vi.mocked(store.getProjectById).mockReturnValue({
        id: 'p1',
        isWorktree: false,
        worktreePath: null,
      } as unknown as ReturnType<typeof store.getProjectById>)
      vi.mocked(store.deleteProject).mockReturnValue(
        undefined as unknown as ReturnType<typeof store.deleteWorkspace>
      )
      const handler = captureHandler('project:delete')
      await handler({}, { id: 'p1' })
      expect(store.deleteProject).toHaveBeenCalledWith('p1')
      expect(gitService.removeWorktree).not.toHaveBeenCalled()
    })

    it('removes worktree before deletion when project is a worktree and workspace has folderPath', async () => {
      vi.mocked(store.getProjectById).mockReturnValue({
        id: 'p1',
        isWorktree: true,
        worktreePath: '/repo/branches/feat',
        workspaceId: 'ws-1',
      } as unknown as ReturnType<typeof store.getProjectById>)
      vi.mocked(store.listWorkspaces).mockReturnValue([
        { id: 'ws-1', folderPath: '/repo' },
      ] as unknown as ReturnType<typeof store.listWorkspaces>)
      vi.mocked(store.deleteProject).mockReturnValue(
        undefined as unknown as ReturnType<typeof store.deleteWorkspace>
      )
      vi.mocked(gitService.removeWorktree).mockResolvedValue(undefined as never)
      const handler = captureHandler('project:delete')
      await handler({}, { id: 'p1' })
      expect(gitService.removeWorktree).toHaveBeenCalledWith('/repo', '/repo/branches/feat')
      expect(store.deleteProject).toHaveBeenCalledWith('p1')
    })

    it('proceeds with deletion even if worktree removal throws', async () => {
      vi.mocked(store.getProjectById).mockReturnValue({
        id: 'p1',
        isWorktree: true,
        worktreePath: '/repo/branches/feat',
        workspaceId: 'ws-1',
      } as unknown as ReturnType<typeof store.getProjectById>)
      vi.mocked(store.listWorkspaces).mockReturnValue([
        { id: 'ws-1', folderPath: '/repo' },
      ] as unknown as ReturnType<typeof store.listWorkspaces>)
      vi.mocked(store.deleteProject).mockReturnValue(
        undefined as unknown as ReturnType<typeof store.deleteWorkspace>
      )
      vi.mocked(gitService.removeWorktree).mockRejectedValue(new Error('worktree error'))
      const handler = captureHandler('project:delete')
      await handler({}, { id: 'p1' })
      expect(store.deleteProject).toHaveBeenCalledWith('p1')
    })

    it('skips worktree removal when workspace has no folderPath', async () => {
      vi.mocked(store.getProjectById).mockReturnValue({
        id: 'p1',
        isWorktree: true,
        worktreePath: '/repo/branches/feat',
        workspaceId: 'ws-1',
      } as unknown as ReturnType<typeof store.getProjectById>)
      vi.mocked(store.listWorkspaces).mockReturnValue([
        { id: 'ws-1', folderPath: undefined },
      ] as unknown as ReturnType<typeof store.listWorkspaces>)
      vi.mocked(store.deleteProject).mockReturnValue(
        undefined as unknown as ReturnType<typeof store.deleteWorkspace>
      )
      const handler = captureHandler('project:delete')
      await handler({}, { id: 'p1' })
      expect(gitService.removeWorktree).not.toHaveBeenCalled()
      expect(store.deleteProject).toHaveBeenCalledWith('p1')
    })

    it('broadcasts workspace:project-removed to all BrowserWindows after deletion', async () => {
      vi.mocked(store.getProjectById).mockReturnValue(undefined)
      vi.mocked(store.deleteProject).mockReturnValue(
        undefined as unknown as ReturnType<typeof store.deleteWorkspace>
      )
      const handler = captureHandler('project:delete')
      await handler({}, { id: 'p-del' })
      expect(mockWebContentsSend).toHaveBeenCalledWith('workspace:project-removed', { id: 'p-del' })
    })
  })

  describe('workspace:get-active', () => {
    it('returns the active context', () => {
      setActiveWorkspaceContext({ workspaceId: 'ws-1', projectId: 'p-1', repoRoot: '/repo' })
      const handler = captureHandler('workspace:get-active')
      const result = handler({})
      expect(result).toEqual({ workspaceId: 'ws-1', projectId: 'p-1', repoRoot: '/repo' })
    })
  })
})

describe('setActiveWorkspaceContext / getActiveWorkspaceContext', () => {
  it('stores and retrieves the active context', () => {
    setActiveWorkspaceContext({ workspaceId: 'ws-2', projectId: null, repoRoot: null })
    expect(getActiveWorkspaceContext()).toEqual({
      workspaceId: 'ws-2',
      projectId: null,
      repoRoot: null,
    })
  })

  it('overwrites a previous context', () => {
    setActiveWorkspaceContext({ workspaceId: 'ws-1', projectId: 'p-1', repoRoot: '/a' })
    setActiveWorkspaceContext({ workspaceId: 'ws-2', projectId: 'p-2', repoRoot: '/b' })
    expect(getActiveWorkspaceContext().workspaceId).toBe('ws-2')
  })
})
