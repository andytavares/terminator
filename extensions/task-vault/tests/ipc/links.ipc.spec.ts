import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionDB } from '../../../../src/main/extensions/api'

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

import { registerLinksIpcHandlers } from '../../src/ipc/links.ipc'

const UUID = '550e8400-e29b-41d4-a716-446655440000'
const TASK_ID = 'task-uuid-1'
const PROJECT_NAME = 'alpha'

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
  registerLinksIpcHandlers(db)
  if (!handler) throw new Error(`Handler for ${channel} not registered`)
  return handler
}

beforeEach(() => {
  vi.clearAllMocks()
  db = createMockDb()
})

describe('task-vault:links:create', () => {
  it('appends terminator link to task via taskId', async () => {
    db.mockGet.mockResolvedValue({ terminator_links: '[]' })
    const handler = getHandler('task-vault:links:create')
    const result = await handler({}, { taskId: TASK_ID, targetId: UUID })
    expect(result).toMatchObject({ success: true })
    expect(db.mockRun).toHaveBeenCalled()
  })

  it('appends terminator link via projectFilePath', async () => {
    db.mockGet.mockResolvedValue({ terminator_links: '[]' })
    const handler = getHandler('task-vault:links:create')
    const result = await handler({}, { projectFilePath: PROJECT_NAME, targetId: UUID })
    expect(result).toMatchObject({ success: true })
  })

  it('returns NOT_FOUND when task does not exist', async () => {
    const handler = getHandler('task-vault:links:create')
    const result = await handler({}, { taskId: 'nonexistent', targetId: UUID })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns NOT_FOUND when project does not exist', async () => {
    const handler = getHandler('task-vault:links:create')
    const result = await handler({}, { projectFilePath: 'nonexistent', targetId: UUID })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for missing targetId', async () => {
    const handler = getHandler('task-vault:links:create')
    const result = await handler({}, { taskId: TASK_ID })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

describe('task-vault:links:remove', () => {
  it('removes terminator link from task', async () => {
    db.mockGet.mockResolvedValue({ terminator_links: JSON.stringify([UUID]) })
    const handler = getHandler('task-vault:links:remove')
    const result = await handler({}, { taskId: TASK_ID, targetId: UUID })
    expect(result).toMatchObject({ success: true })
    expect(db.mockRun).toHaveBeenCalled()
    // The updated links JSON (first param array item) should not contain UUID
    const writtenLinks = db.mockRun.mock.calls[0][1][0] as string
    expect(writtenLinks).not.toContain(UUID)
  })

  it('removes terminator link from project via projectFilePath', async () => {
    db.mockGet.mockResolvedValue({ terminator_links: JSON.stringify([UUID]) })
    const handler = getHandler('task-vault:links:remove')
    const result = await handler({}, { projectFilePath: PROJECT_NAME, targetId: UUID })
    expect(result).toMatchObject({ success: true })
    expect(db.mockRun).toHaveBeenCalled()
  })

  it('returns NOT_FOUND when project does not exist during remove', async () => {
    const handler = getHandler('task-vault:links:remove')
    const result = await handler({}, { projectFilePath: 'nonexistent-proj', targetId: UUID })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns NOT_FOUND when task does not exist', async () => {
    const handler = getHandler('task-vault:links:remove')
    const result = await handler({}, { taskId: 'nonexistent', targetId: UUID })
    expect(result).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR for missing targetId', async () => {
    const handler = getHandler('task-vault:links:remove')
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
    db.mockQuery.mockResolvedValueOnce([taskRow]).mockResolvedValueOnce([])
    const handler = getHandler('task-vault:links:get-for-terminator-target')
    const result = (await handler({}, { targetId: UUID })) as {
      tasks: unknown[]
      projects: unknown[]
    }
    expect(result.tasks).toHaveLength(1)
    expect(result.projects).toHaveLength(0)
  })

  it('returns empty when targetId has no links', async () => {
    db.mockQuery.mockResolvedValue([])
    const handler = getHandler('task-vault:links:get-for-terminator-target')
    const result = (await handler({}, { targetId: '00000000-0000-0000-0000-000000000000' })) as {
      tasks: unknown[]
      projects: unknown[]
    }
    expect(result.tasks).toHaveLength(0)
    expect(result.projects).toHaveLength(0)
  })

  it('returns VALIDATION_ERROR for missing targetId', async () => {
    const handler = getHandler('task-vault:links:get-for-terminator-target')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('returns linked projects for targetId', async () => {
    const projectRow = {
      id: 'proj-uuid-1',
      name: PROJECT_NAME,
      status: 'active',
      area: null,
      deadline: null,
      terminator_links: JSON.stringify([UUID]),
      updated_at: new Date().toISOString(),
    }
    db.mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([projectRow])
    const handler = getHandler('task-vault:links:get-for-terminator-target')
    const result = (await handler({}, { targetId: UUID })) as {
      tasks: unknown[]
      projects: { name: string }[]
    }
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].name).toBe(PROJECT_NAME)
  })
})

describe('task-vault:links:create error handling', () => {
  it('returns error string when db throws during task update', async () => {
    db.mockGet.mockResolvedValue({ terminator_links: '[]' })
    db.mockRun.mockRejectedValueOnce(new Error('db write error'))
    const handler = getHandler('task-vault:links:create')
    const result = await handler({}, { taskId: TASK_ID, targetId: UUID })
    expect(result).toMatchObject({ error: expect.stringContaining('db write error') })
  })
})

describe('task-vault:links:remove error handling', () => {
  it('returns error string when db throws during task remove', async () => {
    db.mockGet.mockResolvedValue({ terminator_links: JSON.stringify([UUID]) })
    db.mockRun.mockRejectedValueOnce(new Error('db remove error'))
    const handler = getHandler('task-vault:links:remove')
    const result = await handler({}, { taskId: TASK_ID, targetId: UUID })
    expect(result).toMatchObject({ error: expect.stringContaining('db remove error') })
  })
})

describe('registerLinksIpcHandlers dispose', () => {
  it('calls ipcMain.removeHandler for all registered channels', () => {
    const dispose = registerLinksIpcHandlers(db)
    dispose()
    const removedChannels = vi.mocked(mockRemoveHandler).mock.calls.map((c) => c[0])
    expect(removedChannels).toContain('task-vault:links:create')
    expect(removedChannels).toContain('task-vault:links:remove')
    expect(removedChannels).toContain('task-vault:links:get-for-terminator-target')
  })
})
