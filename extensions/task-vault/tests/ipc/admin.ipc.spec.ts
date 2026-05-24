import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

const { mockRun, mockAll, mockGet, mockPrepare, mockReader } = vi.hoisted(() => {
  const mockRun = vi.fn().mockReturnValue({ changes: 1 })
  const mockAll = vi.fn().mockReturnValue([])
  const mockGet = vi.fn().mockReturnValue({ n: 0 })
  const mockReader = { value: false }
  const mockPrepare = vi.fn().mockImplementation(() => ({
    run: mockRun,
    all: mockAll,
    get: mockGet,
    get reader() {
      return mockReader.value
    },
  }))
  return { mockRun, mockAll, mockGet, mockPrepare, mockReader }
})
vi.mock('../../src/vault/db', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare })),
}))

import { registerAdminIpcHandlers } from '../../src/ipc/admin.ipc.js'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  return mockHandle.mock.calls.find(([ch]) => ch === channel)![1] as (...args: unknown[]) => unknown
}

describe('registerAdminIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandle.mockImplementation((_ch: string, fn: (...args: unknown[]) => unknown) => fn)
    mockReader.value = false
  })

  it('registers three IPC handlers', () => {
    registerAdminIpcHandlers()
    expect(mockHandle).toHaveBeenCalledWith('task-vault:admin:list-tables', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:admin:table-stats', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:admin:run-query', expect.any(Function))
  })

  it('dispose removes all three handlers', () => {
    const dispose = registerAdminIpcHandlers()
    dispose()
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:admin:list-tables')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:admin:table-stats')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:admin:run-query')
  })

  describe('list-tables', () => {
    it('returns table names', () => {
      mockAll.mockReturnValueOnce([{ name: 'tasks' }, { name: 'projects' }])
      registerAdminIpcHandlers()
      const result = getHandler('task-vault:admin:list-tables')() as { tables: string[] }
      expect(result.tables).toEqual(['tasks', 'projects'])
    })
  })

  describe('table-stats', () => {
    it('returns row counts per table', () => {
      mockAll.mockReturnValueOnce([{ name: 'tasks' }, { name: 'areas' }])
      mockGet.mockReturnValueOnce({ n: 42 }).mockReturnValueOnce({ n: 5 })
      registerAdminIpcHandlers()
      const result = getHandler('task-vault:admin:table-stats')() as {
        stats: Record<string, number>
      }
      expect(result.stats.tasks).toBe(42)
      expect(result.stats.areas).toBe(5)
    })
  })

  describe('run-query', () => {
    it('returns rows for SELECT queries', () => {
      mockReader.value = true
      mockAll.mockReturnValue([{ id: '1', text: 'hello' }])
      registerAdminIpcHandlers()
      const result = getHandler('task-vault:admin:run-query')(null, {
        sql: 'SELECT * FROM tasks',
      }) as { rows: unknown[] }
      expect(result.rows).toHaveLength(1)
    })

    it('returns changes count for write queries', () => {
      mockReader.value = false
      mockRun.mockReturnValue({ changes: 3 })
      registerAdminIpcHandlers()
      const result = getHandler('task-vault:admin:run-query')(null, {
        sql: "DELETE FROM tasks WHERE status='cancelled'",
      }) as { changes: number }
      expect(result.changes).toBe(3)
    })

    it('blocks DROP statements', () => {
      registerAdminIpcHandlers()
      const result = getHandler('task-vault:admin:run-query')(null, {
        sql: 'DROP TABLE tasks',
      }) as { error: string }
      expect(result.error).toMatch(/not permitted/i)
      expect(mockPrepare).not.toHaveBeenCalled()
    })

    it('blocks CREATE statements', () => {
      registerAdminIpcHandlers()
      const result = getHandler('task-vault:admin:run-query')(null, {
        sql: 'CREATE TABLE foo (id TEXT)',
      }) as { error: string }
      expect(result.error).toMatch(/not permitted/i)
    })

    it('blocks ALTER statements', () => {
      registerAdminIpcHandlers()
      const result = getHandler('task-vault:admin:run-query')(null, {
        sql: 'ALTER TABLE tasks ADD COLUMN x TEXT',
      }) as { error: string }
      expect(result.error).toMatch(/not permitted/i)
    })

    it('returns error for empty query', () => {
      registerAdminIpcHandlers()
      const result = getHandler('task-vault:admin:run-query')(null, { sql: '   ' }) as {
        error: string
      }
      expect(result.error).toBeTruthy()
    })

    it('returns error when prepare throws', () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error('syntax error')
      })
      registerAdminIpcHandlers()
      const result = getHandler('task-vault:admin:run-query')(null, { sql: 'SELECT 1' }) as {
        error: string
      }
      expect(result.error).toMatch(/syntax error/)
    })
  })
})
