import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRun, mockGet, mockAll, mockPrepare } = vi.hoisted(() => {
  const mockRun = vi.fn()
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

import { registerLinksIpcHandlers, setVaultPath } from '../../src/ipc/links.ipc'

const VAULT = '/vault'
const UUID = '550e8400-e29b-41d4-a716-446655440000'
const TASK_ID = 'task-uuid-1'
const PROJECT_NAME = 'alpha'

beforeEach(() => {
  vi.clearAllMocks()
  mockGet.mockReturnValue(undefined)
  mockAll.mockReturnValue([])
  mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
  setVaultPath(VAULT)
})

function getHandler(channel: string) {
  let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
  vi.mocked(mockHandle).mockImplementation((ch, fn) => {
    if (ch === channel) handler = fn as typeof handler
  })
  const dispose = registerLinksIpcHandlers()
  if (!handler) throw new Error(`Handler for ${channel} not registered`)
  return { handler, dispose }
}

describe('task-vault:links:create', () => {
  it('appends terminator link to task via taskId', async () => {
    mockGet.mockReturnValue({ terminator_links: '[]' })
    const { handler } = getHandler('task-vault:links:create')
    const result = await handler({}, { taskId: TASK_ID, targetId: UUID })
    expect(result).toMatchObject({ success: true })
    expect(mockRun).toHaveBeenCalled()
  })

  it('appends terminator link via projectFilePath', async () => {
    mockGet.mockReturnValue({ terminator_links: '[]' })
    const { handler } = getHandler('task-vault:links:create')
    const result = await handler({}, { projectFilePath: PROJECT_NAME, targetId: UUID })
    expect(result).toMatchObject({ success: true })
  })

  it('returns NOT_FOUND when task does not exist', async () => {
    mockGet.mockReturnValue(undefined)
    const { handler } = getHandler('task-vault:links:create')
    const result = await handler({}, { taskId: 'nonexistent', targetId: UUID })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns NOT_FOUND when project does not exist', async () => {
    mockGet.mockReturnValue(undefined)
    const { handler } = getHandler('task-vault:links:create')
    const result = await handler({}, { projectFilePath: 'nonexistent', targetId: UUID })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for missing targetId', async () => {
    const { handler } = getHandler('task-vault:links:create')
    const result = await handler({}, { taskId: TASK_ID })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

describe('task-vault:links:remove', () => {
  it('removes terminator link from task', async () => {
    mockGet.mockReturnValue({ terminator_links: JSON.stringify([UUID]) })
    const { handler } = getHandler('task-vault:links:remove')
    const result = await handler({}, { taskId: TASK_ID, targetId: UUID })
    expect(result).toMatchObject({ success: true })
    expect(mockRun).toHaveBeenCalled()
    const written = mockRun.mock.calls[0][0] as string
    expect(written).not.toContain(UUID)
  })

  it('returns NOT_FOUND when task does not exist', async () => {
    mockGet.mockReturnValue(undefined)
    const { handler } = getHandler('task-vault:links:remove')
    const result = await handler({}, { taskId: 'nonexistent', targetId: UUID })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for missing targetId', async () => {
    const { handler } = getHandler('task-vault:links:remove')
    const result = await handler({}, { taskId: TASK_ID })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

describe('task-vault:links:get-for-terminator-target', () => {
  const taskRow = {
    id: TASK_ID,
    source: 'inbox',
    source_ref: null,
    text: 'Task',
    status: 'open',
    project: null,
    context: null,
    area: null,
    due_date: null,
    terminator_links: JSON.stringify([UUID]),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    parent_id: null,
    sort_order: 0,
    completed_date: null,
    migrated_to: null,
  }

  it('returns linked tasks and projects for targetId', async () => {
    mockAll.mockReturnValueOnce([taskRow]).mockReturnValueOnce([])
    const { handler } = getHandler('task-vault:links:get-for-terminator-target')
    const result = (await handler({}, { targetId: UUID })) as {
      tasks: unknown[]
      projects: unknown[]
    }
    expect(result.tasks).toHaveLength(1)
    expect(result.projects).toHaveLength(0)
  })

  it('returns empty when targetId has no links', async () => {
    mockAll.mockReturnValue([])
    const { handler } = getHandler('task-vault:links:get-for-terminator-target')
    const result = (await handler({}, { targetId: '00000000-0000-0000-0000-000000000000' })) as {
      tasks: unknown[]
      projects: unknown[]
    }
    expect(result.tasks).toHaveLength(0)
    expect(result.projects).toHaveLength(0)
  })

  it('returns VALIDATION_ERROR for missing targetId', async () => {
    const { handler } = getHandler('task-vault:links:get-for-terminator-target')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})
