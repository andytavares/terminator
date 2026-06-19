import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
const mockNotification = {
  isSupported: vi.fn(() => false),
  show: vi.fn(),
}
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
  Notification: Object.assign(
    vi.fn(() => mockNotification),
    { isSupported: vi.fn(() => false) }
  ),
}))

const { mockRun, mockGet, mockAll, mockPrepare } = vi.hoisted(() => {
  const mockRun = vi.fn().mockReturnValue({ changes: 1 })
  const mockGet = vi.fn()
  const mockAll = vi.fn().mockReturnValue([])
  const mockPrepare = vi.fn().mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
  return { mockRun, mockGet, mockAll, mockPrepare }
})
vi.mock('../../src/vault/db', () => ({
  getDb: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: vi.fn((fn: () => unknown) => fn),
  })),
  randomUUID: vi.fn(() => 'test-uuid'),
}))

// Mock ensureNextOccurrence so IPC tests don't exercise the spawn engine
vi.mock('../../src/vault/ensure-next-occurrence', () => ({
  ensureNextOccurrence: vi.fn(() => null),
  backfillRecurringTasks: vi.fn(),
}))

// Mock broadcast so set-recurrence/clear-recurrence don't need BrowserWindow
vi.mock('../../src/notifications/task-scheduler.js', () => ({
  triggerSchedulerTick: vi.fn(),
  broadcast: vi.fn(),
}))

