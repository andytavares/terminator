import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRun, mockGet, mockAll, mockPrepare } = vi.hoisted(() => {
  const mockRun = vi.fn().mockReturnValue({ changes: 1 })
  const mockGet = vi.fn()
  const mockAll = vi.fn().mockReturnValue([])
  const mockPrepare = vi.fn().mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
  return { mockRun, mockGet, mockAll, mockPrepare }
})

vi.mock('../../src/vault/db', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare })),
  randomUUID: vi.fn(() => 'test-uuid'),
}))

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

import {
  registerProjectsIpcHandlers,
  setVaultPath as setProjectsVaultPath,
  getVaultPath as getProjectsVaultPath,
} from '../../src/ipc/projects.ipc'

const VAULT = '/vault'

const makeProjectRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'proj-1',
  name: 'Alpha',
  status: 'active',
  area: null,
  deadline: null,
  outcome: null,
  terminator_links: '[]',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
})

const makeTaskRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  source: 'inbox',
  source_ref: null,
  text: 'Task',
  status: 'open',
  project: null,
  context: null,
  area: null,
  due_date: null,
  terminator_links: '[]',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  parent_id: null,
  sort_order: 0,
  completed_date: null,
  migrated_to: null,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockGet.mockReturnValue(undefined)
  mockAll.mockReturnValue([])
  mockRun.mockReturnValue({ changes: 1 })
  mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
  setProjectsVaultPath(VAULT)
})

function getHandler(channel: string) {
  let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
  vi.mocked(mockHandle).mockImplementation((ch, fn) => {
    if (ch === channel) handler = fn as typeof handler
  })
  registerProjectsIpcHandlers()
  if (!handler) throw new Error(`Handler for ${channel} not registered`)
  return handler
}

describe('task-vault:projects:list IPC handler', () => {
  it('registers the projects list handler', () => {
    registerProjectsIpcHandlers()
    const channels = vi.mocked(mockHandle).mock.calls.map((c) => c[0])
    expect(channels).toContain('task-vault:projects:list')
  })

  it('returns only active projects by default', async () => {
    mockAll.mockReturnValue([makeProjectRow()])
    mockGet.mockReturnValue({ c: 2 })
    const handler = getHandler('task-vault:projects:list')
    const result = (await handler({}, {})) as { projects: { status: string }[] }
    expect(result.projects.every((p) => p.status === 'active')).toBe(true)
  })

  it('returns empty list when no active projects exist', async () => {
    mockAll.mockReturnValue([])
    const handler = getHandler('task-vault:projects:list')
    const result = (await handler({}, {})) as { projects: unknown[] }
    expect(result.projects).toHaveLength(0)
  })

  it('filters by status someday', async () => {
    mockAll.mockReturnValue([makeProjectRow({ id: 'proj-2', name: 'Beta', status: 'someday' })])
    mockGet.mockReturnValue({ c: 0 })
    const handler = getHandler('task-vault:projects:list')
    const result = (await handler({}, { status: 'someday' })) as {
      projects: { status: string }[]
    }
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].status).toBe('someday')
  })

  it('marks project as stale when nextActionCount is 0', async () => {
    mockAll.mockReturnValue([makeProjectRow()])
    mockGet.mockReturnValue({ c: 0 })
    const handler = getHandler('task-vault:projects:list')
    const result = (await handler({}, {})) as { projects: { isStale: boolean }[] }
    expect(result.projects[0].isStale).toBe(true)
  })

  it('marks project as not stale when nextActionCount > 0', async () => {
    mockAll.mockReturnValue([makeProjectRow()])
    mockGet.mockReturnValue({ c: 3 })
    const handler = getHandler('task-vault:projects:list')
    const result = (await handler({}, {})) as { projects: { isStale: boolean }[] }
    expect(result.projects[0].isStale).toBe(false)
  })

  it('accepts status as an array (line 76 — Array.isArray branch)', async () => {
    mockAll.mockReturnValue([makeProjectRow({ status: 'active' })])
    mockGet.mockReturnValue({ c: 1 })
    const handler = getHandler('task-vault:projects:list')
    const result = (await handler({}, { status: ['active', 'someday'] })) as {
      projects: unknown[]
    }
    expect(Array.isArray(result.projects)).toBe(true)
  })
})

