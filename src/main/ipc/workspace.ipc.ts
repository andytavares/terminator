import { z } from 'zod'
import { BrowserWindow } from 'electron'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import {
  CreateProjectInputSchema,
  CreateWorkspaceInputSchema,
  RenameProjectSchema,
  ReorderProjectsSchema,
  ReorderWorkspacesSchema,
  UpdateProjectBranchSchema,
  UpdateWorkspaceInputSchema,
} from '../../shared/schemas/workspace.schema.js'
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
import { emitProjectDelete } from '../extensions/workspace-events.js'

export interface ActiveWorkspaceContext {
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

const IdSchema = z.object({ id: z.string().min(1) })
const failed = { success: false }
const validationError = (error: z.ZodError) => ({
  error: 'VALIDATION_ERROR',
  message: error.message,
})

export function registerWorkspaceHandlers(): void {
  registerInvokeTable([...workspaceSpecs(), ...projectSpecs()])
}

function workspaceSpecs(): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'workspace:get-active',
      schema: noPayload,
      invalid: validationError,
      run: () => activeContext,
    }),
    defineChannel({
      channel: 'workspace:list',
      schema: noPayload,
      invalid: validationError,
      run: () => ({ workspaces: listWorkspaces() }),
    }),
    defineChannel({
      channel: 'workspace:create',
      schema: CreateWorkspaceInputSchema,
      invalid: validationError,
      run: (input) => createWorkspace(input),
    }),
    defineChannel({
      channel: 'workspace:update',
      schema: UpdateWorkspaceInputSchema,
      invalid: validationError,
      run: (input) => updateWorkspace(input),
    }),
    defineChannel({
      channel: 'workspace:delete',
      schema: IdSchema,
      invalid: failed,
      run: ({ id }) => deleteWorkspace(id),
    }),
    defineChannel({
      channel: 'workspace:reorder',
      schema: ReorderWorkspacesSchema,
      invalid: failed,
      run: (input) => reorderWorkspaces(input),
    }),
  ]
}

function projectSpecs(): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'project:list',
      schema: z.object({ workspaceId: z.string().min(1) }),
      invalid: { projects: [] },
      run: ({ workspaceId }) => ({ projects: listProjects(workspaceId) }),
    }),
    defineChannel({
      channel: 'project:create',
      schema: CreateProjectInputSchema,
      invalid: validationError,
      run: (input) => {
        const result = createProject(input)
        if ('project' in result) {
          BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send('workspace:project-added', result.project)
          })
        }
        return result
      },
    }),
    defineChannel({
      channel: 'project:update-branch',
      schema: UpdateProjectBranchSchema,
      invalid: validationError,
      run: (input) => updateProjectBranch(input),
    }),
    defineChannel({
      channel: 'project:rename',
      schema: RenameProjectSchema,
      invalid: validationError,
      run: (input) => renameProject(input),
    }),
    defineChannel({
      channel: 'project:reorder',
      schema: ReorderProjectsSchema,
      invalid: failed,
      run: (input) => reorderProjects(input),
    }),
    defineChannel({
      channel: 'project:delete',
      schema: IdSchema,
      invalid: failed,
      run: ({ id }) => removeProject(id),
    }),
  ]
}

async function removeProject(id: string): Promise<{ success: boolean }> {
  const project = getProjectById(id)
  if (project?.isWorktree && project.worktreePath) {
    const workspace = listWorkspaces().find((w) => w.id === project.workspaceId)
    if (workspace) {
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
}
