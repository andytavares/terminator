import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock @electric-sql/pglite so tests don't need real WASM
const mockQuery = vi.fn()
const mockExec = vi.fn()
const mockTransaction = vi.fn()
const mockClose = vi.fn()
const mockWaitReady = Promise.resolve()

vi.mock('@electric-sql/pglite', () => ({
  PGlite: vi.fn().mockImplementation(() => ({
    query: mockQuery,
    exec: mockExec,
    transaction: mockTransaction,
    close: mockClose,
    waitReady: mockWaitReady,
  })),
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

  it('db.run executes without returning rows', async () => {
    mockQuery.mockResolvedValue({ rows: [] })
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    await db.run('INSERT INTO foo (id) VALUES (?)', ['1'])
    expect(mockQuery).toHaveBeenCalledWith('INSERT INTO foo (id) VALUES ($1)', ['1'])
  })

  it('db.exec runs schema SQL', async () => {
    mockExec.mockResolvedValue([])
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    await db.exec('CREATE TABLE foo (id TEXT PRIMARY KEY)')
    expect(mockExec).toHaveBeenCalledWith('CREATE TABLE foo (id TEXT PRIMARY KEY)')
  })

  it('db.transaction calls pglite transaction', async () => {
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        exec: vi.fn().mockResolvedValue([]),
      }
      return fn(fakeTx)
    })
    await initAppDb('/tmp/test-db')
    const db = getAppDb()
    const result = await db.transaction(async (tx) => {
      await tx.run('INSERT INTO foo VALUES (?)', ['1'])
      return 'done'
    })
    expect(result).toBe('done')
    expect(mockTransaction).toHaveBeenCalled()
  })

  it('closeAppDb closes the pglite instance', async () => {
    mockClose.mockResolvedValue(undefined)
    await initAppDb('/tmp/test-db')
    await closeAppDb()
    expect(mockClose).toHaveBeenCalled()
    expect(() => getAppDb()).toThrow('AppDB not initialized')
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
