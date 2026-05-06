import Store from 'electron-store'
import { randomUUID } from 'crypto'
import type { Workspace, Project } from '../../shared/types/index.js'
import {
  CreateWorkspaceInputSchema,
  UpdateWorkspaceInputSchema,
  CreateProjectInputSchema,
  UpdateProjectBranchSchema,
  RenameProjectSchema,
  ReorderWorkspacesSchema,
  ReorderProjectsSchema,
} from '../../shared/schemas/workspace.schema.js'

interface StoreSchema {
  workspaces: Workspace[]
  projects: Project[]
}

const store = new Store<StoreSchema>({
  name: 'workspaces',
  defaults: {
    workspaces: [],
    projects: [],
  },
})

function now(): string {
  return new Date().toISOString()
}

export function listWorkspaces(): Workspace[] {
  return store.get('workspaces')
}

export function createWorkspace(
  input: unknown
): { workspace: Workspace } | { error: 'DUPLICATE_NAME' | 'VALIDATION_ERROR'; message?: string } {
  const parsed = CreateWorkspaceInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'VALIDATION_ERROR', message: parsed.error.message }
  }
  const { name, folderPath, color, tags } = parsed.data
  const workspaces = store.get('workspaces')
  if (workspaces.some((w) => w.name.toLowerCase() === name.toLowerCase())) {
    return { error: 'DUPLICATE_NAME' }
  }
  const workspace: Workspace = {
    id: randomUUID(),
    name,
    folderPath,
    color,
    tags,
    createdAt: now(),
    updatedAt: now(),
  }
  store.set('workspaces', [...workspaces, workspace])
  return { workspace }
}

export function updateWorkspace(
  input: unknown
):
  | { workspace: Workspace }
  | { error: 'DUPLICATE_NAME' | 'NOT_FOUND' | 'VALIDATION_ERROR'; message?: string } {
  const parsed = UpdateWorkspaceInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'VALIDATION_ERROR', message: parsed.error.message }
  }
  const { id, name, ...rest } = parsed.data
  const workspaces = store.get('workspaces')
  const idx = workspaces.findIndex((w) => w.id === id)
  if (idx === -1) return { error: 'NOT_FOUND' }
  if (name !== undefined) {
    const duplicate = workspaces.some(
      (w) => w.name.toLowerCase() === name.toLowerCase() && w.id !== id
    )
    if (duplicate) return { error: 'DUPLICATE_NAME' }
  }
  const updated: Workspace = {
    ...workspaces[idx],
    ...(name !== undefined ? { name } : {}),
    ...rest,
    updatedAt: now(),
  }
  const next = [...workspaces]
  next[idx] = updated
  store.set('workspaces', next)
  return { workspace: updated }
}

export function deleteWorkspace(id: string): { success: boolean } {
  const workspaces = store.get('workspaces').filter((w) => w.id !== id)
  store.set('workspaces', workspaces)
  const projects = store.get('projects').filter((p) => p.workspaceId !== id)
  store.set('projects', projects)
  return { success: true }
}

export function listProjects(workspaceId: string): Project[] {
  return store.get('projects').filter((p) => p.workspaceId === workspaceId)
}

export function createProject(
  input: unknown
):
  | { project: Project }
  | { error: 'DUPLICATE_NAME' | 'WORKSPACE_NOT_FOUND' | 'VALIDATION_ERROR'; message?: string } {
  const parsed = CreateProjectInputSchema.safeParse(input)
  if (!parsed.success) {
    return { error: 'VALIDATION_ERROR', message: parsed.error.message }
  }
  const { workspaceId, name, gitBranch, worktreePath, isWorktree } = parsed.data
  const workspaces = store.get('workspaces')
  if (!workspaces.some((w) => w.id === workspaceId)) {
    return { error: 'WORKSPACE_NOT_FOUND' }
  }
  const projects = store.get('projects')
  if (
    projects.some(
      (p) => p.workspaceId === workspaceId && p.name.toLowerCase() === name.toLowerCase()
    )
  ) {
    return { error: 'DUPLICATE_NAME' }
  }
  const project: Project = {
    id: randomUUID(),
    workspaceId,
    name,
    gitBranch,
    worktreePath,
    isWorktree: isWorktree ?? false,
    createdAt: now(),
    updatedAt: now(),
  }
  store.set('projects', [...projects, project])
  return { project }
}

export function updateProjectBranch(
  input: unknown
): { project: Project } | { error: 'NOT_FOUND' | 'VALIDATION_ERROR' } {
  const parsed = UpdateProjectBranchSchema.safeParse(input)
  if (!parsed.success) return { error: 'VALIDATION_ERROR' }
  const projects = store.get('projects')
  const idx = projects.findIndex((p) => p.id === parsed.data.id)
  if (idx === -1) return { error: 'NOT_FOUND' }
  const updated = { ...projects[idx], gitBranch: parsed.data.gitBranch, updatedAt: now() }
  const next = [...projects]
  next[idx] = updated
  store.set('projects', next)
  return { project: updated }
}

export function deleteProject(id: string): { success: boolean } {
  const projects = store.get('projects').filter((p) => p.id !== id)
  store.set('projects', projects)
  return { success: true }
}

export function renameProject(
  input: unknown
): { project: Project } | { error: 'NOT_FOUND' | 'DUPLICATE_NAME' | 'VALIDATION_ERROR' } {
  const parsed = RenameProjectSchema.safeParse(input)
  if (!parsed.success) return { error: 'VALIDATION_ERROR' }
  const { id, name } = parsed.data
  const projects = store.get('projects')
  const idx = projects.findIndex((p) => p.id === id)
  if (idx === -1) return { error: 'NOT_FOUND' }
  const { workspaceId } = projects[idx]
  if (projects.some((p) => p.workspaceId === workspaceId && p.name.toLowerCase() === name.toLowerCase() && p.id !== id)) {
    return { error: 'DUPLICATE_NAME' }
  }
  const updated = { ...projects[idx], name, updatedAt: now() }
  const next = [...projects]
  next[idx] = updated
  store.set('projects', next)
  return { project: updated }
}

export function reorderWorkspaces(input: unknown): { success: boolean } {
  const parsed = ReorderWorkspacesSchema.safeParse(input)
  if (!parsed.success) return { success: false }
  const { ids } = parsed.data
  const workspaces = store.get('workspaces')
  const map = new Map(workspaces.map((w) => [w.id, w]))
  const reordered = ids.flatMap((id) => (map.get(id) ? [map.get(id)!] : []))
  const missing = workspaces.filter((w) => !ids.includes(w.id))
  store.set('workspaces', [...reordered, ...missing])
  return { success: true }
}

export function reorderProjects(input: unknown): { success: boolean } {
  const parsed = ReorderProjectsSchema.safeParse(input)
  if (!parsed.success) return { success: false }
  const { workspaceId, ids } = parsed.data
  const projects = store.get('projects')
  const forWs = projects.filter((p) => p.workspaceId === workspaceId)
  const other = projects.filter((p) => p.workspaceId !== workspaceId)
  const map = new Map(forWs.map((p) => [p.id, p]))
  const reordered = ids.flatMap((id) => (map.get(id) ? [map.get(id)!] : []))
  const missing = forWs.filter((p) => !ids.includes(p.id))
  store.set('projects', [...other, ...reordered, ...missing])
  return { success: true }
}