import { registerVaultIpcHandlers } from '../../src/ipc/vault.ipc'
import { getDb } from '../../src/vault/db'

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

  it('does not spawn next occurrence on completion (spawning is now time-based)', async () => {
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:complete-task')
    const result = (await handler({}, { taskId: 'task-1' })) as {
      success: boolean
      nextTaskId?: string
    }
    expect(result).toEqual({ success: true })
    expect(result.nextTaskId).toBeUndefined()
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
    mockGet.mockReturnValue({ metadata: '{}' })
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:restore-task')
    const result = await handler({}, { taskId: 'task-1' })
    expect(result).toEqual({ success: true })
  })

  it('returns { error: STALE_ID } when task row not found', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:vault:restore-task')
    const result = await handler({}, { taskId: 'gone' })
    expect(result).toEqual({ error: 'STALE_ID' })
  })

  it('deletes twin and its subtasks when migration_twin_id present', async () => {
    mockGet.mockReturnValue({ metadata: '{"migration_twin_id":"twin-xyz"}' })
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:restore-task')
    await handler({}, { taskId: 'task-1' })
    const allRunArgs = mockRun.mock.calls.flat()
    expect(allRunArgs).toContain('twin-xyz')
    const deleteSqls = mockPrepare.mock.calls
      .filter(([sql]: [string]) => sql.startsWith('DELETE FROM tasks'))
      .map(([sql]: [string]) => sql)
    expect(deleteSqls.length).toBeGreaterThanOrEqual(2) // subtasks + twin
  })

  it('restores migrated subtasks when reopening parent', async () => {
    mockGet.mockReturnValue({ metadata: '{}' })
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:restore-task')
    await handler({}, { taskId: 'task-1' })
    const updateSubSql = mockPrepare.mock.calls.find(
      ([sql]: [string]) => sql.includes('parent_id=?') && sql.includes("status='open'")
    )?.[0] as string | undefined
    expect(updateSubSql).toBeDefined()
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
  it('returns date and tasks when db empty', async () => {
    mockAll.mockReturnValue([])
    const handler = getHandler('task-vault:vault:get-today')
    const result = (await handler({}, undefined)) as Record<string, unknown>
    expect(result).toMatchObject({ tasks: [] })
    expect(typeof result.date).toBe('string')
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('maps task rows and sets exists=true when tasks present', async () => {
    const row = makeTaskRow({ source: 'daily', source_ref: '2026-05-20' })
    mockAll
      .mockReturnValueOnce([]) // rollover: no stale tasks
      .mockReturnValueOnce([row]) // main task fetch
      .mockReturnValueOnce([]) // subtasks
    const handler = getHandler('task-vault:vault:get-today')
    const result = (await handler({}, undefined)) as Record<string, unknown>
    expect(result).toMatchObject({ exists: true })
    expect((result.tasks as unknown[]).length).toBe(1)
  })

  it('rolls over stale open tasks from past daily logs', async () => {
    const staleRow = makeTaskRow({ source: 'daily', source_ref: '2026-05-01', status: 'open' })
    mockAll
      .mockReturnValueOnce([staleRow]) // rollover: one stale task found
      .mockReturnValueOnce([]) // main task fetch (no tasks → no subtask fetch)
    const handler = getHandler('task-vault:vault:get-today')
    const result = (await handler({}, undefined)) as Record<string, unknown>
    expect(result.rolledOver).toBe(1)
    expect(mockRun).toHaveBeenCalled()
  })

  it('rolls over stale blocked tasks from past daily logs', async () => {
    const staleRow = makeTaskRow({
      source: 'daily',
      source_ref: '2026-05-01',
      status: 'blocked',
      metadata: '{"blocked_reason":"Waiting on design"}',
    })
    mockAll
      .mockReturnValueOnce([staleRow]) // rollover: one blocked stale task
      .mockReturnValueOnce([]) // main task fetch (no tasks → no subtask fetch)
    const handler = getHandler('task-vault:vault:get-today')
    const result = (await handler({}, undefined)) as Record<string, unknown>
    expect(result.rolledOver).toBe(1)
  })

  it('does not roll over stale recurring tasks', async () => {
    // Recurring tasks are excluded by the SQL — mockAll returns empty to simulate that
    mockAll
      .mockReturnValueOnce([]) // rollover: no rows (recurring task filtered by SQL)
      .mockReturnValueOnce([]) // main task fetch
    const handler = getHandler('task-vault:vault:get-today')
    const result = (await handler({}, undefined)) as Record<string, unknown>
    expect(result.rolledOver).toBe(0)
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
    mockGet.mockReturnValue({ id: 'proj-1' })
    const handler = getHandler('task-vault:vault:update-project-status')
    const result = await handler({}, { projectFilePath: 'MyProject', status: 'active' })
    expect(result).toEqual({ success: true })
  })

  it('falls back to id lookup and returns { success: true }', async () => {
    mockGet.mockReturnValueOnce(undefined).mockReturnValueOnce({ id: 'proj-id' })
    const handler = getHandler('task-vault:vault:update-project-status')
    const result = await handler({}, { projectFilePath: 'proj-id', status: 'active' })
    expect(result).toEqual({ success: true })
  })

  it('cancels open tasks when archiving', async () => {
    mockGet.mockReturnValue({ id: 'proj-1' })
    const handler = getHandler('task-vault:vault:update-project-status')
    const result = await handler({}, { projectFilePath: 'MyProject', status: 'archived' })
    expect(result).toEqual({ success: true })
    // cascade UPDATE + project UPDATE
    expect(mockRun).toHaveBeenCalledTimes(2)
  })

  it('returns { error: NOT_FOUND } when both lookups fail', async () => {
    mockGet.mockReturnValue(undefined)
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

  it('returns archived areas with id, name, and updatedAt', async () => {
    const areaRow = {
      id: 'area-1',
      name: 'Old Area',
      status: 'archived',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    mockAll
      .mockReturnValueOnce([]) // tasks
      .mockReturnValueOnce([]) // projects
      .mockReturnValueOnce([areaRow]) // areas
    const handler = getHandler('task-vault:vault:list-archive')
    const result = (await handler({}, {})) as {
      areas: { id: string; name: string; updatedAt: string }[]
    }
    expect(result.areas).toHaveLength(1)
    expect(result.areas[0].id).toBe('area-1')
    expect(result.areas[0].name).toBe('Old Area')
    expect(result.areas[0].updatedAt).toBeTruthy()
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

// ── rename-area ───────────────────────────────────────────────────────────────

describe('task-vault:vault:rename-area', () => {
  it('renames an area and returns success', async () => {
    mockGet
      .mockReturnValueOnce({ id: 'area-1', name: 'Work' }) // area found
      .mockReturnValueOnce(undefined) // no collision
    const handler = getHandler('task-vault:vault:rename-area')
    const result = await handler({}, { areaFilePath: 'Work', newName: 'Work 2026' })
    expect(result).toMatchObject({ success: true })
    expect(mockRun).toHaveBeenCalled()
  })

  it('returns VALIDATION_ERROR when areaFilePath is missing', async () => {
    const handler = getHandler('task-vault:vault:rename-area')
    const result = await handler({}, { newName: 'New Name' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('returns VALIDATION_ERROR when newName is missing', async () => {
    const handler = getHandler('task-vault:vault:rename-area')
    const result = await handler({}, { areaFilePath: 'Work' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('returns NOT_FOUND when area does not exist', async () => {
    mockGet.mockReturnValueOnce(undefined)
    const handler = getHandler('task-vault:vault:rename-area')
    const result = await handler({}, { areaFilePath: 'Ghost', newName: 'Specter' })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns AREA_EXISTS when new name is already taken', async () => {
    mockGet
      .mockReturnValueOnce({ id: 'area-1', name: 'Work' }) // area found
      .mockReturnValueOnce({ id: 'area-2' }) // collision
    const handler = getHandler('task-vault:vault:rename-area')
    const result = await handler({}, { areaFilePath: 'Work', newName: 'Personal' })
    expect(result).toMatchObject({ error: 'AREA_EXISTS' })
  })
})

// ── restore-area ──────────────────────────────────────────────────────────────

describe('task-vault:vault:restore-area', () => {
  const ARCHIVED_AT = '2024-01-01T10:00:00.000Z'

  it('restores an archived area, its projects, and cancelled tasks', async () => {
    mockGet.mockReturnValueOnce({ id: 'area-1', updated_at: ARCHIVED_AT })
    const handler = getHandler('task-vault:vault:restore-area')
    const result = await handler({}, { areaName: 'Work' })
    expect(result).toMatchObject({ success: true })
    // area UPDATE + projects UPDATE + tasks UPDATE (cancelled tasks restored)
    expect(mockRun).toHaveBeenCalledTimes(3)
  })

  it('task restore SQL filters by archived_at timestamp to exclude user-cancelled tasks', async () => {
    mockGet.mockReturnValueOnce({ id: 'area-1', updated_at: ARCHIVED_AT })
    const handler = getHandler('task-vault:vault:restore-area')
    await handler({}, { areaName: 'Work' })
    // Verify the restore SQL includes updated_at=? (timestamp filter)
    const sqls = mockPrepare.mock.calls.map((c) => c[0] as string)
    const taskRestoreSql = sqls.find(
      (s) =>
        s.includes("status='open'") &&
        s.includes("status='cancelled'") &&
        s.includes('updated_at=?')
    )
    expect(taskRestoreSql).toBeTruthy()
    // Verify the archive timestamp is actually passed as a bind argument to mockRun
    const archivedAtWasPassed = mockRun.mock.calls.some((args) => args.includes(ARCHIVED_AT))
    expect(archivedAtWasPassed).toBe(true)
  })

  it('returns VALIDATION_ERROR when areaName is missing', async () => {
    const handler = getHandler('task-vault:vault:restore-area')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('returns NOT_FOUND when area does not exist', async () => {
    mockGet.mockReturnValueOnce(undefined)
    const handler = getHandler('task-vault:vault:restore-area')
    const result = await handler({}, { areaName: 'Ghost' })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })
})

// ── archive-area ──────────────────────────────────────────────────────────────

describe('task-vault:vault:archive-area', () => {
  it('archives area and cascades to projects and tasks', async () => {
    mockGet.mockReturnValue({ id: 'area-1' })
    mockAll.mockReturnValue([{ id: 'proj-1' }]) // one project
    const handler = getHandler('task-vault:vault:archive-area')
    const result = await handler({}, { areaName: 'Work' })
    expect(result).toMatchObject({ success: true })
    // tasks cascade UPDATE + direct area tasks UPDATE + projects UPDATE + area UPDATE
    expect(mockRun).toHaveBeenCalledTimes(4)
  })

  it('returns NOT_FOUND when area does not exist', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:vault:archive-area')
    const result = await handler({}, { areaName: 'Ghost' })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for missing areaName', async () => {
    const handler = getHandler('task-vault:vault:archive-area')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })
})

// ── delete-area ───────────────────────────────────────────────────────────────

describe('task-vault:vault:delete-area', () => {
  it('deletes archived area and cascades', async () => {
    mockGet.mockReturnValue({ id: 'area-1', status: 'archived' })
    mockAll.mockReturnValue([]) // no projects
    const handler = getHandler('task-vault:vault:delete-area')
    const result = await handler({}, { areaFilePath: 'areas/Work.md' })
    expect(result).toMatchObject({ success: true })
  })

  it('returns MUST_ARCHIVE_FIRST when area is not archived', async () => {
    mockGet.mockReturnValue({ id: 'area-1', status: 'active' })
    const handler = getHandler('task-vault:vault:delete-area')
    const result = await handler({}, { areaFilePath: 'areas/Work.md' })
    expect(result).toMatchObject({ error: 'MUST_ARCHIVE_FIRST' })
  })

  it('returns NOT_FOUND when area does not exist', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:vault:delete-area')
    const result = await handler({}, { areaFilePath: 'areas/Ghost.md' })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
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
    mockAll.mockReturnValue([]) // no subtasks
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

  it('migrates subtasks: marks originals migrated and creates twins under new parent', async () => {
    const row = makeTaskRow()
    mockGet.mockReturnValue(row)
    const sub1 = { id: 'sub-1', text: 'Subtask one', sort_order: 0, metadata: '{}' }
    const sub2 = { id: 'sub-2', text: 'Subtask two', sort_order: 1, metadata: '{}' }
    mockAll.mockReturnValueOnce([sub1, sub2])
    const handler = getHandler('task-vault:vault:migrate-task')
    await handler({}, { taskId: 'task-1', targetDate: '2026-05-21' })
    // Should have UPDATEd both subtasks to migrated status
    const updateCalls = mockPrepare.mock.calls.filter(
      ([sql]: [string]) => sql.includes("status='migrated'") && sql.includes('WHERE id=?')
    )
    expect(updateCalls.length).toBeGreaterThanOrEqual(3) // parent + 2 subtasks
    // Both subtask IDs should appear in run() calls
    const allRunArgs = mockRun.mock.calls.flat()
    expect(allRunArgs).toContain('sub-1')
    expect(allRunArgs).toContain('sub-2')
    // Twin INSERT calls: one for parent, one per subtask
    const insertCalls = mockPrepare.mock.calls.filter(([sql]: [string]) =>
      sql.startsWith('INSERT INTO tasks')
    )
    expect(insertCalls).toHaveLength(3) // parent twin + 2 subtask twins
  })

  it('returns noop:true when targetDate equals task source_ref (no migration performed)', async () => {
    const row = makeTaskRow({ source_ref: '2026-05-21' })
    mockGet.mockReturnValue(row)
    const handler = getHandler('task-vault:vault:migrate-task')
    const result = await handler({}, { taskId: 'task-1', targetDate: '2026-05-21' })
    expect(result).toMatchObject({ noop: true })
    // No INSERT should have been executed
    const insertCalls = mockPrepare.mock.calls.filter(([sql]: [string]) =>
      sql.startsWith('INSERT INTO tasks')
    )
    expect(insertCalls).toHaveLength(0)
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
    const handler = getHandler('task-vault:vault:export-json')
    const result = (await handler({}, undefined)) as {
      tasks: unknown[]
      projects: unknown[]
      areas: unknown[]
      exportedAt: string
      version: number
    }
    expect(result.tasks).toHaveLength(1)
    expect(result.projects).toHaveLength(1)
    expect(result.areas).toHaveLength(1)
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
    }
    const handler = getHandler('task-vault:vault:import-json')
    const result = (await handler({}, importData)) as { success: boolean; imported: number }
    expect(result.success).toBe(true)
    expect(result.imported).toBe(3)
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

// ── reopen-task ───────────────────────────────────────────────────────────────

describe('task-vault:vault:reopen-task', () => {
  it('sets status to open without changing source', async () => {
    mockGet.mockReturnValue({ metadata: '{}' })
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:reopen-task')
    const result = await handler({}, { taskId: 'task-1' })
    expect(result).toMatchObject({ success: true })
    const sql = mockPrepare.mock.calls.at(-1)?.[0] as string
    expect(sql).toContain("status='open'")
    expect(sql).not.toContain('source')
  })

  it('deletes migration twin and its subtasks when migration_twin_id is present', async () => {
    mockGet.mockReturnValue({ metadata: '{"migration_twin_id":"twin-abc"}' })
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:reopen-task')
    const result = await handler({}, { taskId: 'task-1' })
    expect(result).toMatchObject({ success: true })
    // Two DELETE statements: subtasks of twin, then twin itself
    const deleteSqls = mockPrepare.mock.calls
      .filter(([sql]: [string]) => sql.startsWith('DELETE FROM tasks'))
      .map(([sql]: [string]) => sql)
    expect(deleteSqls.length).toBeGreaterThanOrEqual(2)
    // The twin ID should appear in run() calls
    const allRunArgs = mockRun.mock.calls.flat()
    expect(allRunArgs).toContain('twin-abc')
  })

  it('restores migrated subtasks of the original task', async () => {
    mockGet.mockReturnValue({ metadata: '{}' })
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:reopen-task')
    await handler({}, { taskId: 'task-1' })
    const updateSubSql = mockPrepare.mock.calls.find(
      ([sql]: [string]) => sql.includes('parent_id=?') && sql.includes("status='open'")
    )?.[0] as string | undefined
    expect(updateSubSql).toBeDefined()
  })

  it('returns STALE_ID when task row not found', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:vault:reopen-task')
    const result = (await handler({}, { taskId: 'task-1' })) as { error: string }
    expect(result.error).toBe('STALE_ID')
  })

  it('returns STALE_ID when update changes 0 rows', async () => {
    mockGet.mockReturnValue({ metadata: '{}' })
    mockRun.mockReturnValue({ changes: 0 })
    const handler = getHandler('task-vault:vault:reopen-task')
    const result = (await handler({}, { taskId: 'task-1' })) as { error: string }
    expect(result.error).toBe('STALE_ID')
  })

  it('returns validation error for missing taskId', async () => {
    const handler = getHandler('task-vault:vault:reopen-task')
    const result = (await handler({}, {})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })
})

// ── block-task ────────────────────────────────────────────────────────────────

describe('task-vault:vault:block-task', () => {
  it('sets status to blocked and stores reason + checkInterval in metadata', async () => {
    mockGet.mockReturnValue({ metadata: '{}' })
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:block-task')
    const result = await handler(
      {},
      { taskId: 'task-1', reason: 'Waiting on design', checkInterval: '1-day' }
    )
    expect(result).toMatchObject({ success: true })
    const runArgs = mockRun.mock.calls[0]
    const savedMeta = JSON.parse(runArgs[0] as string) as Record<string, string>
    expect(savedMeta.blocked_reason).toBe('Waiting on design')
    expect(savedMeta.blocked_check_interval).toBe('1-day')
  })

  it('returns STALE_ID when task not found', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:vault:block-task')
    const result = (await handler(
      {},
      { taskId: 'missing', reason: 'X', checkInterval: '2-hour' }
    )) as { error: string }
    expect(result.error).toBe('STALE_ID')
  })

  it('returns STALE_ID when update changes 0 rows', async () => {
    mockGet.mockReturnValue({ metadata: '{}' })
    mockRun.mockReturnValue({ changes: 0 })
    const handler = getHandler('task-vault:vault:block-task')
    const result = (await handler(
      {},
      { taskId: 'task-1', reason: 'X', checkInterval: '1-week' }
    )) as { error: string }
    expect(result.error).toBe('STALE_ID')
  })

  it('returns validation error for invalid payload', async () => {
    const handler = getHandler('task-vault:vault:block-task')
    const result = (await handler({}, { taskId: 'task-1' })) as { error: string }
    expect(result.error).toMatch(/VALIDATION_ERROR/)
  })
})

// ── unblock-task ──────────────────────────────────────────────────────────────

describe('task-vault:vault:unblock-task', () => {
  it('sets status to open and clears blocked metadata', async () => {
    mockGet.mockReturnValue({ metadata: '{"blocked_reason":"X","blocked_check_interval":"1-day"}' })
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:unblock-task')
    const result = await handler({}, { taskId: 'task-1' })
    expect(result).toMatchObject({ success: true })
    const runArgs = mockRun.mock.calls[0]
    const savedMeta = JSON.parse(runArgs[0] as string) as Record<string, string>
    expect(savedMeta.blocked_reason).toBeUndefined()
    expect(savedMeta.blocked_check_interval).toBeUndefined()
  })

  it('returns STALE_ID when task not found', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:vault:unblock-task')
    const result = (await handler({}, { taskId: 'missing' })) as { error: string }
    expect(result.error).toBe('STALE_ID')
  })

  it('returns STALE_ID when update changes 0 rows', async () => {
    mockGet.mockReturnValue({ metadata: '{}' })
    mockRun.mockReturnValue({ changes: 0 })
    const handler = getHandler('task-vault:vault:unblock-task')
    const result = (await handler({}, { taskId: 'task-1' })) as { error: string }
    expect(result.error).toBe('STALE_ID')
  })

  it('returns validation error for missing taskId', async () => {
    const handler = getHandler('task-vault:vault:unblock-task')
    const result = (await handler({}, {})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })
})

// ── reorder-tasks ─────────────────────────────────────────────────────────────

describe('task-vault:vault:reorder-tasks', () => {
  it('updates sort_order for each task id in order', async () => {
    const transactionFn = vi.fn((fn: (ids: string[]) => void) => fn)
    mockPrepare.mockImplementation((sql: string) => {
      if (sql.includes('sort_order')) {
        return {
          run: mockRun,
          get: mockGet,
          all: mockAll,
        }
      }
      return { run: mockRun, get: mockGet, all: mockAll, transaction: transactionFn }
    })
    // db.transaction returns a callable that executes the inner fn
    const mockDb = {
      prepare: vi.fn().mockReturnValue({ run: mockRun }),
      transaction: vi.fn((fn: (ids: string[]) => void) => fn),
    }
    const { getDb: origGetDb } = await import('../../src/vault/db')
    vi.mocked(origGetDb).mockReturnValueOnce(mockDb as unknown as ReturnType<typeof origGetDb>)

    const handler = getHandler('task-vault:vault:reorder-tasks')
    const result = await handler({}, { orderedIds: ['id-1', 'id-2', 'id-3'] })
    expect(result).toMatchObject({ success: true })
  })

  it('returns validation error for empty orderedIds', async () => {
    const handler = getHandler('task-vault:vault:reorder-tasks')
    const result = (await handler({}, { orderedIds: [] })) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('returns validation error for missing payload', async () => {
    const handler = getHandler('task-vault:vault:reorder-tasks')
    const result = (await handler({}, {})) as { error: string }
    expect(result.error).toBe('VALIDATION_ERROR')
  })
})

// ── registerVaultIpcHandlers dispose ──────────────────────────────────────────

// ── set-recurrence ────────────────────────────────────────────────────────────

describe('task-vault:vault:set-recurrence', () => {
  const baseTask = { metadata: '{}', due_date: null, source_ref: null }

  it('writes recurrence_rule column and returns { success: true }', async () => {
    mockGet.mockReturnValue(baseTask)
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:set-recurrence')
    const result = await handler({}, { taskId: 'task-1', interval: 'daily', time: '08:00' })
    expect(result).toEqual({ success: true })
    // UPDATE args: recurrenceRule, notifyAt, effectiveDueDate, metadataJson, now, taskId
    const updateCall = mockRun.mock.calls.find((args) => args[0] === 'daily')
    expect(updateCall).toBeTruthy()
    expect(updateCall![1]).toBe('08:00') // recurrence_notify_at
  })

  it('stores weekly:1,3,5 rule for weekly interval with days', async () => {
    mockGet.mockReturnValue(baseTask)
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:set-recurrence')
    await handler({}, { taskId: 'task-1', interval: 'weekly', days: [1, 3, 5] })
    const updateCall = mockRun.mock.calls.find(
      (args) => typeof args[0] === 'string' && (args[0] as string).startsWith('weekly:')
    )
    expect(updateCall).toBeTruthy()
    expect(updateCall![0]).toBe('weekly:1,3,5')
  })

  it('stores on_date end condition in metadata', async () => {
    mockGet.mockReturnValue(baseTask)
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:set-recurrence')
    await handler(
      {},
      { taskId: 'task-1', interval: 'daily', endType: 'on_date', endDate: '2026-12-31' }
    )
    // The metadata JSON is the 4th arg of the UPDATE run call (index 3)
    const updateCall = mockRun.mock.calls.find((args) => args[0] === 'daily')
    const storedMeta = JSON.parse(updateCall![3] as string) as Record<string, unknown>
    expect(storedMeta.recurrence_end_type).toBe('on_date')
    expect(storedMeta.recurrence_end_date).toBe('2026-12-31')
    expect(storedMeta.recurrence_completed_count).toBe(0)
  })

  it('stores after_count end condition in metadata', async () => {
    mockGet.mockReturnValue(baseTask)
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:set-recurrence')
    await handler(
      {},
      { taskId: 'task-1', interval: 'weekly', days: [1], endType: 'after_count', endCount: 5 }
    )
    const updateCall = mockRun.mock.calls.find(
      (args) => typeof args[0] === 'string' && (args[0] as string).startsWith('weekly:')
    )
    const storedMeta = JSON.parse(updateCall![3] as string) as Record<string, unknown>
    expect(storedMeta.recurrence_end_type).toBe('after_count')
    expect(storedMeta.recurrence_end_count).toBe(5)
    expect(storedMeta.recurrence_completed_count).toBe(0)
  })

  it('backfills due_date from source_ref when task has no due_date', async () => {
    mockGet.mockReturnValue({ metadata: '{}', due_date: null, source_ref: '2026-05-27' })
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:set-recurrence')
    await handler({}, { taskId: 'task-1', interval: 'daily' })
    // UPDATE args: rule, notifyAt, effectiveDueDate, meta, now, taskId
    const updateCall = mockRun.mock.calls.find((args) => args[0] === 'daily')
    expect(updateCall![2]).toBe('2026-05-27') // effectiveDueDate is index 2
  })

  it('preserves existing due_date when already set', async () => {
    mockGet.mockReturnValue({ metadata: '{}', due_date: '2026-06-01', source_ref: '2026-05-27' })
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:set-recurrence')
    await handler({}, { taskId: 'task-1', interval: 'daily' })
    const updateCall = mockRun.mock.calls.find((args) => args[0] === 'daily')
    expect(updateCall![2]).toBe('2026-06-01')
  })

  it('returns STALE_ID when task not found', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:vault:set-recurrence')
    const result = await handler({}, { taskId: 'missing', interval: 'daily' })
    expect(result).toEqual({ error: 'STALE_ID' })
  })

  it('returns VALIDATION_ERROR for invalid interval', async () => {
    const handler = getHandler('task-vault:vault:set-recurrence')
    const result = await handler({}, { taskId: 'task-1', interval: 'hourly' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

// ── clear-recurrence ──────────────────────────────────────────────────────────

describe('task-vault:vault:clear-recurrence', () => {
  it('nulls recurrence_rule column and clears metadata keys, returns { success: true }', async () => {
    mockGet.mockReturnValue({
      metadata: JSON.stringify({
        recurrence_interval: 'daily',
        recurrence_time: '09:00',
        recurrence_end_type: 'after_count',
        recurrence_end_count: 5,
        recurrence_completed_count: 2,
        other_key: 'keep',
      }),
    })
    mockRun.mockReturnValue({ changes: 1 })
    const handler = getHandler('task-vault:vault:clear-recurrence')
    const result = await handler({}, { taskId: 'task-1' })
    expect(result).toEqual({ success: true })
    // The UPDATE call passes metadata JSON then taskId; metadata is the first arg
    const updateCall = mockRun.mock.calls.find(
      (args) => typeof args[0] === 'string' && (args[0] as string).startsWith('{')
    )
    expect(updateCall).toBeTruthy()
    const storedMeta = JSON.parse(updateCall![0] as string) as Record<string, unknown>
    expect(storedMeta.recurrence_interval).toBeUndefined()
    expect(storedMeta.recurrence_time).toBeUndefined()
    expect(storedMeta.recurrence_end_type).toBeUndefined()
    expect(storedMeta.recurrence_end_count).toBeUndefined()
    expect(storedMeta.recurrence_completed_count).toBeUndefined()
    expect(storedMeta.other_key).toBe('keep')
    // Verify the SQL UPDATE also nulls the promoted recurrence_end_* columns
    const updateSql = mockPrepare.mock.calls
      .map((c) => c[0] as string)
      .find((sql) => sql.includes('recurrence_end_type=NULL'))
    expect(updateSql).toBeTruthy()
    expect(updateSql).toContain('recurrence_end_date=NULL')
    expect(updateSql).toContain('recurrence_end_count=NULL')
    expect(updateSql).toContain('recurrence_completed_count=NULL')
  })

  it('returns STALE_ID when task not found', async () => {
    mockGet.mockReturnValue(undefined)
    const handler = getHandler('task-vault:vault:clear-recurrence')
    const result = await handler({}, { taskId: 'missing' })
    expect(result).toEqual({ error: 'STALE_ID' })
  })

  it('handles invalid metadata JSON gracefully and still clears recurrence columns', async () => {
    mockGet.mockReturnValue({ metadata: 'NOT_VALID_JSON' })
    const handler = getHandler('task-vault:vault:clear-recurrence')
    const result = await handler({}, { taskId: 'task-1' })
    // Should still succeed — invalid JSON is caught and treated as empty metadata
    expect(result).toEqual({ success: true })
  })
})

// ── get-calendar-month ────────────────────────────────────────────────────────

describe('task-vault:vault:get-calendar-month', () => {
  it('returns day summaries for the requested month', async () => {
    const dayRows = [
      { date: '2026-06-01', status: 'done', count: 3 },
      { date: '2026-06-01', status: 'open', count: 1 },
    ]
    mockAll.mockReturnValueOnce(dayRows)
    const handler = getHandler('task-vault:vault:get-calendar-month')
    const result = (await handler({}, { year: 2026, month: 6 })) as { days: unknown[] }
    expect(Array.isArray(result.days)).toBe(true)
    expect(result.days).toHaveLength(2)
  })

  it('returns empty days array when no tasks exist for the month', async () => {
    mockAll.mockReturnValueOnce([])
    const handler = getHandler('task-vault:vault:get-calendar-month')
    const result = (await handler({}, { year: 2026, month: 1 })) as { days: unknown[] }
    expect(result.days).toHaveLength(0)
  })
})

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
    expect(removedChannels).toContain('task-vault:vault:reopen-task')
    expect(removedChannels).toContain('task-vault:vault:block-task')
    expect(removedChannels).toContain('task-vault:vault:unblock-task')
    expect(removedChannels).toContain('task-vault:vault:reorder-tasks')
    expect(removedChannels).toContain('task-vault:vault:rename-area')
    expect(removedChannels).toContain('task-vault:vault:restore-area')
    expect(removedChannels).toContain('task-vault:vault:set-recurrence')
    expect(removedChannels).toContain('task-vault:vault:clear-recurrence')
    expect(removedChannels).toContain('task-vault:vault:get-calendar-month')
    expect(removedChannels).toContain('task-vault:system-notify')
  })
})

// ── system-notify ─────────────────────────────────────────────────────────────

import { broadcast } from '../../src/notifications/task-scheduler.js'

describe('task-vault:system-notify', () => {
  it('returns { ok: true } and skips Notification when isSupported is false', async () => {
    const handler = getHandler('task-vault:system-notify')
    const result = await handler({}, { title: 'Test', body: 'Hello' })
    expect(result).toEqual({ ok: true })
  })

  it('shows a native Notification when isSupported is true', async () => {
    const { Notification: MockNotif } = await import('electron')
    vi.mocked(MockNotif.isSupported).mockReturnValueOnce(true)
    const handler = getHandler('task-vault:system-notify')
    await handler({}, { title: 'Task Vault', body: 'Done' })
    expect(MockNotif).toHaveBeenCalledWith({ title: 'Task Vault', body: 'Done', silent: true })
    expect(mockNotification.show).toHaveBeenCalled()
  })

  it('uses default title and empty body when payload omits them', async () => {
    const handler = getHandler('task-vault:system-notify')
    const result = await handler({}, {})
    expect(result).toEqual({ ok: true })
  })
})

describe('task-vault:vault:archive-area broadcasts extension:toast', () => {
  it('calls broadcast with extension:toast on success', async () => {
    mockGet.mockReturnValue({ id: 'area-1' })
    mockAll.mockReturnValue([])
    const handler = getHandler('task-vault:vault:archive-area')
    await handler({}, { areaName: 'Work' })
    expect(vi.mocked(broadcast)).toHaveBeenCalledWith('extension:toast', {
      type: 'info',
      message: 'Area archived: Work',
    })
  })
})

describe('task-vault:vault:update-project-status broadcasts extension:toast when archiving', () => {
  it('calls broadcast with extension:toast on archive', async () => {
    mockGet.mockReturnValue({ id: 'proj-1', name: 'Alpha' })
    const handler = getHandler('task-vault:vault:update-project-status')
    await handler({}, { projectFilePath: 'Alpha', status: 'archived' })
    expect(vi.mocked(broadcast)).toHaveBeenCalledWith('extension:toast', {
      type: 'info',
      message: 'Project archived: Alpha',
    })
  })

  it('does not broadcast extension:toast when status is not archived', async () => {
    mockGet.mockReturnValue({ id: 'proj-1', name: 'Alpha' })
    const handler = getHandler('task-vault:vault:update-project-status')
    await handler({}, { projectFilePath: 'Alpha', status: 'active' })
    const toastCalls = vi.mocked(broadcast).mock.calls.filter((c) => c[0] === 'extension:toast')
    expect(toastCalls).toHaveLength(0)
  })
})

describe('handle() catch — DB not initialized', () => {
  it('returns { error } from vault:capture instead of throwing when getDb throws', async () => {
    vi.mocked(getDb).mockImplementationOnce(() => {
      throw new Error('VaultDB not initialized')
    })
    const handler = getHandler('task-vault:vault:capture')
    const result = await handler({}, { text: 'test task', filePath: '' })
    expect(result).toMatchObject({ error: 'VaultDB not initialized' })
  })
})
