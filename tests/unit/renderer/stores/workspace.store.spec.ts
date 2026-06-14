import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockElectronAPI = {
  workspace: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    reorder: vi.fn(),
  },
  project: {
    list: vi.fn(),
    create: vi.fn(),
    updateBranch: vi.fn(),
    rename: vi.fn(),
    reorder: vi.fn(),
    delete: vi.fn(),
  },
}

const localStorageStore: Record<string, string> = {}
const mockLocalStorage = {
  getItem: vi.fn((k: string) => localStorageStore[k] ?? null),
  setItem: vi.fn((k: string, v: string) => {
    localStorageStore[k] = v
  }),
  removeItem: vi.fn((k: string) => {
    delete localStorageStore[k]
  }),
  clear: vi.fn(() => {
    Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k])
  }),
}

Object.defineProperty(globalThis, 'window', {
  value: { electronAPI: mockElectronAPI },
  writable: true,
})

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
})

import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'

const ws1 = {
  id: 'ws-1',
  name: 'Workspace 1',
  folderPath: '/a',
  color: '#fff',
  tags: [],
  createdAt: '',
  updatedAt: '',
}
const ws2 = {
  id: 'ws-2',
  name: 'Workspace 2',
  folderPath: '/b',
  color: '#000',
  tags: [],
  createdAt: '',
  updatedAt: '',
}
const proj1 = {
  id: 'p-1',
  workspaceId: 'ws-1',
  name: 'Project 1',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}
const proj2 = {
  id: 'p-2',
  workspaceId: 'ws-1',
  name: 'Project 2',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}