describe('task-vault:projects:weekly-review IPC handler', () => {
  it('returns inbox items', async () => {
    mockAll
      .mockReturnValueOnce([
        makeTaskRow({ text: 'Inbox item 1' }),
        makeTaskRow({ text: 'Inbox item 2' }),
      ]) // inboxRows
      .mockReturnValueOnce([]) // activeRows
      .mockReturnValueOnce([]) // somedayRows
      .mockReturnValueOnce([]) // somedayTaskRows
      .mockReturnValueOnce([]) // completedRows
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as { inboxItems: unknown[] }
    expect(result.inboxItems.length).toBeGreaterThan(0)
  })

  it('returns active and stale projects', async () => {
    const activeRow = makeProjectRow()
    mockAll
      .mockReturnValueOnce([]) // inboxRows
      .mockReturnValueOnce([activeRow]) // activeRows
      .mockReturnValueOnce([]) // somedayRows
      .mockReturnValueOnce([]) // somedayTaskRows
      .mockReturnValueOnce([]) // completedRows
    mockGet.mockReturnValue({ c: 0 }) // count for active project → stale
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as {
      activeProjects: unknown[]
      staleProjects: unknown[]
    }
    expect(Array.isArray(result.activeProjects)).toBe(true)
    expect(Array.isArray(result.staleProjects)).toBe(true)
    expect(result.activeProjects).toHaveLength(1)
    expect(result.staleProjects).toHaveLength(1) // stale because c=0
  })

  it('stale projects excluded from active when nextActionCount > 0', async () => {
    const activeRow = makeProjectRow()
    mockAll
      .mockReturnValueOnce([])
      .mockReturnValueOnce([activeRow])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
    mockGet.mockReturnValue({ c: 2 }) // not stale
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as { staleProjects: unknown[] }
    expect(result.staleProjects).toHaveLength(0)
  })

  it('returns someday projects', async () => {
    const somedayRow = makeProjectRow({ id: 'proj-2', name: 'Beta', status: 'someday' })
    mockAll
      .mockReturnValueOnce([]) // inboxRows
      .mockReturnValueOnce([]) // activeRows
      .mockReturnValueOnce([somedayRow]) // somedayRows
      .mockReturnValueOnce([]) // somedayTaskRows
      .mockReturnValueOnce([]) // completedRows
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as { somedayProjects: unknown[] }
    expect(Array.isArray(result.somedayProjects)).toBe(true)
    expect(result.somedayProjects).toHaveLength(1)
  })

  it('somedayTasks query excludes subtasks (parent_id IS NULL filter)', async () => {
    mockAll.mockReturnValue([])
    const handler = getHandler('task-vault:projects:weekly-review')
    await handler({}, {})
    const sqls = vi.mocked(mockPrepare).mock.calls.map((c) => c[0] as string)
    const somedaySql = sqls.find((s) => s.includes("source='someday'"))
    expect(somedaySql).toContain('parent_id IS NULL')
  })

  it('returns prior week completed tasks', async () => {
    const completedRow = makeTaskRow({ status: 'done', text: 'Completed task' })
    mockAll
      .mockReturnValueOnce([]) // inboxRows
      .mockReturnValueOnce([]) // activeRows
      .mockReturnValueOnce([]) // somedayRows
      .mockReturnValueOnce([]) // somedayTaskRows
      .mockReturnValueOnce([completedRow]) // completedRows
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as { completedLastWeek: unknown[] }
    expect(Array.isArray(result.completedLastWeek)).toBe(true)
    expect(result.completedLastWeek).toHaveLength(1)
  })

  it('returns null lastReviewDate when no review recorded', async () => {
    mockAll.mockReturnValue([]) // covers all remaining calls
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as { lastReviewDate: string | null }
    expect(result.lastReviewDate).toBeNull()
  })
})

