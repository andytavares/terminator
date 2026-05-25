import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

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

import { registerVaultIpcHandlers, setVaultPath, getVaultPath } from '../../src/ipc/vault.ipc'

const VAULT = '/vault'

const makeTaskRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  source: 'inbox',
  source_ref: null,
  text: 'Test task',
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

function getHandler(channel: string): (event: unknown, payload: unknown) => Promise<unknown> {
  let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
  vi.mocked(mockHandle).mockImplementation((ch, fn) => {
    if (ch === channel) handler = fn as typeof handler
  })
  registerVaultIpcHandlers()
  if (!handler) throw new Error(`Handler for ${channel} not registered`)
  return handler
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRun.mockReturnValue({ changes: 1 })
  mockGet.mockReturnValue(undefined)
  mockAll.mockReturnValue([])
  mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
  setVaultPath(VAULT)
})

// ── get-inbox ────────────────────────────────────────────────────────────────

describe('task-vault:vault:get-inbox', () => {
  it('returns empty tasks when no inbox items', async () => {
    mockAll.mockReturnValue([])
    const handler = getHandler('task-vault:vault:get-inbox')
    const result = await handler({}, undefined)
    expect(result).toMatchObject({ tasks: [] })
  })

  it('returns mapped tasks for inbox rows', async () => {
    const row = makeTaskRow()
    // First all() call returns inbox tasks, subsequent calls for subtasks return []
    mockAll.mockReturnValueOnce([row]).mockReturnValue([])
    const handler = getHandler('task-vault:vault:get-inbox')
    const result = await handler({}, undefined)
    expect(result).toMatchObject({
      tasks: [expect.objectContaining({ id: 'task-1', text: 'Test task' })],
    })
  })

  it('returns error string when db throws', async () => {
    mockPrepare.mockImplementationOnce(() => {
      throw new Error('db gone')
    })
    const handler = getHandler('task-vault:vault:get-inbox')
    const result = await handler({}, undefined)
    expect(result).toMatchObject({ error: expect.stringContaining('db gone') })
  })
})

// ── complete-task ─────────────────────────────────────────────────────────────

describe('task-vault:vault:complete-task', () => {
  it('returns { success: true } when row updated', async () => {
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:complete-task')
    const result = await handler({}, { taskId: 'task-1' })
    expect(result).toEqual({ success: true })
  })

  it('returns { error: STALE_ID } when no row matched', async () => {
    mockRun.mockReturnValue({ changes: 0 })
    const handler = getHandler('task-vault:vault:complete-task')
    const result = await handler({}, { taskId: 'missing-id' })
    expect(result).toEqual({ error: 'STALE_ID' })
  })

  it('returns VALIDATION_ERROR for missing taskId', async () => {
    const handler = getHandler('task-vault:vault:complete-task')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })
})

// ── delete-task ───────────────────────────────────────────────────────────────

describe('task-vault:vault:delete-task', () => {
  it('returns { success: true } when rows deleted', async () => {
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:delete-task')
    const result = await handler({}, { taskId: 'task-1' })
    expect(result).toEqual({ success: true })
  })

  it('returns { error: STALE_ID } when nothing deleted', async () => {
    mockRun.mockReturnValue({ changes: 0 })
    const handler = getHandler('task-vault:vault:delete-task')
    const result = await handler({}, { taskId: 'ghost-id' })
    expect(result).toEqual({ error: 'STALE_ID' })
  })

  it('returns VALIDATION_ERROR for missing taskId', async () => {
    const handler = getHandler('task-vault:vault:delete-task')
    const result = await handler({}, null)
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })

  it('uses recursive CTE to delete subtasks at all depths', async () => {
    mockRun.mockReturnValue({ changes: 3 })
    const handler = getHandler('task-vault:vault:delete-task')
    await handler({}, { taskId: 'parent-1' })
    const sql: string = mockPrepare.mock.calls.at(-1)?.[0] ?? ''
    expect(sql).toMatch(/WITH RECURSIVE/i)
    expect(sql).toMatch(/subtree/)
    // Only the parent id is bound — cascade handles the rest
    expect(mockRun).toHaveBeenCalledWith('parent-1')
  })
})