function resetStore() {
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null,
    activeProjectId: null,
    projectsByWorkspaceId: new Map(),
  })
}

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  describe('loadWorkspaces', () => {
    it('fetches and stores workspace list', async () => {
      mockElectronAPI.workspace.list.mockResolvedValue({ workspaces: [ws1, ws2] })
      await useWorkspaceStore.getState().loadWorkspaces()
      expect(useWorkspaceStore.getState().workspaces).toEqual([ws1, ws2])
    })

    it('stores empty array when result has no workspaces', async () => {
      mockElectronAPI.workspace.list.mockResolvedValue({ workspaces: null })
      await useWorkspaceStore.getState().loadWorkspaces()
      expect(useWorkspaceStore.getState().workspaces).toEqual([])
    })
  })

  describe('createWorkspace', () => {
    it('appends new workspace to list', async () => {
      useWorkspaceStore.setState({ workspaces: [ws1] })
      mockElectronAPI.workspace.create.mockResolvedValue({ workspace: ws2 })
      await useWorkspaceStore.getState().createWorkspace({ name: 'Workspace 2' })
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(2)
      expect(useWorkspaceStore.getState().workspaces[1]).toEqual(ws2)
    })

    it('returns the api result directly (including errors)', async () => {
      mockElectronAPI.workspace.create.mockResolvedValue({ error: 'DUPLICATE_NAME' })
      const result = await useWorkspaceStore.getState().createWorkspace({ name: 'Dup' })
      expect(result).toEqual({ error: 'DUPLICATE_NAME' })
    })
  })

  describe('updateWorkspace', () => {
    it('replaces workspace in list by id', async () => {
      useWorkspaceStore.setState({ workspaces: [ws1, ws2] })
      const updated = { ...ws1, name: 'Renamed' }
      mockElectronAPI.workspace.update.mockResolvedValue({ workspace: updated })
      await useWorkspaceStore.getState().updateWorkspace({ id: 'ws-1', name: 'Renamed' })
      expect(useWorkspaceStore.getState().workspaces[0].name).toBe('Renamed')
      expect(useWorkspaceStore.getState().workspaces[1]).toEqual(ws2)
    })
  })

  describe('deleteWorkspace', () => {
    it('removes workspace from list', async () => {
      useWorkspaceStore.setState({ workspaces: [ws1, ws2] })
      mockElectronAPI.workspace.delete.mockResolvedValue({})
      await useWorkspaceStore.getState().deleteWorkspace('ws-1')
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(1)
      expect(useWorkspaceStore.getState().workspaces[0].id).toBe('ws-2')
    })

    it('clears activeWorkspaceId when deleted workspace was active', async () => {
      useWorkspaceStore.setState({
        workspaces: [ws1],
        activeWorkspaceId: 'ws-1',
        activeProjectId: 'p-1',
      })
      mockElectronAPI.workspace.delete.mockResolvedValue({})
      await useWorkspaceStore.getState().deleteWorkspace('ws-1')
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull()
      expect(useWorkspaceStore.getState().activeProjectId).toBeNull()
    })

    it('does not clear activeWorkspaceId when a different workspace is deleted', async () => {
      useWorkspaceStore.setState({ workspaces: [ws1, ws2], activeWorkspaceId: 'ws-2' })
      mockElectronAPI.workspace.delete.mockResolvedValue({})
      await useWorkspaceStore.getState().deleteWorkspace('ws-1')
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2')
    })

    it('removes projects map entry for deleted workspace', async () => {
      const map = new Map([['ws-1', [proj1]]])
      useWorkspaceStore.setState({ workspaces: [ws1], projectsByWorkspaceId: map })
      mockElectronAPI.workspace.delete.mockResolvedValue({})
      await useWorkspaceStore.getState().deleteWorkspace('ws-1')
      expect(useWorkspaceStore.getState().projectsByWorkspaceId.has('ws-1')).toBe(false)
    })
  })

  describe('setActiveWorkspace', () => {
    it('sets activeWorkspaceId and clears activeProjectId', () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1', activeProjectId: 'p-1' })
      mockElectronAPI.project.list.mockResolvedValue({ projects: [] })
      useWorkspaceStore.getState().setActiveWorkspace('ws-2')
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2')
      expect(useWorkspaceStore.getState().activeProjectId).toBeNull()
    })

    it('triggers loadProjects for the new workspace', () => {
      mockElectronAPI.project.list.mockResolvedValue({ projects: [proj1] })
      useWorkspaceStore.getState().setActiveWorkspace('ws-1')
      expect(mockElectronAPI.project.list).toHaveBeenCalledWith('ws-1')
    })

    it('sets activeWorkspaceId to null when called with null', () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' })
      useWorkspaceStore.getState().setActiveWorkspace(null)
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull()
    })
  })

  describe('loadProjects', () => {
    it('stores projects under workspaceId key', async () => {
      mockElectronAPI.project.list.mockResolvedValue({ projects: [proj1, proj2] })
      await useWorkspaceStore.getState().loadProjects('ws-1')
      expect(useWorkspaceStore.getState().projectsByWorkspaceId.get('ws-1')).toEqual([proj1, proj2])
    })
  })

  describe('createProject', () => {
    it('appends project to workspace entry', async () => {
      useWorkspaceStore.setState({ projectsByWorkspaceId: new Map([['ws-1', [proj1]]]) })
      mockElectronAPI.project.create.mockResolvedValue({ project: proj2 })
      await useWorkspaceStore.getState().createProject({ workspaceId: 'ws-1', name: 'Project 2' })
      expect(useWorkspaceStore.getState().projectsByWorkspaceId.get('ws-1')).toHaveLength(2)
    })

    it('creates workspace entry if it does not exist yet', async () => {
      useWorkspaceStore.setState({ projectsByWorkspaceId: new Map() })
      mockElectronAPI.project.create.mockResolvedValue({ project: proj1 })
      await useWorkspaceStore.getState().createProject({ workspaceId: 'ws-1', name: 'Project 1' })
      expect(useWorkspaceStore.getState().projectsByWorkspaceId.get('ws-1')).toHaveLength(1)
    })
  })

  describe('updateProjectBranch', () => {
    it('updates matching project in the map', async () => {
      useWorkspaceStore.setState({ projectsByWorkspaceId: new Map([['ws-1', [proj1, proj2]]]) })
      const updated = { ...proj1, gitBranch: 'feature/x' }
      mockElectronAPI.project.updateBranch.mockResolvedValue({ project: updated })
      await useWorkspaceStore.getState().updateProjectBranch('p-1', 'feature/x')
      const projects = useWorkspaceStore.getState().projectsByWorkspaceId.get('ws-1')!
      expect(projects[0].gitBranch).toBe('feature/x')
      expect(projects[1]).toEqual(proj2)
    })
  })

  describe('renameProject', () => {
    it('renames matching project in the map', async () => {
      useWorkspaceStore.setState({ projectsByWorkspaceId: new Map([['ws-1', [proj1]]]) })
      const updated = { ...proj1, name: 'Renamed' }
      mockElectronAPI.project.rename.mockResolvedValue({ project: updated })
      await useWorkspaceStore.getState().renameProject('p-1', 'Renamed')
      const projects = useWorkspaceStore.getState().projectsByWorkspaceId.get('ws-1')!
      expect(projects[0].name).toBe('Renamed')
    })
  })

  describe('reorderWorkspaces', () => {
    it('reorders workspaces by given ids', async () => {
      useWorkspaceStore.setState({ workspaces: [ws1, ws2] })
      mockElectronAPI.workspace.reorder.mockResolvedValue({})
      await useWorkspaceStore.getState().reorderWorkspaces(['ws-2', 'ws-1'])
      expect(useWorkspaceStore.getState().workspaces[0].id).toBe('ws-2')
      expect(useWorkspaceStore.getState().workspaces[1].id).toBe('ws-1')
    })

    it('appends workspaces not in the ids list at the end', async () => {
      const ws3 = { ...ws2, id: 'ws-3', name: 'WS3' }
      useWorkspaceStore.setState({ workspaces: [ws1, ws2, ws3] })
      mockElectronAPI.workspace.reorder.mockResolvedValue({})
      await useWorkspaceStore.getState().reorderWorkspaces(['ws-2', 'ws-1'])
      const ids = useWorkspaceStore.getState().workspaces.map((w) => w.id)
      expect(ids).toEqual(['ws-2', 'ws-1', 'ws-3'])
    })
  })

  describe('reorderProjects', () => {
    it('reorders projects within the workspace', async () => {
      useWorkspaceStore.setState({ projectsByWorkspaceId: new Map([['ws-1', [proj1, proj2]]]) })
      mockElectronAPI.project.reorder.mockResolvedValue({})
      await useWorkspaceStore.getState().reorderProjects('ws-1', ['p-2', 'p-1'])
      const projects = useWorkspaceStore.getState().projectsByWorkspaceId.get('ws-1')!
      expect(projects[0].id).toBe('p-2')
      expect(projects[1].id).toBe('p-1')
    })
  })

  describe('deleteProject', () => {
    it('removes project from its workspace', async () => {
      useWorkspaceStore.setState({ projectsByWorkspaceId: new Map([['ws-1', [proj1, proj2]]]) })
      mockElectronAPI.project.delete.mockResolvedValue({})
      await useWorkspaceStore.getState().deleteProject('p-1')
      const projects = useWorkspaceStore.getState().projectsByWorkspaceId.get('ws-1')!
      expect(projects).toHaveLength(1)
      expect(projects[0].id).toBe('p-2')
    })

    it('clears activeProjectId when deleted project was active', async () => {
      useWorkspaceStore.setState({
        projectsByWorkspaceId: new Map([['ws-1', [proj1]]]),
        activeProjectId: 'p-1',
      })
      mockElectronAPI.project.delete.mockResolvedValue({})
      await useWorkspaceStore.getState().deleteProject('p-1')
      expect(useWorkspaceStore.getState().activeProjectId).toBeNull()
    })

    it('does not clear activeProjectId when a different project is deleted', async () => {
      useWorkspaceStore.setState({
        projectsByWorkspaceId: new Map([['ws-1', [proj1, proj2]]]),
        activeProjectId: 'p-2',
      })
      mockElectronAPI.project.delete.mockResolvedValue({})
      await useWorkspaceStore.getState().deleteProject('p-1')
      expect(useWorkspaceStore.getState().activeProjectId).toBe('p-2')
    })
  })

  describe('setActiveProject', () => {
    it('sets activeProjectId', () => {
      useWorkspaceStore.getState().setActiveProject('p-1')
      expect(useWorkspaceStore.getState().activeProjectId).toBe('p-1')
    })

    it('sets activeProjectId to null', () => {
      useWorkspaceStore.setState({ activeProjectId: 'p-1' })
      useWorkspaceStore.getState().setActiveProject(null)
      expect(useWorkspaceStore.getState().activeProjectId).toBeNull()
    })
  })

  describe('resolveActiveCwd', () => {
    beforeEach(() => {
      useWorkspaceStore.setState({
        workspaces: [ws1, ws2],
        projectsByWorkspaceId: new Map([
          ['ws-1', [proj1, { ...proj1, id: 'p-wt', worktreePath: '/worktree/path' }]],
        ]),
        activeWorkspaceId: 'ws-1',
        activeProjectId: null,
      })
    })

    it('returns worktreePath when active project has one', () => {
      useWorkspaceStore.setState({ activeProjectId: 'p-wt' })
      expect(useWorkspaceStore.getState().resolveActiveCwd()).toBe('/worktree/path')
    })

    it('returns workspace folderPath when active project has no worktreePath', () => {
      useWorkspaceStore.setState({ activeProjectId: 'p-1' })
      expect(useWorkspaceStore.getState().resolveActiveCwd()).toBe('/a')
    })

    it("returns '~' when no workspace or project is active", () => {
      useWorkspaceStore.setState({ activeWorkspaceId: null, activeProjectId: null })
      expect(useWorkspaceStore.getState().resolveActiveCwd()).toBe('~')
    })
  })

  describe('expandedWorkspaceIds', () => {
    const storageKey = 'terminator.workspace.expanded'

    beforeEach(() => {
      localStorage.clear()
      useWorkspaceStore.setState({ expandedWorkspaceIds: new Set() })
    })

    it('initializes as empty set when localStorage has no entry', () => {
      expect(useWorkspaceStore.getState().expandedWorkspaceIds.size).toBe(0)
    })

    it('toggleWorkspaceCollapse adds an ID that is not present', () => {
      useWorkspaceStore.getState().toggleWorkspaceCollapse('ws-1')
      expect(useWorkspaceStore.getState().expandedWorkspaceIds.has('ws-1')).toBe(true)
    })

    it('toggleWorkspaceCollapse removes an ID that is already present', () => {
      useWorkspaceStore.setState({ expandedWorkspaceIds: new Set(['ws-1']) })
      useWorkspaceStore.getState().toggleWorkspaceCollapse('ws-1')
      expect(useWorkspaceStore.getState().expandedWorkspaceIds.has('ws-1')).toBe(false)
    })

    it('writes collapsed IDs to localStorage on toggle', () => {
      useWorkspaceStore.getState().toggleWorkspaceCollapse('ws-1')
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]
      expect(stored).toContain('ws-1')
    })

    it('removes ID from localStorage when toggled off', () => {
      useWorkspaceStore.setState({ expandedWorkspaceIds: new Set(['ws-1']) })
      useWorkspaceStore.getState().toggleWorkspaceCollapse('ws-1')
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? '["ws-1"]') as string[]
      expect(stored).not.toContain('ws-1')
    })

    it('survives a localStorage.setItem failure in toggleWorkspaceCollapse', () => {
      mockLocalStorage.setItem.mockImplementationOnce(() => {
        throw new Error('QuotaExceededError')
      })
      expect(() => useWorkspaceStore.getState().toggleWorkspaceCollapse('ws-1')).not.toThrow()
      expect(useWorkspaceStore.getState().expandedWorkspaceIds.has('ws-1')).toBe(true)
    })

    it('setExpandedWorkspaceIds updates the store and writes to localStorage', () => {
      useWorkspaceStore.getState().setExpandedWorkspaceIds(new Set(['ws-1', 'ws-2']))
      expect(useWorkspaceStore.getState().expandedWorkspaceIds.has('ws-1')).toBe(true)
      expect(useWorkspaceStore.getState().expandedWorkspaceIds.has('ws-2')).toBe(true)
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[]
      expect(stored).toContain('ws-1')
      expect(stored).toContain('ws-2')
    })

    it('setExpandedWorkspaceIds survives a localStorage.setItem failure', () => {
      mockLocalStorage.setItem.mockImplementationOnce(() => {
        throw new Error('QuotaExceededError')
      })
      expect(() =>
        useWorkspaceStore.getState().setExpandedWorkspaceIds(new Set(['ws-1']))
      ).not.toThrow()
      expect(useWorkspaceStore.getState().expandedWorkspaceIds.has('ws-1')).toBe(true)
    })
  })
})