describe('task-vault:projects:update-status IPC handler', () => {
  it('registers the update-status handler', () => {
    registerProjectsIpcHandlers()
    const channels = vi.mocked(mockHandle).mock.calls.map((c) => c[0])
    expect(channels).toContain('task-vault:projects:update-status')
  })

  it('returns success when project is updated', async () => {
    mockGet.mockReturnValue({ id: 'proj-1' })
    const handler = getHandler('task-vault:projects:update-status')
    const result = await handler({}, { projectFilePath: 'Alpha', status: 'done' })
    expect(result).toMatchObject({ success: true })
  })

  it('returns NOT_FOUND when project does not exist', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:projects:update-status')
    const result = await handler({}, { projectFilePath: 'nonexistent', status: 'done' })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const handler = getHandler('task-vault:projects:update-status')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

describe('task-vault:projects:create IPC handler', () => {
  it('creates a new project and returns success', async () => {
    mockGet.mockReturnValue(undefined) // no existing project
    const handler = getHandler('task-vault:projects:create')
    const result = await handler({}, { name: 'New Project' })
    expect(result).toMatchObject({ success: true, filePath: 'New Project' })
    expect(mockRun).toHaveBeenCalled()
  })

  it('returns PROJECT_EXISTS when project already exists', async () => {
    mockGet.mockReturnValue({ id: 'existing-id' })
    const handler = getHandler('task-vault:projects:create')
    const result = await handler({}, { name: 'Existing Project' })
    expect(result).toMatchObject({ error: 'PROJECT_EXISTS' })
  })

  it('creates area record when area is provided', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:projects:create')
    const result = await handler({}, { name: 'Work Project', area: 'Work' })
    expect(result).toMatchObject({ success: true })
    // run called for both insert project + insert area
    expect(mockRun).toHaveBeenCalledTimes(2)
  })

  it('returns VALIDATION_ERROR for missing name', async () => {
    const handler = getHandler('task-vault:projects:create')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

describe('task-vault:projects:delete IPC handler', () => {
  it('deletes archived project and its tasks', async () => {
    mockGet.mockReturnValue({ id: 'proj-1', status: 'archived' })
    const handler = getHandler('task-vault:projects:delete')
    const result = await handler({}, { projectFilePath: 'Alpha' })
    expect(result).toMatchObject({ success: true })
  })

  it('returns MUST_ARCHIVE_FIRST for non-archived project', async () => {
    mockGet.mockReturnValue({ id: 'proj-1', status: 'active' })
    const handler = getHandler('task-vault:projects:delete')
    const result = await handler({}, { projectFilePath: 'Alpha' })
    expect(result).toMatchObject({ error: 'MUST_ARCHIVE_FIRST' })
  })

  it('returns NOT_FOUND when project does not exist', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:projects:delete')
    const result = await handler({}, { projectFilePath: 'Ghost' })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for missing projectFilePath', async () => {
    const handler = getHandler('task-vault:projects:delete')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

describe('task-vault:projects:update-area IPC handler (lines 206-225)', () => {
  it('updates area for project', async () => {
    const handler = getHandler('task-vault:projects:update-area')
    const result = await handler({}, { projectFilePath: 'Alpha', area: 'Work' })
    expect(result).toMatchObject({ success: true })
    // run once for UPDATE projects, once for INSERT area
    expect(mockRun).toHaveBeenCalledTimes(2)
  })

  it('updates area to null when area is not provided', async () => {
    const handler = getHandler('task-vault:projects:update-area')
    const result = await handler({}, { projectFilePath: 'Alpha', area: null })
    expect(result).toMatchObject({ success: true })
    // run called once for UPDATE only (no area insert when null)
    expect(mockRun).toHaveBeenCalledTimes(1)
  })

  it('returns VALIDATION_ERROR when projectFilePath missing', async () => {
    const handler = getHandler('task-vault:projects:update-area')
    const result = await handler({}, { area: 'Work' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

describe('getVaultPath (projects.ipc)', () => {
  it('returns the vault path set via setVaultPath', () => {
    setProjectsVaultPath('/projects/vault')
    expect(getProjectsVaultPath()).toBe('/projects/vault')
    setProjectsVaultPath(VAULT) // restore
  })
})

describe('task-vault:projects:update-deadline IPC handler', () => {
  it('updates the project deadline and returns success', async () => {
    const handler = getHandler('task-vault:projects:update-deadline')
    const result = await handler({}, { projectFilePath: 'Alpha', deadline: '2026-12-31' })
    expect(result).toMatchObject({ success: true })
    expect(mockRun).toHaveBeenCalled()
  })

  it('clears the deadline when passed null', async () => {
    const handler = getHandler('task-vault:projects:update-deadline')
    const result = await handler({}, { projectFilePath: 'Alpha', deadline: null })
    expect(result).toMatchObject({ success: true })
  })

  it('returns VALIDATION_ERROR when projectFilePath is missing', async () => {
    const handler = getHandler('task-vault:projects:update-deadline')
    const result = await handler({}, { deadline: '2026-12-31' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

describe('task-vault:projects:rename IPC handler', () => {
  it('renames the project and returns success', async () => {
    mockGet
      .mockReturnValueOnce({ id: 'proj-1' }) // SELECT id FROM projects WHERE name=?
      .mockReturnValueOnce(undefined) // SELECT id WHERE name=newName AND id!=
    const handler = getHandler('task-vault:projects:rename')
    const result = await handler({}, { projectFilePath: 'Alpha', newName: 'Beta' })
    expect(result).toMatchObject({ success: true })
    expect(mockRun).toHaveBeenCalled()
  })

  it('returns VALIDATION_ERROR when projectFilePath is missing', async () => {
    const handler = getHandler('task-vault:projects:rename')
    const result = await handler({}, { newName: 'Beta' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('returns VALIDATION_ERROR when newName is missing', async () => {
    const handler = getHandler('task-vault:projects:rename')
    const result = await handler({}, { projectFilePath: 'Alpha' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('returns NOT_FOUND when project does not exist', async () => {
    mockGet.mockReturnValueOnce(undefined)
    const handler = getHandler('task-vault:projects:rename')
    const result = await handler({}, { projectFilePath: 'Ghost', newName: 'Specter' })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns PROJECT_EXISTS when new name is already taken', async () => {
    mockGet
      .mockReturnValueOnce({ id: 'proj-1' }) // project found
      .mockReturnValueOnce({ id: 'proj-2' }) // collision found
    const handler = getHandler('task-vault:projects:rename')
    const result = await handler({}, { projectFilePath: 'Alpha', newName: 'Existing' })
    expect(result).toMatchObject({ error: 'PROJECT_EXISTS' })
  })
})

describe('registerProjectsIpcHandlers dispose (lines 229-232)', () => {
  it('calls ipcMain.removeHandler for all registered channels', () => {
    const dispose = registerProjectsIpcHandlers()
    dispose()
    const removedChannels = vi.mocked(mockRemoveHandler).mock.calls.map((c) => c[0])
    expect(removedChannels).toContain('task-vault:projects:list')
    expect(removedChannels).toContain('task-vault:projects:create')
    expect(removedChannels).toContain('task-vault:projects:delete')
    expect(removedChannels).toContain('task-vault:projects:update-status')
    expect(removedChannels).toContain('task-vault:projects:update-area')
    expect(removedChannels).toContain('task-vault:projects:update-deadline')
    expect(removedChannels).toContain('task-vault:projects:rename')
  })
})
