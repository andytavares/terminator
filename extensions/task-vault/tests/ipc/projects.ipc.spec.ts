import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionDB } from '../../../../src/main/extensions/api'

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
  Notification: Object.assign(
    vi.fn(() => ({ show: vi.fn() })),
    { isSupported: vi.fn(() => false) }
  ),
}))

vi.mock('../../src/notifications/task-scheduler.js', () => ({
  broadcast: vi.fn(),
}))

import { registerProjectsIpcHandlers } from '../../src/ipc/projects.ipc'

function createMockDb() {
  const mockQuery = vi.fn().mockResolvedValue([])
  const mockGet = vi.fn().mockResolvedValue(undefined)
  const mockRun = vi.fn().mockResolvedValue(undefined)
  const db: ExtensionDB = {
    query: mockQuery,
    get: mockGet,
    run: mockRun,
    exec: vi.fn().mockResolvedValue(undefined),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: ExtensionDB) => Promise<unknown>) => fn(db)),
  }
  return Object.assign(db, { mockQuery, mockGet, mockRun })
}

type MockDb = ReturnType<typeof createMockDb>
let db: MockDb

function getHandler(channel: string): (event: unknown, payload: unknown) => Promise<unknown> {
  let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
  vi.mocked(mockHandle).mockImplementation((ch, fn) => {
    if (ch === channel) handler = fn as typeof handler
  })
  registerProjectsIpcHandlers(db)
  if (!handler) throw new Error(`Handler for ${channel} not registered`)
  return handler
}

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
  db = createMockDb()
})

describe('task-vault:projects:list IPC handler', () => {
  it('registers the projects list handler', () => {
    registerProjectsIpcHandlers(db)
    const channels = vi.mocked(mockHandle).mock.calls.map((c) => c[0])
    expect(channels).toContain('task-vault:projects:list')
  })

  it('returns only active projects by default', async () => {
    db.mockQuery.mockResolvedValueOnce([makeProjectRow()])
    db.mockGet.mockResolvedValue({ c: '2' })
    const handler = getHandler('task-vault:projects:list')
    const result = (await handler({}, {})) as { projects: { status: string }[] }
    expect(result.projects.every((p) => p.status === 'active')).toBe(true)
  })

  it('returns empty list when no active projects exist', async () => {
    const handler = getHandler('task-vault:projects:list')
    const result = (await handler({}, {})) as { projects: unknown[] }
    expect(result.projects).toHaveLength(0)
  })

  it('filters by status someday', async () => {
    db.mockQuery.mockResolvedValueOnce([
      makeProjectRow({ id: 'proj-2', name: 'Beta', status: 'someday' }),
    ])
    db.mockGet.mockResolvedValue({ c: '0' })
    const handler = getHandler('task-vault:projects:list')
    const result = (await handler({}, { status: 'someday' })) as { projects: { status: string }[] }
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].status).toBe('someday')
  })

  it('marks project as stale when nextActionCount is 0', async () => {
    db.mockQuery.mockResolvedValueOnce([makeProjectRow()])
    db.mockGet.mockResolvedValue({ c: '0' })
    const handler = getHandler('task-vault:projects:list')
    const result = (await handler({}, {})) as { projects: { isStale: boolean }[] }
    expect(result.projects[0].isStale).toBe(true)
  })

  it('marks project as not stale when nextActionCount > 0', async () => {
    db.mockQuery.mockResolvedValueOnce([makeProjectRow()])
    db.mockGet.mockResolvedValue({ c: '3' })
    const handler = getHandler('task-vault:projects:list')
    const result = (await handler({}, {})) as { projects: { isStale: boolean }[] }
    expect(result.projects[0].isStale).toBe(false)
  })

  it('accepts status as an array', async () => {
    db.mockQuery.mockResolvedValueOnce([makeProjectRow({ status: 'active' })])
    db.mockGet.mockResolvedValue({ c: '1' })
    const handler = getHandler('task-vault:projects:list')
    const result = (await handler({}, { status: ['active', 'someday'] })) as { projects: unknown[] }
    expect(Array.isArray(result.projects)).toBe(true)
  })
})

