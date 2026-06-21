import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionDB } from '../../../../src/main/extensions/api'

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

import { registerAdminIpcHandlers } from '../../src/ipc/admin.ipc.js'

function createMockDb(): ExtensionDB & {
  mockQuery: ReturnType<typeof vi.fn>
  mockGet: ReturnType<typeof vi.fn>
  mockRun: ReturnType<typeof vi.fn>
} {
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

describe('registerAdminIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandle.mockImplementation((_ch: string, fn: (...args: unknown[]) => unknown) => fn)
  })

  it('registers three IPC handlers', () => {
    const db = createMockDb()
    registerAdminIpcHandlers(db)
    expect(mockHandle).toHaveBeenCalledWith('task-vault:admin:list-tables', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:admin:table-stats', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:admin:run-query', expect.any(Function))
  })

  it('dispose removes all three handlers', () => {
    const db = createMockDb()
    const dispose = registerAdminIpcHandlers(db)
    dispose()
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:admin:list-tables')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:admin:table-stats')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:admin:run-query')
  })

  describe('list-tables', () => {
    it('returns table names', async () => {
      const db = createMockDb()
      db.mockQuery.mockResolvedValueOnce([{ table_name: 'tasks' }, { table_name: 'projects' }])
      registerAdminIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:admin:list-tables')()) as {
        tables: string[]
      }
      expect(result.tables).toEqual(['tasks', 'projects'])
    })

    it('returns error when query throws', async () => {
      const db = createMockDb()
      db.mockQuery.mockRejectedValueOnce(new Error('connection lost'))
      registerAdminIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:admin:list-tables')()) as { error: string }
      expect(result.error).toMatch(/connection lost/)
    })
  })

  describe('table-stats', () => {
    it('returns row counts per table', async () => {
      const db = createMockDb()
      db.mockQuery.mockResolvedValueOnce([{ table_name: 'tasks' }, { table_name: 'areas' }])
      db.mockGet.mockResolvedValueOnce({ n: '42' }).mockResolvedValueOnce({ n: '5' })
      registerAdminIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:admin:table-stats')()) as {
        stats: Record<string, number>
      }
      expect(result.stats.tasks).toBe(42)
      expect(result.stats.areas).toBe(5)
    })

    it('returns error when query throws', async () => {
      const db = createMockDb()
      db.mockQuery.mockRejectedValueOnce(new Error('pg error'))
      registerAdminIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:admin:table-stats')()) as { error: string }
      expect(result.error).toMatch(/pg error/)
    })
  })

  describe('run-query', () => {
    it('returns rows for SELECT queries', async () => {
      const db = createMockDb()
      db.mockQuery.mockResolvedValueOnce([{ id: '1', text: 'hello' }])
      registerAdminIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:admin:run-query')(null, {
        sql: 'SELECT * FROM tasks',
      })) as { rows: unknown[] }
      expect(result.rows).toHaveLength(1)
    })

    it('returns changes count for write queries', async () => {
      const db = createMockDb()
      db.mockRun.mockResolvedValueOnce(3)
      registerAdminIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:admin:run-query')(null, {
        sql: "DELETE FROM tasks WHERE status='cancelled'",
      })) as { rows: unknown[]; changes: number }
      expect(result.rows).toHaveLength(0)
      expect(result.changes).toBe(3)
    })

    it('returns changes: 0 when no rows affected by write', async () => {
      const db = createMockDb()
      db.mockRun.mockResolvedValueOnce(0)
      registerAdminIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:admin:run-query')(null, {
        sql: "UPDATE tasks SET status='open' WHERE 1=0",
      })) as { changes: number }
      expect(result.changes).toBe(0)
    })

    it('blocks DROP statements', async () => {
      const db = createMockDb()
      registerAdminIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:admin:run-query')(null, {
        sql: 'DROP TABLE tasks',
      })) as { error: string }
      expect(result.error).toMatch(/not permitted/i)
      expect(db.mockQuery).not.toHaveBeenCalled()
    })

    it('blocks CREATE statements', async () => {
      const db = createMockDb()
      registerAdminIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:admin:run-query')(null, {
        sql: 'CREATE TABLE foo (id TEXT)',
      })) as { error: string }
      expect(result.error).toMatch(/not permitted/i)
    })

    it('blocks ALTER statements', async () => {
      const db = createMockDb()
      registerAdminIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:admin:run-query')(null, {
        sql: 'ALTER TABLE tasks ADD COLUMN x TEXT',
      })) as { error: string }
      expect(result.error).toMatch(/not permitted/i)
    })

    it('returns error for empty query', async () => {
      const db = createMockDb()
      registerAdminIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:admin:run-query')(null, { sql: '   ' })) as {
        error: string
      }
      expect(result.error).toBeTruthy()
    })

    it('returns error when query throws', async () => {
      const db = createMockDb()
      db.mockQuery.mockRejectedValueOnce(new Error('syntax error'))
      registerAdminIpcHandlers(db)
      const result = (await getHandler(db, 'task-vault:admin:run-query')(null, {
        sql: 'SELECT 1',
      })) as { error: string }
      expect(result.error).toMatch(/syntax error/)
    })
  })
})
