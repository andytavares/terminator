import { ipcMain } from 'electron'
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  reorderWorkspaces,
  listProjects,
  createProject,
  updateProjectBranch,
  renameProject,
  reorderProjects,
  deleteProject,
} from '../storage/workspace-store.js'

export function registerWorkspaceHandlers(): void {
  ipcMain.handle('workspace:list', () => {
    return { workspaces: listWorkspaces() }
  })

  ipcMain.handle('workspace:create', (_event, payload) => {
    return createWorkspace(payload)
  })

  ipcMain.handle('workspace:update', (_event, payload) => {
    return updateWorkspace(payload)
  })

  ipcMain.handle('workspace:delete', (_event, { id }) => {
    return deleteWorkspace(id)
  })

  ipcMain.handle('workspace:reorder', (_event, payload) => {
    return reorderWorkspaces(payload)
  })

  ipcMain.handle('project:list', (_event, { workspaceId }) => {
    return { projects: listProjects(workspaceId) }
  })

  ipcMain.handle('project:create', (_event, payload) => {
    return createProject(payload)
  })

  ipcMain.handle('project:update-branch', (_event, payload) => {
    return updateProjectBranch(payload)
  })

  ipcMain.handle('project:rename', (_event, payload) => {
    return renameProject(payload)
  })

  ipcMain.handle('project:reorder', (_event, payload) => {
    return reorderProjects(payload)
  })

  ipcMain.handle('project:delete', (_event, { id }) => {
    return deleteProject(id)
  })
}
