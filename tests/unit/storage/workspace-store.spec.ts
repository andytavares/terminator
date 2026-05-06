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
})