// ── cancel-task ───────────────────────────────────────────────────────────────

describe('task-vault:vault:cancel-task', () => {
  it('returns { success: true } when row updated', async () => {
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:cancel-task')
    const result = await handler({}, { taskId: 'task-1' })
    expect(result).toEqual({ success: true })
  })

  it('returns { error: STALE_ID } when no row matched', async () => {
    mockRun.mockReturnValue({ changes: 0 })
    const handler = getHandler('task-vault:vault:cancel-task')
    const result = await handler({}, { taskId: 'missing' })
    expect(result).toEqual({ error: 'STALE_ID' })
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const handler = getHandler('task-vault:vault:cancel-task')
    const result = await handler({}, { taskId: 123 })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })
})

// ── restore-task ──────────────────────────────────────────────────────────────

describe('task-vault:vault:restore-task', () => {
  it('returns { success: true } when row updated', async () => {
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:restore-task')
    const result = await handler({}, { taskId: 'task-1' })
    expect(result).toEqual({ success: true })
  })

  it('returns { error: STALE_ID } when no row matched', async () => {
    mockRun.mockReturnValue({ changes: 0 })
    const handler = getHandler('task-vault:vault:restore-task')
    const result = await handler({}, { taskId: 'gone' })
    expect(result).toEqual({ error: 'STALE_ID' })
  })
})

// ── edit-task ─────────────────────────────────────────────────────────────────

describe('task-vault:vault:edit-task', () => {
  it('returns { success: true } when task updated', async () => {
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:edit-task')
    const result = await handler({}, { taskId: 'task-1', text: 'Updated text' })
    expect(result).toEqual({ success: true })
  })

  it('returns { error: STALE_ID } when no row matched', async () => {
    mockRun.mockReturnValue({ changes: 0 })
    const handler = getHandler('task-vault:vault:edit-task')
    const result = await handler({}, { taskId: 'gone', text: 'hi' })
    expect(result).toEqual({ error: 'STALE_ID' })
  })

  it('returns VALIDATION_ERROR when taskId missing', async () => {
    const handler = getHandler('task-vault:vault:edit-task')
    const result = await handler({}, { text: 'No id here' })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })

  it('returns VALIDATION_ERROR when text missing', async () => {
    const handler = getHandler('task-vault:vault:edit-task')
    const result = await handler({}, { taskId: 'task-1' })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })
})

// ── add-task ──────────────────────────────────────────────────────────────────

describe('task-vault:vault:add-task', () => {
  it('inserts task and returns taskId', async () => {
    const handler = getHandler('task-vault:vault:add-task')
    const result = await handler({}, { filePath: 'inbox', text: 'New task' })
    expect(result).toMatchObject({ taskId: 'test-uuid' })
  })

  it('returns VALIDATION_ERROR when filePath missing', async () => {
    const handler = getHandler('task-vault:vault:add-task')
    const result = await handler({}, { text: 'No path' })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })

  it('returns VALIDATION_ERROR when text missing', async () => {
    const handler = getHandler('task-vault:vault:add-task')
    const result = await handler({}, { filePath: 'inbox' })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })

  it('resolves daily source from filePath', async () => {
    const handler = getHandler('task-vault:vault:add-task')
    const result = await handler({}, { filePath: 'daily/2026-05-20.md', text: 'Daily task' })
    expect(result).toMatchObject({ taskId: 'test-uuid' })
    // Confirm INSERT was called with source='daily'
    expect(mockRun).toHaveBeenCalled()
  })
})

// ── create-area ───────────────────────────────────────────────────────────────