describe('task-vault:projects:weekly-review IPC handler', () => {
  it('returns inbox items', async () => {
    db.mockQuery
      .mockResolvedValueOnce([
        makeTaskRow({ text: 'Inbox item 1' }),
        makeTaskRow({ text: 'Inbox item 2' }),
      ])
      .mockResolvedValueOnce([]) // activeRows
      .mockResolvedValueOnce([]) // somedayRows
      .mockResolvedValueOnce([]) // somedayTaskRows
      .mockResolvedValueOnce([]) // completedRows
      .mockResolvedValueOnce([]) // staleTaskRows
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as { inboxItems: unknown[] }
    expect(result.inboxItems.length).toBeGreaterThan(0)
  })

  it('returns active and stale projects', async () => {
    const activeRow = makeProjectRow()
    db.mockQuery
      .mockResolvedValueOnce([]) // inboxRows
      .mockResolvedValueOnce([activeRow]) // activeRows
      .mockResolvedValueOnce([]) // somedayRows
      .mockResolvedValueOnce([]) // somedayTaskRows
      .mockResolvedValueOnce([]) // completedRows
      .mockResolvedValueOnce([]) // staleTaskRows
    db.mockGet
      .mockResolvedValueOnce({ c: '0' }) // COUNT for active project → stale
      .mockResolvedValueOnce(undefined) // stale_days_threshold
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as {
      activeProjects: unknown[]
      staleProjects: unknown[]
    }
    expect(Array.isArray(result.activeProjects)).toBe(true)
    expect(Array.isArray(result.staleProjects)).toBe(true)
    expect(result.activeProjects).toHaveLength(1)
    expect(result.staleProjects).toHaveLength(1)
  })

  it('stale projects excluded from staleProjects when nextActionCount > 0', async () => {
    const activeRow = makeProjectRow()
    db.mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([activeRow])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    db.mockGet
      .mockResolvedValueOnce({ c: '2' }) // not stale
      .mockResolvedValueOnce(undefined)
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as { staleProjects: unknown[] }
    expect(result.staleProjects).toHaveLength(0)
  })

  it('returns someday projects', async () => {
    const somedayRow = makeProjectRow({ id: 'proj-2', name: 'Beta', status: 'someday' })
    db.mockQuery
      .mockResolvedValueOnce([]) // inboxRows
      .mockResolvedValueOnce([]) // activeRows
      .mockResolvedValueOnce([somedayRow]) // somedayRows
      .mockResolvedValueOnce([]) // somedayTaskRows
      .mockResolvedValueOnce([]) // completedRows
      .mockResolvedValueOnce([]) // staleTaskRows
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as { somedayProjects: unknown[] }
    expect(Array.isArray(result.somedayProjects)).toBe(true)
    expect(result.somedayProjects).toHaveLength(1)
  })

  it('somedayTasks query excludes subtasks (parent_id IS NULL filter)', async () => {
    db.mockQuery.mockResolvedValue([])
    const handler = getHandler('task-vault:projects:weekly-review')
    await handler({}, {})
    const sqls = db.mockQuery.mock.calls.map((c) => c[0] as string)
    const somedaySql = sqls.find(
      (s) => s.includes("source='someday'") && s.includes("status='open'")
    )
    expect(somedaySql).toContain('parent_id IS NULL')
  })

  it('returns prior week completed tasks', async () => {
    const completedRow = makeTaskRow({ status: 'done', text: 'Completed task' })
    db.mockQuery
      .mockResolvedValueOnce([]) // inboxRows
      .mockResolvedValueOnce([]) // activeRows
      .mockResolvedValueOnce([]) // somedayRows
      .mockResolvedValueOnce([]) // somedayTaskRows
      .mockResolvedValueOnce([completedRow]) // completedRows
      .mockResolvedValueOnce([]) // staleTaskRows
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as { completedLastWeek: unknown[] }
    expect(Array.isArray(result.completedLastWeek)).toBe(true)
    expect(result.completedLastWeek).toHaveLength(1)
  })

  it('returns null lastReviewDate when no review recorded', async () => {
    db.mockQuery.mockResolvedValue([])
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as { lastReviewDate: string | null }
    expect(result.lastReviewDate).toBeNull()
  })
})

