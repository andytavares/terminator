import { create, type StoreApi } from 'zustand'
import type { Workspace, Project } from '../../shared/types/index'
import { readStoredJson, writeStoredJson } from '../home/local-storage'
import { useSessionStore } from './session.store'
import { useToastStore } from './toast.store'

interface WorkspaceState {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  activeProjectId: string | null
  projectsByWorkspaceId: Map<string, Project[]>
  expandedWorkspaceIds: Set<string>
  collapsedProjectIds: Set<string>

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
  toggleProjectCollapse: (id: string) => void
  ensureProjectExpanded: (id: string) => void
  scratchActive: boolean
  setScratchActive: (value: boolean) => void
}

const EXPANDED_KEY = 'terminator.workspace.expanded'
const COLLAPSED_KEY = 'terminator.project.collapsed'

/** The ids saved under `key`; none when nothing is saved or what is there is corrupt. */
function loadIds(key: string): Set<string> {
  return readStoredJson(key, new Set<string>(), (value) =>
    Array.isArray(value) ? new Set(value as string[]) : null
  )
}

function saveIds(key: string, ids: Set<string>): void {
  writeStoredJson(key, [...ids])
}

/** `ids` with `id` added when it was absent, removed when it was present. */
function toggledId(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** The state with `project` listed under its workspace, unless it already is. */
function withProjectAdded(
  s: WorkspaceState,
  project: Project
): WorkspaceState | Pick<WorkspaceState, 'projectsByWorkspaceId'> {
  const map = new Map(s.projectsByWorkspaceId)
  const existing = map.get(project.workspaceId) ?? []
  if (existing.some((p) => p.id === project.id)) return s
  map.set(project.workspaceId, [...existing, project])
  return { projectsByWorkspaceId: map }
}

/** The state without the project, which is no longer active if it was. */
function withProjectRemoved(
  s: WorkspaceState,
  id: string
): Pick<WorkspaceState, 'projectsByWorkspaceId' | 'activeProjectId'> {
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
}

/** The state with the project of the same id swapped for `project`. */
function withProjectReplaced(
  s: WorkspaceState,
  project: Project
): Pick<WorkspaceState, 'projectsByWorkspaceId'> {
  const map = new Map(s.projectsByWorkspaceId)
  for (const [workspaceId, projects] of map) {
    if (projects.some((p) => p.id === project.id)) {
      map.set(
        workspaceId,
        projects.map((p) => (p.id === project.id ? project : p))
      )
      break
    }
  }
  return { projectsByWorkspaceId: map }
}

type SetWorkspaces = StoreApi<WorkspaceState>['setState']
type GetWorkspaces = StoreApi<WorkspaceState>['getState']
type Slice<Keys extends keyof WorkspaceState> = Pick<WorkspaceState, Keys>
type ProjectResult = { project: Project } | { error: string }

/** Keeps a project main answered with, through `apply`; an error leaves the state alone. */
function keepProject(
  set: SetWorkspaces,
  result: ProjectResult,
  apply: (s: WorkspaceState, project: Project) => Partial<WorkspaceState>
): ProjectResult {
  if ('project' in result) {
    const project = result.project
    set((s) => apply(s, project))
  }
  return result
}

function withoutWorkspace(s: WorkspaceState, id: string): Partial<WorkspaceState> {
  const map = new Map(s.projectsByWorkspaceId)
  map.delete(id)
  return {
    workspaces: s.workspaces.filter((w) => w.id !== id),
    projectsByWorkspaceId: map,
    activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
    activeProjectId: s.activeWorkspaceId === id ? null : s.activeProjectId,
  }
}

/** `items` in the order `ids` gives, then any it leaves out, in their old order. */
function inOrder<Item extends { id: string }>(items: Item[], ids: string[]): Item[] {
  const byId = new Map(items.map((item) => [item.id, item]))
  const reordered = ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []))
  const missing = items.filter((item) => !ids.includes(item.id))
  return [...reordered, ...missing]
}

