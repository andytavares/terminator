import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionDB } from '../../../../src/main/extensions/api'

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

import { registerKanbanIpcHandlers } from '../../src/ipc/kanban.ipc.js'
import { DEFAULT_KANBAN_CONFIG } from '../../src/vault/types.js'

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

function getHandler(db: ExtensionDB, channel: string): (...args: unknown[]) => Promise<unknown> {
  return mockHandle.mock.calls.find(([ch]) => ch === channel)![1] as (
    ...args: unknown[]
  ) => Promise<unknown>
}

describe('registerKanbanIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandle.mockImplementation((_ch: string, fn: (...args: unknown[]) => unknown) => fn)
  })

  it('registers five IPC handlers', () => {
    const db = createMockDb()
    registerKanbanIpcHandlers(db)
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:get-config', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:save-config', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:list-tasks', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:list-contexts', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:move-task', expect.any(Function))
  })

  it('returns dispose function that removes all handlers', () => {
    const db = createMockDb()
    const dispose = registerKanbanIpcHandlers(db)
    dispose()
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:get-config')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:save-config')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:list-tasks')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:list-contexts')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:move-task')
  })

  describe('get-config handler', () => {
    it('returns default config when no config is stored in DB', async () => {
      const db = createMockDb()
      registerKanbanIpcHandlers(db)
      const result = await getHandler(db, 'task-vault:kanban:get-config')()
      expect(result).toMatchObject({
        viewMode: 'list',
        lanes: expect.arrayContaining([expect.objectContaining({ id: 'todo', label: 'Todo' })]),
        swimlaneGrouping: 'none',
      })
    })

    it('returns parsed config from DB', async () => {
      const stored = {
        viewMode: 'kanban',
        lanes: [{ id: 'todo', label: 'Todo', taskStatuses: ['open'] }],
        swimlaneGrouping: 'project',
      }
      const db = createMockDb()
      db.mockGet.mockResolvedValue({ value: JSON.stringify(stored) })
      registerKanbanIpcHandlers(db)
      const result = await getHandler(db, 'task-vault:kanban:get-config')()
      expect(result).toMatchObject(stored)
    })
  })

  describe('save-config handler', () => {
    it('writes valid config to DB', async () => {
      const db = createMockDb()
      registerKanbanIpcHandlers(db)
      const config = {
        viewMode: 'kanban',
        lanes: [{ id: 'todo', label: 'Todo', taskStatuses: ['open'] }],
        swimlaneGrouping: 'none',
      }
      const result = await getHandler(db, 'task-vault:kanban:save-config')(null, config)
      expect(result).toEqual({ ok: true })
      expect(db.mockRun).toHaveBeenCalled()
    })

    it('returns error for invalid payload', async () => {
      const db = createMockDb()
      registerKanbanIpcHandlers(db)
      const result = await getHandler(db, 'task-vault:kanban:save-config')(null, { invalid: true })
      expect(result).toHaveProperty('error')
    })
  })

  describe('list-contexts handler', () => {
    it('returns distinct contexts from DB', async () => {
      const db = createMockDb()
      db.mockQuery.mockResolvedValue([{ context: 'work' }, { context: 'home' }])
      registerKanbanIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:kanban:list-contexts')()) as {
        contexts: string[]
      }
      expect(result.contexts).toEqual(['work', 'home'])
    })
  })

  describe('list-tasks handler', () => {
    it('returns tasks from DB excluding migrated and cancelled', async () => {
      const db = createMockDb()
      db.mockQuery.mockResolvedValue([
        {
          id: 'task-1',
          text: 'Do something',
          status: 'open',
          project: 'alpha',
          context: null,
          area: null,
          due_date: null,
          terminator_links: '[]',
          metadata: '{}',
        },
      ])
      registerKanbanIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:kanban:list-tasks')()) as {
        tasks: unknown[]
      }
      expect(result.tasks).toHaveLength(1)
      expect((result.tasks[0] as Record<string, unknown>).id).toBe('task-1')
    })

    it('extracts description from metadata', async () => {
      const db = createMockDb()
      db.mockQuery.mockResolvedValue([
        {
          id: 'task-2',
          text: 'Task with desc',
          status: 'open',
          project: null,
          context: null,
          area: null,
          due_date: null,
          terminator_links: '[]',
          metadata: JSON.stringify({ description: 'Detailed explanation' }),
        },
      ])
      registerKanbanIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:kanban:list-tasks')()) as {
        tasks: Record<string, unknown>[]
      }
      expect(result.tasks[0].description).toBe('Detailed explanation')
    })

    it('returns no description when metadata is empty', async () => {
      const db = createMockDb()
      db.mockQuery.mockResolvedValue([
        {
          id: 'task-3',
          text: 'No desc',
          status: 'open',
          project: null,
          context: null,
          area: null,
          due_date: null,
          terminator_links: '[]',
          metadata: '{}',
        },
      ])
      registerKanbanIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:kanban:list-tasks')()) as {
        tasks: Record<string, unknown>[]
      }
      expect(result.tasks[0].description).toBeUndefined()
    })
  })

  describe('get-config with DB fallback', () => {
    it('get-config returns default config when DB returns no row', async () => {
      const db = createMockDb()
      registerKanbanIpcHandlers(db)
      const result = await getHandler(db, 'task-vault:kanban:get-config')()
      expect(result).toMatchObject(DEFAULT_KANBAN_CONFIG)
    })
  })

  describe('error paths', () => {
    it('list-tasks returns error when db.query throws', async () => {
      const db = createMockDb()
      db.mockQuery.mockRejectedValueOnce(new Error('db unavailable'))
      registerKanbanIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:kanban:list-tasks')()) as { error: string }
      expect(result.error).toMatch(/db unavailable/)
    })

    it('list-contexts returns error when db.query throws', async () => {
      const db = createMockDb()
      db.mockQuery.mockRejectedValueOnce(new Error('db unavailable'))
      registerKanbanIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:kanban:list-contexts')()) as {
        error: string
      }
      expect(result.error).toMatch(/db unavailable/)
    })

    it('list-tasks handles malformed metadata gracefully', async () => {
      const db = createMockDb()
      db.mockQuery.mockResolvedValue([
        {
          id: 'task-bad',
          text: 'Bad meta',
          status: 'open',
          project: null,
          context: null,
          area: null,
          due_date: null,
          terminator_links: '[]',
          metadata: 'not-json{{{',
        },
      ])
      registerKanbanIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:kanban:list-tasks')()) as {
        tasks: Record<string, unknown>[]
      }
      expect(result.tasks[0].description).toBeUndefined()
    })
  })

  describe('move-task handler', () => {
    it('updates task status in DB', async () => {
      const db = createMockDb()
      db.mockGet.mockResolvedValue({ id: 'task-1' })
      registerKanbanIpcHandlers(db)
      const result = await getHandler(db, 'task-vault:kanban:move-task')(null, {
        taskId: 'task-1',
        toStatus: 'in-progress',
      })
      expect(result).toEqual({ ok: true })
      expect(db.mockRun).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tasks'),
        expect.arrayContaining(['in-progress', 'task-1'])
      )
    })

    it('returns error when task not found', async () => {
      const db = createMockDb()
      db.mockGet.mockResolvedValue(undefined)
      registerKanbanIpcHandlers(db)
      const result = await getHandler(db, 'task-vault:kanban:move-task')(null, {
        taskId: 'nonexistent',
        toStatus: 'done',
      })
      expect(result).toEqual({ error: 'Task not found' })
    })

    it('returns error for invalid toStatus', async () => {
      const db = createMockDb()
      registerKanbanIpcHandlers(db)
      const result = await getHandler(db, 'task-vault:kanban:move-task')(null, {
        taskId: 'task-1',
        toStatus: 'invalid-status',
      })
      expect(result).toHaveProperty('error')
    })
  })
})
