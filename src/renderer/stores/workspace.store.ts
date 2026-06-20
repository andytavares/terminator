import { create } from 'zustand'
import type { Workspace, Project } from '../../shared/types/index'

interface WorkspaceState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  activeProjectId: string | null
  projectsByWorkspaceId: Map<string, Project[]>
  expandedWorkspaceIds: Set<string>

  loadWorkspaces: () => Promise<void>
  createWorkspace: (input: unknown) => Promise<{ workspace: Workspace } | { error: string }>
  updateWorkspace: (input: unknown) => Promise<{ workspace: Workspace } | { error: string }>
  deleteWorkspace: (id: string) => Promise<void>
  setActiveWorkspace: (id: string | null) => void

  loadProjects: (workspaceId: string) => Promise<void>
  createProject: (input: unknown) => Promise<{ project: Project } | { error: string }>
  updateProjectBranch: (
    id: string,
    gitBranch: string
  ) => Promise<{ project: Project } | { error: string }>
  renameProject: (id: string, name: string) => Promise<{ project: Project } | { error: string }>
  reorderWorkspaces: (ids: string[]) => Promise<void>
  reorderProjects: (workspaceId: string, ids: string[]) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setActiveProject: (id: string | null) => void
  resolveActiveCwd: () => string
  toggleWorkspaceCollapse: (id: string) => void
  setExpandedWorkspaceIds: (ids: Set<string>) => void
  scratchActive: boolean
  setScratchActive: (value: boolean) => void
}

function loadExpandedIds(): Set<string> {
  try {
    const raw = localStorage.getItem('terminator.workspace.expanded')
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return new Set(parsed as string[])
    }
  } catch {
    // corrupted localStorage — return empty set (all collapsed)
  }
  return new Set()
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  activeProjectId: null,
  projectsByWorkspaceId: new Map(),
  expandedWorkspaceIds: loadExpandedIds(),
  scratchActive: false,
  setScratchActive: (value) =>
    set(
      value
        ? { scratchActive: true, activeWorkspaceId: null, activeProjectId: null }
        : { scratchActive: false }
    ),

  loadWorkspaces: async () => {
    const result = await window.electronAPI.workspace.list()
    set({ workspaces: result.workspaces ?? [] })
  },

  createWorkspace: async (input) => {
    const result = await window.electronAPI.workspace.create(input)
    if ('workspace' in result) {
      set((s) => ({ workspaces: [...s.workspaces, result.workspace] }))
    }
    return result
  },

  updateWorkspace: async (input) => {
    const result = await window.electronAPI.workspace.update(input)
    if ('workspace' in result) {
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === result.workspace.id ? result.workspace : w)),
      }))
    }
    return result
  },

  deleteWorkspace: async (id) => {
    await window.electronAPI.workspace.delete(id)
    set((s) => {
      const map = new Map(s.projectsByWorkspaceId)
      map.delete(id)
      return {
        workspaces: s.workspaces.filter((w) => w.id !== id),
        projectsByWorkspaceId: map,
        activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
        activeProjectId: s.activeWorkspaceId === id ? null : s.activeProjectId,
      }
    })
  },

  setActiveWorkspace: (id) => {
    set({ activeWorkspaceId: id, activeProjectId: null })
    if (id) get().loadProjects(id)
  },

  loadProjects: async (workspaceId) => {
    const result = await window.electronAPI.project.list(workspaceId)
    set((s) => {
      const map = new Map(s.projectsByWorkspaceId)
      map.set(workspaceId, result.projects ?? [])
      return { projectsByWorkspaceId: map }
    })
  },

  createProject: async (input) => {
    const result = await window.electronAPI.project.create(input)
    if ('project' in result) {
      const project = result.project
      set((s) => {
        const map = new Map(s.projectsByWorkspaceId)
        const existing = map.get(project.workspaceId) ?? []
        map.set(project.workspaceId, [...existing, project])
        return { projectsByWorkspaceId: map }
      })
    }
    return result
  },

  updateProjectBranch: async (id, gitBranch) => {
    const result = await window.electronAPI.project.updateBranch(id, gitBranch)
    if ('project' in result) {
      const project = result.project
      set((s) => {
        const map = new Map(s.projectsByWorkspaceId)
        for (const [wsId, projects] of map) {
          if (projects.some((p) => p.id === id)) {
            map.set(
              wsId,
              projects.map((p) => (p.id === id ? project : p))
            )
            break
          }
        }
        return { projectsByWorkspaceId: map }
      })
    }
    return result
  },

  renameProject: async (id, name) => {
    const result = await window.electronAPI.project.rename(id, name)
    if ('project' in result) {
      const project = result.project
      set((s) => {
        const map = new Map(s.projectsByWorkspaceId)
        for (const [wsId, projects] of map) {
          if (projects.some((p) => p.id === id)) {
            map.set(
              wsId,
              projects.map((p) => (p.id === id ? project : p))
            )
            break
          }
        }
        return { projectsByWorkspaceId: map }
      })
    }
    return result
  },

  reorderWorkspaces: async (ids) => {
    set((s) => {
      const map = new Map(s.workspaces.map((w) => [w.id, w]))
      const reordered = ids.flatMap((id) => (map.get(id) ? [map.get(id)!] : []))
      const missing = s.workspaces.filter((w) => !ids.includes(w.id))
      return { workspaces: [...reordered, ...missing] }
    })
    await window.electronAPI.workspace.reorder(ids)
  },

  reorderProjects: async (workspaceId, ids) => {
    set((s) => {
      const map = new Map(s.projectsByWorkspaceId)
      const existing = map.get(workspaceId) ?? []
      const projectMap = new Map(existing.map((p) => [p.id, p]))
      const reordered = ids.flatMap((id) => (projectMap.get(id) ? [projectMap.get(id)!] : []))
      const missing = existing.filter((p) => !ids.includes(p.id))
      map.set(workspaceId, [...reordered, ...missing])
      return { projectsByWorkspaceId: map }
    })
    await window.electronAPI.project.reorder(workspaceId, ids)
  },

  deleteProject: async (id) => {
    await window.electronAPI.project.delete(id)
    set((s) => {
      const map = new Map(s.projectsByWorkspaceId)
      for (const [wsId, projects] of map) {
        map.set(
          wsId,
          projects.filter((p) => p.id !== id)
        )
      }
      return {
        projectsByWorkspaceId: map,
        activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
      }
    })
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  toggleWorkspaceCollapse: (id) => {
    const current = get().expandedWorkspaceIds
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    try {
      localStorage.setItem('terminator.workspace.expanded', JSON.stringify([...next]))
    } catch {
      // ignore write failures (private browsing, storage full)
    }
    set({ expandedWorkspaceIds: next })
  },

  setExpandedWorkspaceIds: (ids) => {
    try {
      localStorage.setItem('terminator.workspace.expanded', JSON.stringify([...ids]))
    } catch {
      // ignore write failures
    }
    set({ expandedWorkspaceIds: ids })
  },

  resolveActiveCwd: () => {
    const { activeWorkspaceId, activeProjectId, workspaces, projectsByWorkspaceId } = get()
    const workspace = workspaces.find((w) => w.id === activeWorkspaceId)
    const projects = activeWorkspaceId ? (projectsByWorkspaceId.get(activeWorkspaceId) ?? []) : []
    const project = projects.find((p) => p.id === activeProjectId)
    return project?.worktreePath ?? workspace?.folderPath ?? '~'
  },
}))