function withProjectsOrdered(
  s: WorkspaceState,
  workspaceId: string,
  ids: string[]
): Partial<WorkspaceState> {
  const map = new Map(s.projectsByWorkspaceId)
  map.set(workspaceId, inOrder(map.get(workspaceId) ?? [], ids))
  return { projectsByWorkspaceId: map }
}

function withProjectsLoaded(
  s: WorkspaceState,
  workspaceId: string,
  projects: Project[]
): Partial<WorkspaceState> {
  const map = new Map(s.projectsByWorkspaceId)
  map.set(workspaceId, projects)
  return { projectsByWorkspaceId: map }
}

type WorkspaceResult = Awaited<ReturnType<WorkspaceState['createWorkspace']>>

async function saveNewWorkspace(set: SetWorkspaces, input: unknown): Promise<WorkspaceResult> {
  const result = await window.electronAPI.workspace.create(input)
  if ('workspace' in result) set((s) => ({ workspaces: [...s.workspaces, result.workspace] }))
  return result
}

async function saveWorkspaceEdit(set: SetWorkspaces, input: unknown): Promise<WorkspaceResult> {
  const result = await window.electronAPI.workspace.update(input)
  if ('workspace' in result) {
    const updated = result.workspace
    set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === updated.id ? updated : w)) }))
  }
  return result
}

async function removeWorkspace(set: SetWorkspaces, id: string): Promise<void> {
  const result = await window.electronAPI.workspace.delete(id)
  if (result.worktreesKept?.length) {
    const folders = result.worktreesKept.map((kept) => kept.path).join('\n')
    useToastStore.getState().addToast({
      type: 'warning',
      message: `Workspace removed, folders kept. git could not remove:\n${folders}. Clean them up from Git → Worktrees.`,
    })
  }
  set((s) => withoutWorkspace(s, id))
}

async function removeProject(set: SetWorkspaces, id: string): Promise<void> {
  const result = await window.electronAPI.project.delete(id)
  if (result.worktreeKept) {
    const { path, reason } = result.worktreeKept
    useToastStore.getState().addToast({
      type: 'warning',
      message: `Branch removed, folder kept. git could not remove ${path}: ${reason}. Clean it up from Git → Worktrees.`,
    })
  }
  set((s) => withProjectRemoved(s, id))
}

async function loadProjects(set: SetWorkspaces, workspaceId: string): Promise<void> {
  const result = await window.electronAPI.project.list(workspaceId)
  set((s) => withProjectsLoaded(s, workspaceId, result.projects))
}

async function saveProjectOrder(
  set: SetWorkspaces,
  workspaceId: string,
  ids: string[]
): Promise<void> {
  set((s) => withProjectsOrdered(s, workspaceId, ids))
  await window.electronAPI.project.reorder(workspaceId, ids)
}

/** The repos themselves: listing, adding, editing, removing, ordering and choosing one. */
function workspaceSlice(
  set: SetWorkspaces,
  get: GetWorkspaces
): Slice<
  | 'loadWorkspaces'
  | 'createWorkspace'
  | 'updateWorkspace'
  | 'deleteWorkspace'
  | 'setActiveWorkspace'
  | 'reorderWorkspaces'
> {
  return {
    loadWorkspaces: async () => {
      const result = await window.electronAPI.workspace.list()
      set({ workspaces: result.workspaces })
    },
    createWorkspace: (input) => saveNewWorkspace(set, input),
    updateWorkspace: (input) => saveWorkspaceEdit(set, input),
    deleteWorkspace: (id) => removeWorkspace(set, id),
    setActiveWorkspace: (id) => {
      set({ activeWorkspaceId: id, activeProjectId: null })
      if (id) get().loadProjects(id)
    },
    reorderWorkspaces: async (ids) => {
      set((s) => ({ workspaces: inOrder(s.workspaces, ids) }))
      await window.electronAPI.workspace.reorder(ids)
    },
  }
}

