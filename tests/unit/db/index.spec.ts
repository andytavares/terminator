import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @electric-sql/pglite so tests don't need real WASM
const mockQuery = vi.fn()
const mockExec = vi.fn()
const mockTransaction = vi.fn()
const mockClose = vi.fn()
const mockWaitReady = Promise.resolve()

vi.mock('@electric-sql/pglite', () => ({
  PGlite: vi.fn().mockImplementation(function () {
    return {
      query: mockQuery,
      exec: mockExec,
      transaction: mockTransaction,
      close: mockClose,
      waitReady: mockWaitReady,
    }
  }),
}))

vi.mock('../../src/main/logger', () => ({
  makeLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { initAppDb, getAppDb, closeAppDb, healthCheck } from '../../../src/main/db/index'

describe('AppDB', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await closeAppDb()
  })

  it('getAppDb throws before initAppDb', () => {
    expect(() => getAppDb()).toThrow('AppDB not initialized')
  })

  it('initAppDb creates a PGlite instance and resolves', async () => {
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] })
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    expect(db).toBeDefined()
  })

  it('db.query returns rows', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: '1', name: 'Alice' }] })
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    const rows = await db.query<{ id: string; name: string }>('SELECT * FROM foo')
    expect(rows).toEqual([{ id: '1', name: 'Alice' }])
  })

  it('db.query converts ? to $1, $2 positional params', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    await db.query('SELECT * FROM foo WHERE id = ? AND name = ?', ['1', 'Alice'])
    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM foo WHERE id = $1 AND name = $2', [
      '1',
      'Alice',
    ])
  })

  it('db.get returns first row or undefined', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: '1' }] })
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    const row = await db.get<{ id: string }>('SELECT * FROM foo WHERE id = ?', ['1'])
    expect(row).toEqual({ id: '1' })
  })

  it('db.get returns undefined when no rows', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    const row = await db.get('SELECT * FROM foo WHERE id = ?', ['missing'])
    expect(row).toBeUndefined()
  })

  it('db.run executes and returns affectedRows', async () => {
    mockQuery.mockResolvedValue({ rows: [], affectedRows: 2 })
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    const count = await db.run('INSERT INTO foo (id) VALUES (?)', ['1'])
    expect(mockQuery).toHaveBeenCalledWith('INSERT INTO foo (id) VALUES ($1)', ['1'])
    expect(count).toBe(2)
  })

  it('db.run returns 0 when affectedRows is undefined', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    const count = await db.run('DELETE FROM foo WHERE 1=0')
    expect(count).toBe(0)
  })

  it('db.exec runs schema SQL', async () => {
    mockExec.mockResolvedValue([])
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    await db.exec('CREATE TABLE foo (id TEXT PRIMARY KEY)')
    expect(mockExec).toHaveBeenCalledWith('CREATE TABLE foo (id TEXT PRIMARY KEY)')
  })

  it('db.transaction exposes exec, query, run, and get inside callback', async () => {
    const fakeTxQuery = vi.fn().mockResolvedValue({ rows: [{ id: '1' }], affectedRows: 1 })
    const fakeTxExec = vi.fn().mockResolvedValue([])
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ query: fakeTxQuery, exec: fakeTxExec })
    })
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    const result = await db.transaction(async (tx) => {
      await tx.exec('CREATE TABLE IF NOT EXISTS foo (id TEXT)')
      const rows = await tx.query<{ id: string }>('SELECT * FROM foo')
      const row = await tx.get<{ id: string }>('SELECT * FROM foo WHERE id = ?', ['1'])
      const count = await tx.run('INSERT INTO foo VALUES (?)', ['1'])
      return { rows, row, count }
    })
    expect(fakeTxExec).toHaveBeenCalled()
    expect(fakeTxQuery).toHaveBeenCalled()
    expect((result as { count: number }).count).toBe(1)
    expect(mockTransaction).toHaveBeenCalled()
  })

  it('db.transaction supports nested transactions via savepoints', async () => {
    const fakeTxExec = vi.fn().mockResolvedValue([])
    const fakeTxQuery = vi.fn().mockResolvedValue({ rows: [], affectedRows: 0 })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ query: fakeTxQuery, exec: fakeTxExec })
    })
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    const result = await db.transaction(async (tx) => {
      return tx.transaction(async (tx2) => {
        await tx2.run('INSERT INTO foo VALUES (?)', ['nested'])
        return 'nested-done'
      })
    })
    expect(result).toBe('nested-done')
    // SAVEPOINT + RELEASE should have been called via exec
    const execCalls = fakeTxExec.mock.calls.map((c) => String(c[0]))
    expect(execCalls.some((s) => s.startsWith('SAVEPOINT'))).toBe(true)
    expect(execCalls.some((s) => s.startsWith('RELEASE SAVEPOINT'))).toBe(true)
  })

  it('db.transaction rolls back savepoint on nested error', async () => {
    const fakeTxExec = vi.fn().mockResolvedValue([])
    const fakeTxQuery = vi.fn().mockResolvedValue({ rows: [] })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ query: fakeTxQuery, exec: fakeTxExec })
    })
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    await expect(
      db.transaction(async (tx) => {
        return tx.transaction(async () => {
          throw new Error('inner failure')
        })
      })
    ).rejects.toThrow('inner failure')
    const execCalls = fakeTxExec.mock.calls.map((c) => String(c[0]))
    expect(execCalls.some((s) => s.startsWith('ROLLBACK TO SAVEPOINT'))).toBe(true)
  })

  it('closeAppDb closes the pglite instance', async () => {
    mockClose.mockResolvedValue(undefined)
    await initAppDb('/tmp/test-db')
    await closeAppDb()
    expect(mockClose).toHaveBeenCalled()
    expect(() => getAppDb()).toThrow('AppDB not initialized')
  })

  it('closeAppDb resets _spCount so savepoints restart from sp_1 after re-init', async () => {
    const fakeTxExec = vi.fn().mockResolvedValue([])
    const fakeTxQuery = vi.fn().mockResolvedValue({ rows: [], affectedRows: 0 })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({ query: fakeTxQuery, exec: fakeTxExec })
    })
    mockClose.mockResolvedValue(undefined)
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] })

    await initAppDb('/tmp/test-db')
    const db1 = getAppDb()
    await db1.transaction(async (tx) => {
      await tx.transaction(async () => 'nested1')
    })
    await closeAppDb()

    await initAppDb('/tmp/test-db')
    const db2 = getAppDb()
    fakeTxExec.mockClear()
    await db2.transaction(async (tx) => {
      await tx.transaction(async () => 'nested2')
    })

    const execCalls = fakeTxExec.mock.calls.map((c) => String(c[0]))
    // After re-init, savepoint counter should restart from sp_1
    expect(execCalls.some((s) => s.includes('sp_1'))).toBe(true)
  })

  it('healthCheck returns ok when query succeeds', async () => {
    mockQuery.mockResolvedValue({ rows: [{ '?column?': 1 }] })
    await initAppDb('/tmp/test-db')
    const result = await healthCheck()
    expect(result.ok).toBe(true)
  })

  it('healthCheck returns error when not initialized', async () => {
    const result = await healthCheck()
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/not initialized/)
  })
})