describe('task-vault:projects:update-status IPC handler', () => {
  it('registers the update-status handler', () => {
    registerProjectsIpcHandlers(db)
    const channels = vi.mocked(mockHandle).mock.calls.map((c) => c[0])
    expect(channels).toContain('task-vault:projects:update-status')
  })

  it('returns success when project is updated', async () => {
    db.mockGet.mockResolvedValue({ id: 'proj-1' })
    const handler = getHandler('task-vault:projects:update-status')
    const result = await handler({}, { projectFilePath: 'Alpha', status: 'done' })
    expect(result).toMatchObject({ success: true })
  })

  it('returns NOT_FOUND when project does not exist', async () => {
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
    const handler = getHandler('task-vault:projects:create')
    const result = await handler({}, { name: 'New Project' })
    expect(result).toMatchObject({ success: true, filePath: 'New Project' })
    expect(db.mockRun).toHaveBeenCalled()
  })

  it('returns PROJECT_EXISTS when project already exists', async () => {
    db.mockGet.mockResolvedValue({ id: 'existing-id' })
    const handler = getHandler('task-vault:projects:create')
    const result = await handler({}, { name: 'Existing Project' })
    expect(result).toMatchObject({ error: 'PROJECT_EXISTS' })
  })

  it('creates area record when area is provided', async () => {
    const handler = getHandler('task-vault:projects:create')
    const result = await handler({}, { name: 'Work Project', area: 'Work' })
    expect(result).toMatchObject({ success: true })
    // run called for both insert area + insert project
    expect(db.mockRun).toHaveBeenCalledTimes(2)
  })

  it('returns VALIDATION_ERROR for missing name', async () => {
    const handler = getHandler('task-vault:projects:create')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

describe('task-vault:projects:delete IPC handler', () => {
  it('deletes archived project and its tasks', async () => {
    db.mockGet.mockResolvedValue({ id: 'proj-1', status: 'archived' })
    const handler = getHandler('task-vault:projects:delete')
    const result = await handler({}, { projectFilePath: 'Alpha' })
    expect(result).toMatchObject({ success: true })
  })

  it('returns MUST_ARCHIVE_FIRST for non-archived project', async () => {
    db.mockGet.mockResolvedValue({ id: 'proj-1', status: 'active' })
    const handler = getHandler('task-vault:projects:delete')
    const result = await handler({}, { projectFilePath: 'Alpha' })
    expect(result).toMatchObject({ error: 'MUST_ARCHIVE_FIRST' })
  })

  it('returns NOT_FOUND when project does not exist', async () => {
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

describe('task-vault:projects:update-area IPC handler', () => {
  it('updates area for project', async () => {
    const handler = getHandler('task-vault:projects:update-area')
    const result = await handler({}, { projectFilePath: 'Alpha', area: 'Work' })
    expect(result).toMatchObject({ success: true })
    // run called for insert area + update project
    expect(db.mockRun).toHaveBeenCalledTimes(2)
  })

  it('updates area to null when area is not provided', async () => {
    const handler = getHandler('task-vault:projects:update-area')
    const result = await handler({}, { projectFilePath: 'Alpha', area: null })
    expect(result).toMatchObject({ success: true })
    // run called once for UPDATE only
    expect(db.mockRun).toHaveBeenCalledTimes(1)
  })

  it('returns VALIDATION_ERROR when projectFilePath missing', async () => {
    const handler = getHandler('task-vault:projects:update-area')
    const result = await handler({}, { area: 'Work' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

describe('task-vault:projects:update-deadline IPC handler', () => {
  it('updates the project deadline and returns success', async () => {
    const handler = getHandler('task-vault:projects:update-deadline')
    const result = await handler({}, { projectFilePath: 'Alpha', deadline: '2026-12-31' })
    expect(result).toMatchObject({ success: true })
    expect(db.mockRun).toHaveBeenCalled()
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
    db.mockGet
      .mockResolvedValueOnce({ id: 'proj-1' }) // SELECT id FROM projects WHERE name=?
      .mockResolvedValueOnce(undefined) // SELECT id WHERE name=newName AND id!=
    const handler = getHandler('task-vault:projects:rename')
    const result = await handler({}, { projectFilePath: 'Alpha', newName: 'Beta' })
    expect(result).toMatchObject({ success: true })
    expect(db.mockRun).toHaveBeenCalled()
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
    const handler = getHandler('task-vault:projects:rename')
    const result = await handler({}, { projectFilePath: 'Ghost', newName: 'Specter' })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns PROJECT_EXISTS when new name is already taken', async () => {
    db.mockGet
      .mockResolvedValueOnce({ id: 'proj-1' }) // project found
      .mockResolvedValueOnce({ id: 'proj-2' }) // collision found
    const handler = getHandler('task-vault:projects:rename')
    const result = await handler({}, { projectFilePath: 'Alpha', newName: 'Existing' })
    expect(result).toMatchObject({ error: 'PROJECT_EXISTS' })
  })
})

describe('registerProjectsIpcHandlers dispose', () => {
  it('calls ipcMain.removeHandler for all registered channels', () => {
    const dispose = registerProjectsIpcHandlers(db)
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