/** The branches under each repo. */
function projectSlice(
  set: SetWorkspaces
): Slice<
  | 'loadProjects'
  | 'createProject'
  | 'updateProjectBranch'
  | 'renameProject'
  | 'reorderProjects'
  | 'deleteProject'
  | 'setActiveProject'
> {
  return {
    loadProjects: (workspaceId) => loadProjects(set, workspaceId),
    createProject: async (input) =>
      keepProject(set, await window.electronAPI.project.create(input), withProjectAdded),
    updateProjectBranch: async (id, gitBranch) =>
      keepProject(
        set,
        await window.electronAPI.project.updateBranch(id, gitBranch),
        withProjectReplaced
      ),
    renameProject: async (id, name) =>
      keepProject(set, await window.electronAPI.project.rename(id, name), withProjectReplaced),
    reorderProjects: (workspaceId, ids) => saveProjectOrder(set, workspaceId, ids),
    deleteProject: (id) => removeProject(set, id),
    setActiveProject: (id) => set({ activeProjectId: id }),
  }
}

/** Which repos are expanded and which branches collapsed, kept across launches. */
function disclosureSlice(
  set: SetWorkspaces,
  get: GetWorkspaces
): Slice<
  | 'toggleWorkspaceCollapse'
  | 'setExpandedWorkspaceIds'
  | 'toggleProjectCollapse'
  | 'ensureProjectExpanded'
> {
  const setExpanded = (ids: Set<string>) => {
    saveIds(EXPANDED_KEY, ids)
    set({ expandedWorkspaceIds: ids })
  }
  const setCollapsed = (ids: Set<string>) => {
    saveIds(COLLAPSED_KEY, ids)
    set({ collapsedProjectIds: ids })
  }
  return {
    toggleWorkspaceCollapse: (id) => setExpanded(toggledId(get().expandedWorkspaceIds, id)),
    setExpandedWorkspaceIds: setExpanded,
    toggleProjectCollapse: (id) => setCollapsed(toggledId(get().collapsedProjectIds, id)),
    ensureProjectExpanded: (id) => {
      if (get().collapsedProjectIds.has(id)) setCollapsed(toggledId(get().collapsedProjectIds, id))
    },
  }
}

function activeCwdOf(s: WorkspaceState): string {
  const { activeWorkspaceId, activeProjectId, workspaces, projectsByWorkspaceId } = s
  const workspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const projects = activeWorkspaceId ? (projectsByWorkspaceId.get(activeWorkspaceId) ?? []) : []
  const project = projects.find((p) => p.id === activeProjectId)
  return project?.worktreePath ?? workspace?.folderPath ?? '~'
}

// One store built from slices: https://zustand.docs.pmnd.rs/guides/slices-pattern
export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  activeProjectId: null,
  projectsByWorkspaceId: new Map(),
  expandedWorkspaceIds: loadIds(EXPANDED_KEY),
  collapsedProjectIds: loadIds(COLLAPSED_KEY),
  scratchActive: false,
  setScratchActive: (value) =>
    set(
      value
        ? { scratchActive: true, activeWorkspaceId: null, activeProjectId: null }
        : { scratchActive: false }
    ),
  ...workspaceSlice(set, get),
  ...projectSlice(set),
  ...disclosureSlice(set, get),
  resolveActiveCwd: () => activeCwdOf(get()),
}))

// Subscribe to push notifications from the main process so the sidebar
// updates immediately when any caller (including extensions) creates a project.
if (typeof window !== 'undefined' && window.electronAPI?.project?.onAdded) {
  window.electronAPI.project.onAdded((project) => {
    useWorkspaceStore.setState((s) => withProjectAdded(s, project))
  })
}

if (typeof window !== 'undefined' && window.electronAPI?.project?.onRemoved) {
  window.electronAPI.project.onRemoved((id) => {
    useSessionStore.getState().dropProjectSessions(id)
    useWorkspaceStore.setState((s) => withProjectRemoved(s, id))
  })
}
