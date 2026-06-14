import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

// Settings table mock: persists across calls within a test
const { mockRun, mockAll, mockGet, mockPrepare } = vi.hoisted(() => {
  const settingsStore: Record<string, string> = {}
  const mockRun = vi.fn().mockImplementation(function (this: unknown, ...args: unknown[]) {
    // Detect INSERT OR REPLACE INTO settings
    const sql = (this as { _sql?: string })._sql ?? ''
    if (sql.includes('INSERT OR REPLACE INTO settings')) {
      const key = args[0] as string
      const value = args[1] as string
      settingsStore[key] = value
    }
    return { changes: 1 }
  })
  const mockGet = vi.fn().mockImplementation(function (this: unknown, ...args: unknown[]) {
    const sql = (this as { _sql?: string })._sql ?? ''
    if (sql.includes("WHERE key='kanban_config'") || sql.includes('WHERE key=')) {
      const key = args[0] as string | undefined
      const lookupKey = key ?? 'kanban_config'
      const value = settingsStore[lookupKey]
      return value ? { value } : undefined
    }
    return undefined
  })
  const mockAll = vi.fn().mockReturnValue([])
  const mockPrepare = vi.fn().mockImplementation((sql: string) => ({
    _sql: sql,
    run: mockRun,
    all: mockAll,
    get: mockGet,
  }))
  return { mockRun, mockAll, mockGet, mockPrepare, _settingsStore: settingsStore }
})

vi.mock('../../src/vault/db', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare })),
}))

import { registerKanbanIpcHandlers } from '../../src/ipc/kanban.ipc.js'
import { DEFAULT_KANBAN_CONFIG } from '../../src/vault/types.js'

describe('registerKanbanIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandle.mockImplementation(
      (_channel: string, handler: (...args: unknown[]) => unknown) => handler
    )
    // Reset the get mock to return undefined by default (no stored config)
    mockGet.mockReturnValue(undefined)
  })

  it('registers five IPC handlers', () => {
    registerKanbanIpcHandlers()
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:get-config', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:save-config', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:list-tasks', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:list-contexts', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:move-task', expect.any(Function))
  })

  it('returns dispose function that removes all handlers', () => {
    const dispose = registerKanbanIpcHandlers()
    dispose()
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:get-config')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:save-config')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:list-tasks')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:list-contexts')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:move-task')
  })

  describe('get-config handler', () => {
    it('returns default config when no config is stored in DB', () => {
      mockGet.mockReturnValue(undefined)
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:get-config'
      )![1]
      const result = handler()
      expect(result).toMatchObject({
        viewMode: 'list',
        lanes: expect.arrayContaining([expect.objectContaining({ id: 'todo', label: 'Todo' })]),
        swimlaneGrouping: 'none',
      })
    })

    it('returns parsed config from DB', () => {
      const stored = {
        viewMode: 'kanban',
        lanes: [{ id: 'todo', label: 'Todo', taskStatuses: ['open'] }],
        swimlaneGrouping: 'project',
      }
      mockGet.mockReturnValue({ value: JSON.stringify(stored) })
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:get-config'
      )![1]
      const result = handler()
      expect(result).toMatchObject(stored)
    })
  })

  describe('save-config handler', () => {
    it('writes valid config to DB', () => {
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:save-config'
      )![1]
      const config = {
        viewMode: 'kanban',
        lanes: [{ id: 'todo', label: 'Todo', taskStatuses: ['open'] }],
        swimlaneGrouping: 'none',
      }
      const result = handler(null, config)
      expect(result).toEqual({ ok: true })
      // Verify it tried to INSERT OR REPLACE into settings
      expect(mockRun).toHaveBeenCalled()
    })

    it('returns error for invalid payload', () => {
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:save-config'
      )![1]
      const result = handler(null, { invalid: true })
      expect(result).toHaveProperty('error')
    })
  })

  describe('list-contexts handler', () => {
    it('returns distinct contexts from DB', () => {
      mockAll.mockReturnValue([{ context: 'work' }, { context: 'home' }])
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-contexts'
      )![1] as () => unknown
      const result = handler() as { contexts: string[] }
      expect(result.contexts).toEqual(['work', 'home'])
    })
  })

  describe('list-tasks handler', () => {
    it('returns tasks from DB excluding migrated and cancelled', () => {
      mockAll.mockReturnValue([
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
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-tasks'
      )![1]
      const result = handler() as { tasks: unknown[] }
      expect(result.tasks).toHaveLength(1)
      expect((result.tasks[0] as Record<string, unknown>).id).toBe('task-1')
    })

    it('extracts description from metadata', () => {
      mockAll.mockReturnValue([
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
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-tasks'
      )![1]
      const result = handler() as { tasks: Record<string, unknown>[] }
      expect(result.tasks[0].description).toBe('Detailed explanation')
    })

    it('returns no description when metadata is empty', () => {
      mockAll.mockReturnValue([
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
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-tasks'
      )![1]
      const result = handler() as { tasks: Record<string, unknown>[] }
      expect(result.tasks[0].description).toBeUndefined()
    })
  })

  describe('get-config with DB fallback', () => {
    it('get-config returns default config when DB returns no row', () => {
      mockGet.mockReturnValue(undefined)
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:get-config'
      )![1]
      const result = handler()
      expect(result).toMatchObject(DEFAULT_KANBAN_CONFIG)
    })
  })

  describe('error paths', () => {
    it('list-tasks returns error when getDb throws', () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error('db unavailable')
      })
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-tasks'
      )![1]
      const result = handler() as { error: string }
      expect(result.error).toMatch(/db unavailable/)
    })

    it('list-contexts returns error when getDb throws', () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error('db unavailable')
      })
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-contexts'
      )![1] as () => unknown
      const result = handler() as { error: string }
      expect(result.error).toMatch(/db unavailable/)
    })

    it('list-tasks handles malformed metadata gracefully', () => {
      mockAll.mockReturnValue([
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
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-tasks'
      )![1]
      const result = handler() as { tasks: Record<string, unknown>[] }
      expect(result.tasks[0].description).toBeUndefined()
    })
  })

  describe('move-task handler', () => {
    it('updates task status in DB', () => {
      mockRun.mockReturnValue({ changes: 1 })
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(([ch]) => ch === 'task-vault:kanban:move-task')![1]
      const result = handler(null, { taskId: 'task-1', toStatus: 'in-progress' })
      expect(result).toEqual({ ok: true })
      expect(mockRun).toHaveBeenCalledWith('in-progress', expect.any(String), 'task-1')
    })

    it('returns error when task not found', () => {
      mockRun.mockReturnValue({ changes: 0 })
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(([ch]) => ch === 'task-vault:kanban:move-task')![1]
      const result = handler(null, { taskId: 'nonexistent', toStatus: 'done' })
      expect(result).toEqual({ error: 'Task not found' })
    })

    it('returns error for invalid toStatus', () => {
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(([ch]) => ch === 'task-vault:kanban:move-task')![1]
      const result = handler(null, { taskId: 'task-1', toStatus: 'invalid-status' })
      expect(result).toHaveProperty('error')
    })
  })
})
