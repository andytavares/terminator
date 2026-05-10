import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('electron-store', () => {
  const data: Record<string, unknown> = { workspaces: [], projects: [] }
  return {
    default: class MockStore {
      get(key: string) {
        return data[key]
      }
      set(key: string, value: unknown) {
        data[key] = value
      }
    },
  }
})

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

describe('workspace-store', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('creates a workspace and returns it', async () => {
    const { createWorkspace } = await import('../../../src/main/storage/workspace-store')
    const result = await Promise.resolve(
      createWorkspace({
        name: 'Test Workspace',
        folderPath: '/home/user',
        color: '#4A90E2',
        tags: [],
      })
    )
    expect('workspace' in result).toBe(true)
    if ('workspace' in result) {
      expect(result.workspace.name).toBe('Test Workspace')
      expect(result.workspace.id).toBeDefined()
    }
  })

  it('rejects duplicate workspace name with DUPLICATE_NAME error', async () => {
    const { createWorkspace } = await import('../../../src/main/storage/workspace-store')
    createWorkspace({ name: 'Duplicate', folderPath: '/a', color: '#4A90E2', tags: [] })
    const result = createWorkspace({
      name: 'Duplicate',
      folderPath: '/b',
      color: '#4A90E2',
      tags: [],
    })
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toBe('DUPLICATE_NAME')
  })

  it('update rejects duplicate name', async () => {
    const { createWorkspace, updateWorkspace } = await import(
      '../../../src/main/storage/workspace-store'
    )
    createWorkspace({ name: 'WS1', folderPath: '/a', color: '#4A90E2', tags: [] })
    const r2 = createWorkspace({ name: 'WS2', folderPath: '/b', color: '#4A90E2', tags: [] })
    if (!('workspace' in r2)) return
    const result = updateWorkspace({ id: r2.workspace.id, name: 'WS1' })
    expect('error' in result).toBe(true)
    if ('error' in result) expect(result.error).toBe('DUPLICATE_NAME')
  })

  it('lists all workspaces', async () => {
    const { createWorkspace, listWorkspaces } = await import(
      '../../../src/main/storage/workspace-store'
    )
    createWorkspace({ name: 'A', folderPath: '/a', color: '#4A90E2', tags: [] })
    createWorkspace({ name: 'B', folderPath: '/b', color: '#4A90E2', tags: [] })
    const workspaces = listWorkspaces()
    expect(workspaces.length).toBeGreaterThanOrEqual(2)
  })

  it('deletes workspace and its projects', async () => {
    const { createWorkspace, createProject, listProjects, deleteWorkspace, listWorkspaces } =
      await import('../../../src/main/storage/workspace-store')
    const r = createWorkspace({ name: 'ToDelete', folderPath: '/d', color: '#4A90E2', tags: [] })
    if (!('workspace' in r)) return
    const wsId = r.workspace.id
    createProject({ workspaceId: wsId, name: 'P1' })
    deleteWorkspace(wsId)
    const workspaces = listWorkspaces()
    expect(workspaces.find((w) => w.id === wsId)).toBeUndefined()
    expect(listProjects(wsId)).toHaveLength(0)
  })

  it('creates a project within a workspace', async () => {
    const { createWorkspace, createProject } = await import(
      '../../../src/main/storage/workspace-store'
    )
    const wr = createWorkspace({ name: 'ForProject', folderPath: '/p', color: '#4A90E2', tags: [] })
    if (!('workspace' in wr)) return
    const pr = createProject({ workspaceId: wr.workspace.id, name: 'MyProject' })
    expect('project' in pr).toBe(true)
  })

  it('rejects duplicate project name within same workspace', async () => {
    const { createWorkspace, createProject } = await import(
      '../../../src/main/storage/workspace-store'
    )
    const wr = createWorkspace({ name: 'DupWS', folderPath: '/q', color: '#4A90E2', tags: [] })
    if (!('workspace' in wr)) return
    createProject({ workspaceId: wr.workspace.id, name: 'P' })
    const r2 = createProject({ workspaceId: wr.workspace.id, name: 'P' })
    expect('error' in r2 && r2.error).toBe('DUPLICATE_NAME')
  })

  it('allows same project name in different workspaces', async () => {
    const { createWorkspace, createProject } = await import(
      '../../../src/main/storage/workspace-store'
    )
    const w1 = createWorkspace({ name: 'WSA', folderPath: '/wsa', color: '#4A90E2', tags: [] })
    const w2 = createWorkspace({ name: 'WSB', folderPath: '/wsb', color: '#4A90E2', tags: [] })
    if (!('workspace' in w1) || !('workspace' in w2)) return
    createProject({ workspaceId: w1.workspace.id, name: 'SharedName' })
    const r2 = createProject({ workspaceId: w2.workspace.id, name: 'SharedName' })
    expect('project' in r2).toBe(true)
  })

  it('createProject returns WORKSPACE_NOT_FOUND for unknown workspace', async () => {
    const { createProject } = await import('../../../src/main/storage/workspace-store')
    const result = createProject({ workspaceId: '00000000-0000-0000-0000-000000000099', name: 'P' })
    expect('error' in result && result.error).toBe('WORKSPACE_NOT_FOUND')
  })

  it('createProject returns VALIDATION_ERROR for invalid input', async () => {
    const { createProject } = await import('../../../src/main/storage/workspace-store')
    const result = createProject({ workspaceId: 123 })
    expect('error' in result && result.error).toBe('VALIDATION_ERROR')
  })

  it('updateProjectBranch updates the branch on a project', async () => {
    const { createWorkspace, createProject, updateProjectBranch } = await import(
      '../../../src/main/storage/workspace-store'
    )
    const wr = createWorkspace({ name: 'BranchWS', folderPath: '/bws', color: '#4A90E2', tags: [] })
    if (!('workspace' in wr)) return
    const pr = createProject({ workspaceId: wr.workspace.id, name: 'BranchProj' })
    if (!('project' in pr)) return
    const result = updateProjectBranch({ id: pr.project.id, gitBranch: 'feature/test' })
    expect('project' in result).toBe(true)
    if ('project' in result) expect(result.project.gitBranch).toBe('feature/test')
  })

  it('updateProjectBranch returns NOT_FOUND for unknown project', async () => {
    const { updateProjectBranch } = await import('../../../src/main/storage/workspace-store')
    const result = updateProjectBranch({
      id: '00000000-0000-0000-0000-000000000003',
      gitBranch: 'main',
    })
    expect('error' in result && result.error).toBe('NOT_FOUND')
  })

  it('updateProjectBranch returns VALIDATION_ERROR for invalid input', async () => {
    const { updateProjectBranch } = await import('../../../src/main/storage/workspace-store')
    const result = updateProjectBranch({ notAnId: true })
    expect('error' in result && result.error).toBe('VALIDATION_ERROR')
  })

  it('deleteProject removes the project', async () => {
    const { createWorkspace, createProject, deleteProject, listProjects } = await import(
      '../../../src/main/storage/workspace-store'
    )
    const wr = createWorkspace({
      name: 'DelProjWS',
      folderPath: '/dpws',
      color: '#4A90E2',
      tags: [],
    })
    if (!('workspace' in wr)) return
    const pr = createProject({ workspaceId: wr.workspace.id, name: 'ToDelete' })
    if (!('project' in pr)) return
    deleteProject(pr.project.id)
    expect(listProjects(wr.workspace.id)).toHaveLength(0)
  })

  it('renameProject renames an existing project', async () => {
    const { createWorkspace, createProject, renameProject } = await import(
      '../../../src/main/storage/workspace-store'
    )
    const wr = createWorkspace({ name: 'RenameWS', folderPath: '/rws', color: '#4A90E2', tags: [] })
    if (!('workspace' in wr)) return
    const pr = createProject({ workspaceId: wr.workspace.id, name: 'OldName' })
    if (!('project' in pr)) return
    const result = renameProject({ id: pr.project.id, name: 'NewName' })
    expect('project' in result).toBe(true)
    if ('project' in result) expect(result.project.name).toBe('NewName')
  })

  it('renameProject returns NOT_FOUND for unknown project', async () => {
    const { renameProject } = await import('../../../src/main/storage/workspace-store')
    const result = renameProject({ id: '00000000-0000-0000-0000-000000000001', name: 'NewName' })
    expect('error' in result && result.error).toBe('NOT_FOUND')
  })

  it('renameProject returns DUPLICATE_NAME when name conflicts', async () => {
    const { createWorkspace, createProject, renameProject } = await import(
      '../../../src/main/storage/workspace-store'
    )
    const wr = createWorkspace({
      name: 'DupRenameWS',
      folderPath: '/drws',
      color: '#4A90E2',
      tags: [],
    })
    if (!('workspace' in wr)) return
    createProject({ workspaceId: wr.workspace.id, name: 'ExistingName' })
    const pr2 = createProject({ workspaceId: wr.workspace.id, name: 'OtherName' })
    if (!('project' in pr2)) return
    const result = renameProject({ id: pr2.project.id, name: 'ExistingName' })
    expect('error' in result && result.error).toBe('DUPLICATE_NAME')
  })

  it('reorderWorkspaces reorders workspaces by id list', async () => {
    const { createWorkspace, listWorkspaces, reorderWorkspaces } = await import(
      '../../../src/main/storage/workspace-store'
    )
    const w1 = createWorkspace({ name: 'First', folderPath: '/first', color: '#4A90E2', tags: [] })
    const w2 = createWorkspace({
      name: 'Second',
      folderPath: '/second',
      color: '#4A90E2',
      tags: [],
    })
    if (!('workspace' in w1) || !('workspace' in w2)) return
    reorderWorkspaces({ ids: [w2.workspace.id, w1.workspace.id] })
    const workspaces = listWorkspaces()
    const idx1 = workspaces.findIndex((w) => w.id === w1.workspace.id)
    const idx2 = workspaces.findIndex((w) => w.id === w2.workspace.id)
    expect(idx2).toBeLessThan(idx1)
  })

  it('reorderWorkspaces returns success: false for invalid input', async () => {
    const { reorderWorkspaces } = await import('../../../src/main/storage/workspace-store')
    const result = reorderWorkspaces({ ids: 'not-an-array' })
    expect(result).toEqual({ success: false })
  })

  it('reorderProjects reorders projects within a workspace', async () => {
    const { createWorkspace, createProject, listProjects, reorderProjects } = await import(
      '../../../src/main/storage/workspace-store'
    )
    const wr = createWorkspace({ name: 'OrderWS', folderPath: '/ows', color: '#4A90E2', tags: [] })
    if (!('workspace' in wr)) return
    const p1 = createProject({ workspaceId: wr.workspace.id, name: 'First' })
    const p2 = createProject({ workspaceId: wr.workspace.id, name: 'Second' })
    if (!('project' in p1) || !('project' in p2)) return
    reorderProjects({ workspaceId: wr.workspace.id, ids: [p2.project.id, p1.project.id] })
    const projects = listProjects(wr.workspace.id)
    expect(projects[0].id).toBe(p2.project.id)
  })

  it('reorderProjects returns success: false for invalid input', async () => {
    const { reorderProjects } = await import('../../../src/main/storage/workspace-store')
    const result = reorderProjects({ workspaceId: 123 })
    expect(result).toEqual({ success: false })
  })

  it('updateWorkspace returns NOT_FOUND for unknown workspace id', async () => {
    const { updateWorkspace } = await import('../../../src/main/storage/workspace-store')
    const result = updateWorkspace({ id: '00000000-0000-0000-0000-000000000002', name: 'NewName' })
    expect('error' in result && result.error).toBe('NOT_FOUND')
  })

  it('updateWorkspace returns VALIDATION_ERROR for invalid input', async () => {
    const { updateWorkspace } = await import('../../../src/main/storage/workspace-store')
    const result = updateWorkspace({ id: 123 })
    expect('error' in result && result.error).toBe('VALIDATION_ERROR')
  })

  it('updateWorkspace updates workspace name', async () => {
    const { createWorkspace, updateWorkspace } = await import(
      '../../../src/main/storage/workspace-store'
    )
    const wr = createWorkspace({ name: 'UpdateMe', folderPath: '/um', color: '#4A90E2', tags: [] })
    if (!('workspace' in wr)) return
    const result = updateWorkspace({ id: wr.workspace.id, name: 'UpdatedName' })
    expect('workspace' in result).toBe(true)
    if ('workspace' in result) expect(result.workspace.name).toBe('UpdatedName')
  })
})
