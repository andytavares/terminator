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
      .mockReturnValueOnce([]) // completedRows
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as { somedayProjects: unknown[] }
    expect(Array.isArray(result.somedayProjects)).toBe(true)
    expect(result.somedayProjects).toHaveLength(1)
  })

  it('returns prior week completed tasks', async () => {
    const completedRow = makeTaskRow({ status: 'done', text: 'Completed task' })
    mockAll
      .mockReturnValueOnce([]) // inboxRows
      .mockReturnValueOnce([]) // activeRows
      .mockReturnValueOnce([]) // somedayRows
      .mockReturnValueOnce([completedRow]) // completedRows
    const handler = getHandler('task-vault:projects:weekly-review')
    const result = (await handler({}, {})) as { completedLastWeek: unknown[] }
    expect(Array.isArray(result.completedLastWeek)).toBe(true)
    expect(result.completedLastWeek).toHaveLength(1)
  })

  it('returns null lastReviewDate when no review recorded', async () => {
    mockAll.mockReturnValue([])
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
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:projects:update-status')
    const result = await handler({}, { projectFilePath: 'Alpha', status: 'done' })
    expect(result).toMatchObject({ success: true })
  })

  it('returns NOT_FOUND when project does not exist', async () => {
    mockRun.mockReturnValue({ changes: 0 })
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