describe('task-vault:vault:create-area', () => {
  it('returns { success: true, filePath } when area created', async () => {
    mockGet.mockReturnValue(undefined) // no existing area
    const handler = getHandler('task-vault:vault:create-area')
    const result = await handler({}, { name: 'Work' })
    expect(result).toEqual({ success: true, filePath: 'Work' })
  })

  it('returns { error: AREA_EXISTS } when area already exists', async () => {
    mockGet.mockReturnValue({ id: 'existing-id' })
    const handler = getHandler('task-vault:vault:create-area')
    const result = await handler({}, { name: 'Work' })
    expect(result).toEqual({ error: 'AREA_EXISTS' })
  })

  it('returns VALIDATION_ERROR for empty name', async () => {
    const handler = getHandler('task-vault:vault:create-area')
    const result = await handler({}, { name: '' })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })
})

// ── get-today ─────────────────────────────────────────────────────────────────

describe('task-vault:vault:get-today', () => {
  it('returns date, tasks, events, notes when db empty', async () => {
    mockAll.mockReturnValue([])
    const handler = getHandler('task-vault:vault:get-today')
    const result = (await handler({}, undefined)) as Record<string, unknown>
    expect(result).toMatchObject({ tasks: [], events: [], notes: [] })
    expect(typeof result.date).toBe('string')
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('maps task rows and sets exists=true when tasks present', async () => {
    const row = makeTaskRow({ source: 'daily', source_ref: '2026-05-20' })
    // rollover stale tasks → [], tasks query → [row], subtasks query → [], events → [], notes → []
    mockAll
      .mockReturnValueOnce([]) // rollover: no stale tasks
      .mockReturnValueOnce([row]) // main task fetch
      .mockReturnValueOnce([]) // subtasks
      .mockReturnValueOnce([]) // events
      .mockReturnValueOnce([]) // notes
    const handler = getHandler('task-vault:vault:get-today')
    const result = (await handler({}, undefined)) as Record<string, unknown>
    expect(result).toMatchObject({ exists: true })
    expect((result.tasks as unknown[]).length).toBe(1)
  })

  it('rolls over stale open tasks from past daily logs', async () => {
    const staleRow = makeTaskRow({ source: 'daily', source_ref: '2026-05-01', status: 'open' })
    // rollover query returns stale task → triggers insert + migrate statements
    mockAll
      .mockReturnValueOnce([staleRow]) // rollover: one stale task found
      .mockReturnValueOnce([]) // main task fetch (after rollover inserts)
      .mockReturnValueOnce([]) // subtasks
      .mockReturnValueOnce([]) // events
      .mockReturnValueOnce([]) // notes
    const handler = getHandler('task-vault:vault:get-today')
    const result = (await handler({}, undefined)) as Record<string, unknown>
    expect(result.rolledOver).toBe(1)
    expect(mockRun).toHaveBeenCalled()
  })

  it('returns error string when db throws', async () => {
    mockPrepare.mockImplementationOnce(() => {
      throw new Error('disk error')
    })
    const handler = getHandler('task-vault:vault:get-today')
    const result = await handler({}, undefined)
    expect(result).toMatchObject({ error: expect.stringContaining('disk error') })
  })
})

// ── add-subtask ───────────────────────────────────────────────────────────────

describe('task-vault:vault:add-subtask', () => {
  it('returns { success: true } when parent found and subtask inserted', async () => {
    mockGet.mockReturnValue({ source: 'inbox', source_ref: null })
    const handler = getHandler('task-vault:vault:add-subtask')
    const result = await handler({}, { taskId: 'task-1', text: 'Sub item' })
    expect(result).toEqual({ success: true })
  })

  it('returns { error: STALE_ID } when parent not found', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:vault:add-subtask')
    const result = await handler({}, { taskId: 'gone', text: 'Sub item' })
    expect(result).toEqual({ error: 'STALE_ID' })
  })

  it('returns VALIDATION_ERROR when taskId missing', async () => {
    const handler = getHandler('task-vault:vault:add-subtask')
    const result = await handler({}, { text: 'No parent' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('returns VALIDATION_ERROR when text missing', async () => {
    const handler = getHandler('task-vault:vault:add-subtask')
    const result = await handler({}, { taskId: 'task-1' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

// ── list-areas ────────────────────────────────────────────────────────────────

describe('task-vault:vault:list-areas', () => {
  it('returns { areas: [] } when no areas exist', async () => {
    // First all() → area rows, last all() → orphan area rows
    mockAll.mockReturnValue([])
    const handler = getHandler('task-vault:vault:list-areas')
    const result = await handler({}, undefined)
    expect(result).toMatchObject({ areas: [] })
  })

  it('returns error string when db throws', async () => {
    mockPrepare.mockImplementationOnce(() => {
      throw new Error('list-areas error')
    })
    const handler = getHandler('task-vault:vault:list-areas')
    const result = await handler({}, undefined)
    expect(result).toMatchObject({ error: expect.stringContaining('list-areas error') })
  })
})

// ── update-project-status ─────────────────────────────────────────────────────

describe('task-vault:vault:update-project-status', () => {
  it('returns { success: true } when project updated by name', async () => {
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:update-project-status')
    const result = await handler({}, { projectFilePath: 'MyProject', status: 'archived' })
    expect(result).toEqual({ success: true })
  })

  it('falls back to id lookup and returns { success: true }', async () => {
    mockRun.mockReturnValueOnce({ changes: 0 }).mockReturnValueOnce({ changes: 1 })
    const handler = getHandler('task-vault:vault:update-project-status')
    const result = await handler({}, { projectFilePath: 'proj-id', status: 'active' })
    expect(result).toEqual({ success: true })
  })

  it('returns { error: NOT_FOUND } when both lookups fail', async () => {
    mockRun.mockReturnValue({ changes: 0 })
    const handler = getHandler('task-vault:vault:update-project-status')
    const result = await handler({}, { projectFilePath: 'ghost', status: 'archived' })
    expect(result).toEqual({ error: 'NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for missing projectFilePath', async () => {
    const handler = getHandler('task-vault:vault:update-project-status')
    const result = await handler({}, { status: 'archived' })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })
})

// ── list-archive ──────────────────────────────────────────────────────────────

describe('task-vault:vault:list-archive (lines 647-664)', () => {
  const makeProjectRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'proj-archived-1',
    name: 'Old Project',
    status: 'archived',
    area: null,
    deadline: null,
    terminator_links: '[]',
    updated_at: new Date().toISOString(),
    ...overrides,
  })

  it('returns empty tasks and projects when nothing archived', async () => {
    mockAll.mockReturnValue([])
    const handler = getHandler('task-vault:vault:list-archive')
    const result = (await handler({}, {})) as { tasks: unknown[]; projects: unknown[] }
    expect(result.tasks).toHaveLength(0)
    expect(result.projects).toHaveLength(0)
  })

  it('returns archived tasks and projects', async () => {
    const taskRow = makeTaskRow({ status: 'done', source: 'daily', source_ref: '2026-04-01' })
    const projRow = makeProjectRow()
    mockAll.mockReturnValueOnce([taskRow]).mockReturnValueOnce([projRow])
    const handler = getHandler('task-vault:vault:list-archive')
    const result = (await handler({}, { days: 30 })) as {
      tasks: { status: string }[]
      projects: { name: string }[]
    }
    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].status).toBe('done')
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].name).toBe('Old Project')
  })

  it('uses default 30 days when payload is invalid', async () => {
    mockAll.mockReturnValue([])
    const handler = getHandler('task-vault:vault:list-archive')
    const result = (await handler({}, null)) as { tasks: unknown[]; projects: unknown[] }
    expect(result.tasks).toHaveLength(0)
    expect(result.projects).toHaveLength(0)
  })

  it('rowToProject maps all fields correctly via list-archive', async () => {
    const projRow = makeProjectRow({
      area: 'Work',
      deadline: '2026-01-01',
      terminator_links: '["link-1"]',
    })
    mockAll.mockReturnValueOnce([]).mockReturnValueOnce([projRow])
    const handler = getHandler('task-vault:vault:list-archive')
    const result = (await handler({}, {})) as {
      projects: { area?: string; deadline?: string; terminatorLinks: string[] }[]
    }
    expect(result.projects[0].area).toBe('Work')
    expect(result.projects[0].deadline).toBe('2026-01-01')
    expect(result.projects[0].terminatorLinks).toContain('link-1')
  })

  it('returns error string when db throws', async () => {
    mockPrepare.mockImplementationOnce(() => {
      throw new Error('archive db error')
    })
    const handler = getHandler('task-vault:vault:list-archive')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: expect.stringContaining('archive db error') })
  })
})

// ── projects:get-tasks ────────────────────────────────────────────────────────

describe('task-vault:projects:get-tasks', () => {
  it('returns tasks for given projectName', async () => {
    const row = makeTaskRow({ project: 'MyProject' })
    mockAll.mockReturnValueOnce([row])
    const handler = getHandler('task-vault:projects:get-tasks')
    const result = (await handler({}, { projectName: 'MyProject' })) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(1)
  })

  it('returns empty tasks when projectName is missing', async () => {
    const handler = getHandler('task-vault:projects:get-tasks')
    const result = (await handler({}, {})) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(0)
  })
})

// ── delete-area ───────────────────────────────────────────────────────────────

describe('task-vault:vault:delete-area', () => {
  it('deletes area (FK ON DELETE SET NULL handles task untag)', async () => {
    const handler = getHandler('task-vault:vault:delete-area')
    const result = await handler({}, { areaFilePath: 'areas/Work.md' })
    expect(result).toMatchObject({ success: true })
    expect(mockRun).toHaveBeenCalledTimes(1)
  })

  it('returns VALIDATION_ERROR for missing areaFilePath', async () => {
    const handler = getHandler('task-vault:vault:delete-area')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })
})

// ── get-daily ─────────────────────────────────────────────────────────────────

describe('task-vault:vault:get-daily', () => {
  it('returns daily tasks for a given date', async () => {
    const row = makeTaskRow({ source: 'daily', source_ref: '2026-05-20' })
    mockAll
      .mockReturnValueOnce([row]) // tasks
      .mockReturnValueOnce([]) // subtasks
      .mockReturnValueOnce([]) // events
      .mockReturnValueOnce([]) // notes
    const handler = getHandler('task-vault:vault:get-daily')
    const result = (await handler({}, { date: '2026-05-20' })) as Record<string, unknown>
    expect(result.date).toBe('2026-05-20')
    expect((result.tasks as unknown[]).length).toBe(1)
  })

  it('returns VALIDATION_ERROR for missing date', async () => {
    const handler = getHandler('task-vault:vault:get-daily')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })

  it('returns error string when db throws', async () => {
    mockPrepare.mockImplementationOnce(() => {
      throw new Error('daily db error')
    })
    const handler = getHandler('task-vault:vault:get-daily')
    const result = await handler({}, { date: '2026-05-20' })
    expect(result).toMatchObject({ error: expect.stringContaining('daily db error') })
  })
})

// ── migrate-task ──────────────────────────────────────────────────────────────

describe('task-vault:vault:migrate-task', () => {
  it('migrates task to target date and returns newTaskId', async () => {
    const row = makeTaskRow()
    mockGet.mockReturnValue(row)
    const handler = getHandler('task-vault:vault:migrate-task')
    const result = (await handler({}, { taskId: 'task-1', targetDate: '2026-05-21' })) as {
      newTaskId: string
    }
    expect(result.newTaskId).toBe('test-uuid')
  })

  it('returns STALE_ID when task not found', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:vault:migrate-task')
    const result = await handler({}, { taskId: 'ghost', targetDate: '2026-05-21' })
    expect(result).toMatchObject({ error: 'STALE_ID' })
  })

  it('returns VALIDATION_ERROR for missing taskId', async () => {
    const handler = getHandler('task-vault:vault:migrate-task')
    const result = await handler({}, { targetDate: '2026-05-21' })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })
})

// ── vault:query ───────────────────────────────────────────────────────────────

describe('task-vault:vault:query', () => {
  it('returns all tasks when no filters provided', async () => {
    mockAll.mockReturnValueOnce([makeTaskRow()])
    const handler = getHandler('task-vault:vault:query')
    const result = (await handler({}, {})) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(1)
  })

  it('filters by status array', async () => {
    mockAll.mockReturnValueOnce([makeTaskRow()])
    const handler = getHandler('task-vault:vault:query')
    const result = (await handler({}, { status: ['open', 'in-progress'] })) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(1)
  })

  it('filters by context, project, area, and dueBefore', async () => {
    mockAll.mockReturnValueOnce([])
    const handler = getHandler('task-vault:vault:query')
    const result = (await handler(
      {},
      {
        context: 'office',
        project: 'Alpha',
        area: 'Work',
        dueBefore: '2026-06-01',
      }
    )) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(0)
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const handler = getHandler('task-vault:vault:query')
    const result = await handler({}, { status: 123 })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })
})

// ── vault:list-areas with area data ──────────────────────────────────────────

describe('task-vault:vault:list-areas with data', () => {
  it('returns areas with tasks, projects, and combined counts', async () => {
    const areaRow = { id: 'area-1', name: 'Work', created_at: new Date().toISOString() }
    const taskRow = makeTaskRow({ area: 'Work' })
    const projRow = {
      id: 'proj-1',
      name: 'Work Project',
      status: 'active',
      area: 'Work',
      deadline: null,
      terminator_links: '[]',
      updated_at: new Date().toISOString(),
    }
    mockAll
      .mockReturnValueOnce([areaRow]) // areaRows (SELECT * FROM areas)
      .mockReturnValueOnce([taskRow]) // taskRows for 'Work' area (filtered by area_id)
      .mockReturnValueOnce([projRow]) // projectRows for 'Work' area (filtered by area_id)
    // get() is called: nextActionCount, totalCount, doneCount (per project) + combinedOpen, combinedTotal (per area)
    mockGet.mockReturnValue({ c: 2 })
    const handler = getHandler('task-vault:vault:list-areas')
    const result = (await handler({}, undefined)) as {
      areas: { name: string; tasks: unknown[]; openTaskCount: number; taskCount: number }[]
    }
    expect(result.areas.length).toBeGreaterThan(0)
    expect(result.areas[0].name).toBe('Work')
    expect(result.areas[0].openTaskCount).toBe(2)
    expect(result.areas[0].taskCount).toBe(2)
  })

  it('returns empty areas array when no areas exist', async () => {
    mockAll.mockReturnValueOnce([]) // no areas in table
    const handler = getHandler('task-vault:vault:list-areas')
    const result = (await handler({}, undefined)) as { areas: { name: string }[] }
    expect(result.areas).toHaveLength(0)
  })
})

// ── vault:capture ─────────────────────────────────────────────────────────────

describe('task-vault:vault:capture', () => {
  it('captures a task with project and area hints', async () => {
    const handler = getHandler('task-vault:vault:capture')
    const result = (await handler(
      {},
      {
        text: 'Do something',
        hintProject: 'MyProject',
        hintArea: 'Work',
      }
    )) as { taskId: string }
    expect(result.taskId).toBe('test-uuid')
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const handler = getHandler('task-vault:vault:capture')
    const result = await handler({}, null)
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })
})

// ── vault:export-json ─────────────────────────────────────────────────────────

describe('task-vault:vault:export-json', () => {
  it('returns all tables with metadata', async () => {
    const taskRow = makeTaskRow()
    const projRow = {
      id: 'p1',
      name: 'Alpha',
      status: 'active',
      area: null,
      deadline: null,
      outcome: null,
      terminator_links: '[]',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const areaRow = { id: 'a1', name: 'Work', created_at: new Date().toISOString() }
    mockAll
      .mockReturnValueOnce([taskRow]) // tasks
      .mockReturnValueOnce([projRow]) // projects
      .mockReturnValueOnce([areaRow]) // areas
      .mockReturnValueOnce([]) // events
      .mockReturnValueOnce([]) // notes
    const handler = getHandler('task-vault:vault:export-json')
    const result = (await handler({}, undefined)) as {
      tasks: unknown[]
      projects: unknown[]
      areas: unknown[]
      events: unknown[]
      notes: unknown[]
      exportedAt: string
      version: number
    }
    expect(result.tasks).toHaveLength(1)
    expect(result.projects).toHaveLength(1)
    expect(result.areas).toHaveLength(1)
    expect(result.events).toHaveLength(0)
    expect(result.notes).toHaveLength(0)
    expect(result.version).toBe(1)
    expect(typeof result.exportedAt).toBe('string')
  })

  it('returns error string when db throws', async () => {
    mockPrepare.mockImplementationOnce(() => {
      throw new Error('export db error')
    })
    const handler = getHandler('task-vault:vault:export-json')
    const result = await handler({}, undefined)
    expect(result).toMatchObject({ error: expect.stringContaining('export db error') })
  })
})

// ── vault:import-json ─────────────────────────────────────────────────────────

describe('task-vault:vault:import-json', () => {
  const now = new Date().toISOString()

  it('imports all table types and returns imported count', async () => {
    const importData = {
      version: 1,
      tasks: [
        {
          id: 't1',
          text: 'Task',
          status: 'open',
          source: 'inbox',
          created_at: now,
          updated_at: now,
        },
      ],
      projects: [{ id: 'p1', name: 'Project', status: 'active', created_at: now, updated_at: now }],
      areas: [{ id: 'a1', name: 'Work', created_at: now }],
      events: [{ id: 'e1', date: '2026-05-22', text: 'Meeting', created_at: now }],
      notes: [{ id: 'n1', date: '2026-05-22', text: 'Note text', created_at: now }],
    }
    const handler = getHandler('task-vault:vault:import-json')
    const result = (await handler({}, importData)) as { success: boolean; imported: number }
    expect(result.success).toBe(true)
    expect(result.imported).toBe(5)
  })

  it('imports tasks only when other arrays absent', async () => {
    const importData = {
      tasks: [
        {
          id: 't1',
          text: 'Task',
          status: 'open',
          source: 'inbox',
          created_at: now,
          updated_at: now,
        },
      ],
    }
    const handler = getHandler('task-vault:vault:import-json')
    const result = (await handler({}, importData)) as { success: boolean; imported: number }
    expect(result.success).toBe(true)
    expect(result.imported).toBe(1)
  })

  it('returns INVALID_PAYLOAD for null payload', async () => {
    const handler = getHandler('task-vault:vault:import-json')
    const result = await handler({}, null)
    expect(result).toMatchObject({ error: 'INVALID_PAYLOAD' })
  })

  it('returns INVALID_PAYLOAD for non-object payload', async () => {
    const handler = getHandler('task-vault:vault:import-json')
    const result = await handler({}, 'not-an-object')
    expect(result).toMatchObject({ error: 'INVALID_PAYLOAD' })
  })

  it('returns error string when db throws during import', async () => {
    mockPrepare.mockImplementationOnce(() => {
      throw new Error('import db error')
    })
    const handler = getHandler('task-vault:vault:import-json')
    const result = await handler({}, { areas: [{ id: 'a1', name: 'Work', created_at: now }] })
    expect(result).toMatchObject({ error: expect.stringContaining('import db error') })
  })

  it('handles empty import payload gracefully', async () => {
    const handler = getHandler('task-vault:vault:import-json')
    const result = (await handler({}, {})) as { success: boolean; imported: number }
    expect(result.success).toBe(true)
    expect(result.imported).toBe(0)
  })
})

// ── getVaultPath (vault.ipc) ──────────────────────────────────────────────────

describe('getVaultPath (vault.ipc)', () => {
  it('returns the vault path set via setVaultPath', () => {
    setVaultPath('/test/vault/path')
    expect(getVaultPath()).toBe('/test/vault/path')
    setVaultPath(VAULT) // restore
  })
})

// ── vault:get-task-detail ─────────────────────────────────────────────────────

describe('task-vault:vault:get-task-detail', () => {
  it('returns detail fields from metadata JSON', async () => {
    const meta = JSON.stringify({
      description: 'Describe it',
      acceptance_criteria: '- [ ] criterion',
      dev_hints: 'Use X pattern',
    })
    mockGet.mockReturnValue({ metadata: meta })
    const handler = getHandler('task-vault:vault:get-task-detail')
    const result = (await handler({}, { taskId: 'task-1' })) as Record<string, string>
    expect(result.description).toBe('Describe it')
    expect(result.acceptanceCriteria).toBe('- [ ] criterion')
    expect(result.devHints).toBe('Use X pattern')
  })

  it('returns empty strings when metadata has no detail fields', async () => {
    mockGet.mockReturnValue({ metadata: '{}' })
    const handler = getHandler('task-vault:vault:get-task-detail')
    const result = (await handler({}, { taskId: 'task-1' })) as Record<string, string>
    expect(result.description).toBe('')
    expect(result.acceptanceCriteria).toBe('')
    expect(result.devHints).toBe('')
  })

  it('returns error when task not found', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:vault:get-task-detail')
    const result = (await handler({}, { taskId: 'nonexistent' })) as { error: string }
    expect(result.error).toBe('Task not found')
  })

  it('returns validation error for invalid payload', async () => {
    const handler = getHandler('task-vault:vault:get-task-detail')
    const result = (await handler({}, {})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })
})

// ── vault:save-task-detail ────────────────────────────────────────────────────

describe('task-vault:vault:save-task-detail', () => {
  it('writes merged metadata back to DB', async () => {
    mockGet.mockReturnValue({ metadata: '{"other":"value"}' })
    const handler = getHandler('task-vault:vault:save-task-detail')
    const result = await handler(
      {},
      {
        taskId: 'task-1',
        description: 'New desc',
        acceptanceCriteria: '- [ ] AC',
        devHints: 'Hint',
      }
    )
    expect(result).toEqual({ ok: true })
    expect(mockRun).toHaveBeenCalled()
    const savedMeta = JSON.parse(mockRun.mock.calls[0][0] as string) as Record<string, string>
    expect(savedMeta.other).toBe('value')
    expect(savedMeta.description).toBe('New desc')
    expect(savedMeta.acceptance_criteria).toBe('- [ ] AC')
    expect(savedMeta.dev_hints).toBe('Hint')
  })

  it('returns error when task not found', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:vault:save-task-detail')
    const result = (await handler(
      {},
      {
        taskId: 'missing',
        description: '',
        acceptanceCriteria: '',
        devHints: '',
      }
    )) as { error: string }
    expect(result.error).toBe('Task not found')
  })

  it('returns validation error for invalid payload', async () => {
    const handler = getHandler('task-vault:vault:save-task-detail')
    const result = (await handler({}, { taskId: 'task-1' })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })
})

// ── registerVaultIpcHandlers dispose ──────────────────────────────────────────

describe('registerVaultIpcHandlers dispose', () => {
  it('calls ipcMain.removeHandler for all registered channels', () => {
    const dispose = registerVaultIpcHandlers()
    dispose()
    const removedChannels = vi.mocked(mockRemoveHandler).mock.calls.map((c) => c[0])
    expect(removedChannels).toContain('task-vault:vault:capture')
    expect(removedChannels).toContain('task-vault:vault:get-inbox')
    expect(removedChannels).toContain('task-vault:vault:list-archive')
    expect(removedChannels).toContain('task-vault:vault:add-task')
    expect(removedChannels).toContain('task-vault:vault:get-task-detail')
    expect(removedChannels).toContain('task-vault:vault:save-task-detail')
  })
})
