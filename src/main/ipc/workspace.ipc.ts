import { handleChannel } from './channel-registrar.js'
import { BrowserWindow } from 'electron'
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
  getProjectById,
} from '../storage/workspace-store.js'
import { removeWorktree } from '../git/git-service.js'
import { emitWorkspaceDelete, emitProjectDelete } from '../extensions/workspace-events.js'

interface ActiveWorkspaceContext {
  workspaceId: string | null
  projectId: string | null
  repoRoot: string | null
}

let activeContext: ActiveWorkspaceContext = {
  workspaceId: null,
  projectId: null,
  repoRoot: null,
}

export function setActiveWorkspaceContext(ctx: ActiveWorkspaceContext): void {
  activeContext = ctx
}

export function getActiveWorkspaceContext(): ActiveWorkspaceContext {
  return activeContext
}

export function registerWorkspaceHandlers(): void {
  handleChannel('workspace:get-active', () => activeContext)

  handleChannel('workspace:list', () => {
    return { workspaces: listWorkspaces() }
  })

  handleChannel('workspace:create', (_event, payload) => {
    return createWorkspace(payload)
  })

  handleChannel('workspace:update', (_event, payload) => {
    return updateWorkspace(payload)
  })

  handleChannel('workspace:delete', (_event, { id }) => {
    const result = deleteWorkspace(id)
    emitWorkspaceDelete(id)
    return result
  })

  handleChannel('workspace:reorder', (_event, payload) => {
    return reorderWorkspaces(payload)
  })

  handleChannel('project:list', (_event, { workspaceId }) => {
    return { projects: listProjects(workspaceId) }
  })

  handleChannel('project:create', (_event, payload) => {
    const result = createProject(payload)
    if ('project' in result) {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('workspace:project-added', result.project)
      })
    }
    return result
  })

  handleChannel('project:update-branch', (_event, payload) => {
    return updateProjectBranch(payload)
  })

  handleChannel('project:rename', (_event, payload) => {
    return renameProject(payload)
  })

  handleChannel('project:reorder', (_event, payload) => {
    return reorderProjects(payload)
  })

  handleChannel('project:delete', async (_event, { id }) => {
    const project = getProjectById(id)
    if (project?.isWorktree && project.worktreePath) {
      const workspace = listWorkspaces().find((w) => w.id === project.workspaceId)
      if (workspace?.folderPath) {
        try {
          await removeWorktree(workspace.folderPath, project.worktreePath)
        } catch {
          // proceed with deletion even if worktree removal fails
        }
      }
    }
    const result = deleteProject(id)
    emitProjectDelete(id)
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('workspace:project-removed', { id })
    })
    return result
  })
}
