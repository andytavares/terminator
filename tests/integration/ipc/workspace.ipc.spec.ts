import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
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

import * as store from '../../../src/main/storage/workspace-store'
import { registerWorkspaceHandlers } from '../../../src/main/ipc/workspace.ipc'

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
      const project = { id: 'p2', name: 'MyProject' }
      vi.mocked(store.createProject).mockReturnValue({ project } as unknown as ReturnType<
        typeof store.createProject
      >)
      const handler = captureHandler('project:create')
      const result = handler({}, { workspaceId: 'ws-1', name: 'MyProject' })
      expect(result).toEqual({ project })
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
    it('calls deleteProject with the id', async () => {
      vi.mocked(store.getProjectById).mockReturnValue(undefined)
      vi.mocked(store.deleteProject).mockReturnValue(
        undefined as unknown as ReturnType<typeof store.deleteWorkspace>
      )
      const handler = captureHandler('project:delete')
      await handler({}, { id: 'p1' })
      expect(store.deleteProject).toHaveBeenCalledWith('p1')
    })
  })
})
