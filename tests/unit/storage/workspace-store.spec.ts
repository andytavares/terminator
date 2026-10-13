import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron-store', async () =>
  (await import('../../support/stores')).inMemoryElectronStore()
)
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

type Store = typeof import('../../../src/main/storage/workspace-store')
let store: Store

/** A new workspace named `name`; a refused create fails the spec here, not later. */
function workspace(name: string) {
  const result = store.createWorkspace({ name, folderPath: `/${name}`, color: '#4A90E2', tags: [] })
  if ('error' in result) throw new Error(result.error)
  return result.workspace
}

function project(workspaceId: string, name: string) {
  const result = store.createProject({ workspaceId, name, isWorktree: false })
  if ('error' in result) throw new Error(result.error)
  return result.project
}

beforeEach(async () => {
  vi.resetModules()
  store = await import('../../../src/main/storage/workspace-store')
})

describe('workspace-store', () => {
  it('creates a workspace and returns it', () => {
    const created = workspace('Test Workspace')
    expect(created).toMatchObject({ name: 'Test Workspace', folderPath: '/Test Workspace' })
    expect(store.listWorkspaces()).toEqual([created])
  })

  it('rejects duplicate workspace name with DUPLICATE_NAME error', () => {
    workspace('Duplicate')
    const again = { name: 'duplicate', folderPath: '/b', color: '#4A90E2', tags: [] }
    expect(store.createWorkspace(again)).toEqual({ error: 'DUPLICATE_NAME' })
  })

  it('update rejects duplicate name', () => {
    workspace('WS1')
    const second = workspace('WS2')
    expect(store.updateWorkspace({ id: second.id, name: 'WS1' })).toEqual({
      error: 'DUPLICATE_NAME',
    })
  })

  it('lists all workspaces, in creation order', () => {
    const a = workspace('A')
    const b = workspace('B')
    expect(store.listWorkspaces().map((w) => w.id)).toEqual([a.id, b.id])
  })

  it('deletes workspace and its projects', () => {
    const doomed = workspace('ToDelete')
    const kept = workspace('Kept')
    project(doomed.id, 'P1')
    project(kept.id, 'P2')
    store.deleteWorkspace(doomed.id)
    expect(store.listWorkspaces()).toEqual([kept])
    expect(store.listProjects(doomed.id)).toEqual([])
    expect(store.listProjects(kept.id)).toHaveLength(1)
  })

  it('creates a project within a workspace', () => {
    const ws = workspace('ForProject')
    const created = project(ws.id, 'MyProject')
    expect(created).toMatchObject({ workspaceId: ws.id, name: 'MyProject', isWorktree: false })
    expect(store.listProjects(ws.id)).toEqual([created])
  })

  it('rejects duplicate project name within same workspace', () => {
    const ws = workspace('DupWS')
    project(ws.id, 'P')
    expect(store.createProject({ workspaceId: ws.id, name: 'p', isWorktree: false })).toEqual({
      error: 'DUPLICATE_NAME',
    })
  })

  it('allows same project name in different workspaces', () => {
    const w1 = workspace('WSA')
    const w2 = workspace('WSB')
    project(w1.id, 'SharedName')
    expect(project(w2.id, 'SharedName').workspaceId).toBe(w2.id)
  })

  it('createProject returns WORKSPACE_NOT_FOUND for unknown workspace', () => {
    const input = {
      workspaceId: '00000000-0000-0000-0000-000000000099',
      name: 'P',
      isWorktree: false,
    }
    expect(store.createProject(input)).toEqual({ error: 'WORKSPACE_NOT_FOUND' })
  })

  it('updateProjectBranch updates the branch on a project', () => {
    const p = project(workspace('BranchWS').id, 'BranchProj')
    expect(store.updateProjectBranch({ id: p.id, gitBranch: 'feature/test' })).toMatchObject({
      project: { id: p.id, gitBranch: 'feature/test' },
    })
    expect(store.getProjectById(p.id)?.gitBranch).toBe('feature/test')
  })

  it('updateProjectBranch returns NOT_FOUND for unknown project', () => {
    const input = { id: '00000000-0000-0000-0000-000000000003', gitBranch: 'main' }
    expect(store.updateProjectBranch(input)).toEqual({ error: 'NOT_FOUND' })
  })

  it('deleteProject removes the project', () => {
    const ws = workspace('DelProjWS')
    const p = project(ws.id, 'ToDelete')
    store.deleteProject(p.id)
    expect(store.listProjects(ws.id)).toEqual([])
  })

  it('renameProject renames an existing project', () => {
    const p = project(workspace('RenameWS').id, 'OldName')
    expect(store.renameProject({ id: p.id, name: 'NewName' })).toMatchObject({
      project: { name: 'NewName' },
    })
    expect(store.getProjectById(p.id)?.name).toBe('NewName')
  })

  it('renameProject returns NOT_FOUND for unknown project', () => {
    const input = { id: '00000000-0000-0000-0000-000000000001', name: 'NewName' }
    expect(store.renameProject(input)).toEqual({ error: 'NOT_FOUND' })
  })

  it('renameProject returns DUPLICATE_NAME when name conflicts', () => {
    const ws = workspace('DupRenameWS')
    project(ws.id, 'ExistingName')
    const other = project(ws.id, 'OtherName')
    expect(store.renameProject({ id: other.id, name: 'ExistingName' })).toEqual({
      error: 'DUPLICATE_NAME',
    })
  })

  it('reorderWorkspaces reorders workspaces by id list', () => {
    const first = workspace('First')
    const second = workspace('Second')
    store.reorderWorkspaces({ ids: [second.id, first.id] })
    expect(store.listWorkspaces().map((w) => w.id)).toEqual([second.id, first.id])
  })

  it('reorderProjects reorders projects within a workspace', () => {
    const ws = workspace('OrderWS')
    const p1 = project(ws.id, 'First')
    const p2 = project(ws.id, 'Second')
    store.reorderProjects({ workspaceId: ws.id, ids: [p2.id, p1.id] })
    expect(store.listProjects(ws.id).map((p) => p.id)).toEqual([p2.id, p1.id])
  })

  it('updateWorkspace returns NOT_FOUND for unknown workspace id', () => {
    const input = { id: '00000000-0000-0000-0000-000000000002', name: 'NewName' }
    expect(store.updateWorkspace(input)).toEqual({ error: 'NOT_FOUND' })
  })

  it('updateWorkspace updates workspace name', () => {
    const ws = workspace('UpdateMe')
    expect(store.updateWorkspace({ id: ws.id, name: 'UpdatedName' })).toMatchObject({
      workspace: { name: 'UpdatedName' },
    })
    expect(store.listWorkspaces()[0].name).toBe('UpdatedName')
  })
})
