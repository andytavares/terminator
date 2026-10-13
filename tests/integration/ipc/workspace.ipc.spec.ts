import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Project, Workspace } from '../../../src/shared/types/index'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())
const sent = vi.hoisted(() => [] as Array<{ channel: string; data: unknown }>)
const git = vi.hoisted(() => ({ removeWorktree: vi.fn() }))

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
  BrowserWindow: {
    getAllWindows: () => [
      { webContents: { send: (channel: string, data: unknown) => sent.push({ channel, data }) } },
    ],
  },
}))
vi.mock('electron-store', async () =>
  (await import('../../support/stores')).inMemoryElectronStore()
)
vi.mock('../../../src/main/git/git-service', () => git)
vi.mock('../../../src/main/extensions/workspace-events', () => ({ emitProjectDelete: vi.fn() }))

function invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  return Promise.resolve(handlers.get(channel)!({}, payload)) as Promise<T>
}

async function invokeCreateWorkspace(name: string): Promise<Workspace> {
  const reply = await invoke<{ workspace: Workspace }>('workspace:create', {
    name,
    folderPath: `/repos/${name}`,
    color: '#4A90E2',
    tags: [],
  })
  return reply.workspace
}

async function invokeCreateProject(
  workspaceId: string,
  name: string,
  extra = {}
): Promise<Project> {
  const reply = await invoke<{ project: Project }>('project:create', {
    workspaceId,
    name,
    ...extra,
  })
  return reply.project
}

async function listedWorkspaceNames(): Promise<string[]> {
  const { workspaces } = await invoke<{ workspaces: Workspace[] }>('workspace:list')
  return workspaces.map((w) => w.name)
}

async function projectNames(workspaceId: string): Promise<string[]> {
  const { projects } = await invoke<{ projects: Project[] }>('project:list', { workspaceId })
  return projects.map((p) => p.name)
}

beforeEach(async () => {
  vi.resetModules()
  git.removeWorktree.mockReset()
  handlers.clear()
  sent.length = 0
  const { registerWorkspaceHandlers } = await import('../../../src/main/ipc/workspace.ipc')
  registerWorkspaceHandlers()
})

describe('workspaces', () => {
  it('lists the workspaces that were created, in creation order', async () => {
    await invokeCreateWorkspace('alpha')
    await invokeCreateWorkspace('beta')

    expect(await listedWorkspaceNames()).toEqual(['alpha', 'beta'])
  })

  it('renames a workspace', async () => {
    const workspace = await invokeCreateWorkspace('alpha')

    await invoke('workspace:update', { id: workspace.id, name: 'gamma' })

    expect(await listedWorkspaceNames()).toEqual(['gamma'])
  })

  it('deletes a workspace together with its projects', async () => {
    const workspace = await invokeCreateWorkspace('alpha')
    await invokeCreateProject(workspace.id, 'app')

    expect(await invoke('workspace:delete', { id: workspace.id })).toEqual({ success: true })

    expect(await listedWorkspaceNames()).toEqual([])
    expect(await projectNames(workspace.id)).toEqual([])
  })

  it('reorders workspaces', async () => {
    const alpha = await invokeCreateWorkspace('alpha')
    const beta = await invokeCreateWorkspace('beta')

    await invoke('workspace:reorder', { ids: [beta.id, alpha.id] })

    expect(await listedWorkspaceNames()).toEqual(['beta', 'alpha'])
  })
})

describe('projects', () => {
  it('lists a project in its own workspace and tells every window it was added', async () => {
    const alpha = await invokeCreateWorkspace('alpha')
    const beta = await invokeCreateWorkspace('beta')

    const project = await invokeCreateProject(alpha.id, 'app')

    expect(await projectNames(alpha.id)).toEqual(['app'])
    expect(await projectNames(beta.id)).toEqual([])
    expect(sent).toEqual([{ channel: 'workspace:project-added', data: project }])
  })

  it('tells no window when the project could not be created', async () => {
    const workspace = await invokeCreateWorkspace('alpha')
    await invokeCreateProject(workspace.id, 'app')
    sent.length = 0

    const reply = await invoke('project:create', { workspaceId: workspace.id, name: 'App' })

    expect(reply).toEqual({ error: 'DUPLICATE_NAME' })
    expect(sent).toEqual([])
  })
})

describe('projects — branch, name and order', () => {
  it('records the branch and the new name of a project', async () => {
    const workspace = await invokeCreateWorkspace('alpha')
    const project = await invokeCreateProject(workspace.id, 'app')

    await invoke('project:update-branch', { id: project.id, gitBranch: 'feature' })
    await invoke('project:rename', { id: project.id, name: 'web' })

    const { projects } = await invoke<{ projects: Project[] }>('project:list', {
      workspaceId: workspace.id,
    })
    expect(projects).toMatchObject([{ id: project.id, name: 'web', gitBranch: 'feature' }])
  })

  it('reorders the projects of a workspace', async () => {
    const workspace = await invokeCreateWorkspace('alpha')
    const app = await invokeCreateProject(workspace.id, 'app')
    const docs = await invokeCreateProject(workspace.id, 'docs')

    await invoke('project:reorder', { workspaceId: workspace.id, ids: [docs.id, app.id] })

    expect(await projectNames(workspace.id)).toEqual(['docs', 'app'])
  })
})

describe('project:delete', () => {
  it('removes the project and tells every window', async () => {
    const workspace = await invokeCreateWorkspace('alpha')
    const project = await invokeCreateProject(workspace.id, 'app')
    sent.length = 0

    expect(await invoke('project:delete', { id: project.id })).toEqual({ success: true })

    expect(await projectNames(workspace.id)).toEqual([])
    expect(sent).toEqual([{ channel: 'workspace:project-removed', data: { id: project.id } }])
    expect(git.removeWorktree).not.toHaveBeenCalled()
  })

  it("removes a worktree project's worktree from the workspace's repository first", async () => {
    const workspace = await invokeCreateWorkspace('alpha')
    const project = await invokeCreateProject(workspace.id, 'feature', {
      isWorktree: true,
      worktreePath: '/repos/alpha-feature',
    })

    await invoke('project:delete', { id: project.id })

    expect(git.removeWorktree).toHaveBeenCalledWith('/repos/alpha', '/repos/alpha-feature')
    expect(await projectNames(workspace.id)).toEqual([])
  })
})

describe('project:delete — failing worktree removal', () => {
  it('still removes the project when git cannot remove the worktree', async () => {
    git.removeWorktree.mockRejectedValue(new Error('worktree is dirty'))
    const workspace = await invokeCreateWorkspace('alpha')
    const project = await invokeCreateProject(workspace.id, 'feature', {
      isWorktree: true,
      worktreePath: '/repos/alpha-feature',
    })

    expect(await invoke('project:delete', { id: project.id })).toEqual({ success: true })

    expect(await projectNames(workspace.id)).toEqual([])
  })
})

describe('workspace:get-active', () => {
  it('answers the context the renderer last reported', async () => {
    const { setActiveWorkspaceContext } = await import('../../../src/main/ipc/workspace.ipc')
    setActiveWorkspaceContext({ workspaceId: 'ws-1', projectId: 'p-1', repoRoot: '/repo' })

    expect(await invoke('workspace:get-active')).toEqual({
      workspaceId: 'ws-1',
      projectId: 'p-1',
      repoRoot: '/repo',
    })
  })
})
