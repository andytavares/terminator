import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb } from '../../../../src/main/db/index'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { registerAdminIpcHandlers } from '../../src/ipc/admin.ipc.js'
import { createIpcHarness, createVaultDb, seedArea, seedTask } from '../support/vault-db'

let db: ExtensionDB
let harness: ReturnType<typeof createIpcHarness>

beforeEach(async () => {
  db = await createVaultDb()
  harness = createIpcHarness()
})

describe('registerAdminIpcHandlers', registerAdminIpcHandlersTests)

function registerAdminIpcHandlersTests() {
  describe('registration', registerAdminIpcHandlersRegistrationTests)
  registerAdminIpcHandlersChannelTests()
}

function registerAdminIpcHandlersRegistrationTests() {
  it('registers the two admin channels and dispose removes them', () => {
    const dispose = registerAdminIpcHandlers(harness.api, db)
    expect(harness.channels().sort()).toEqual([
      'task-vault:admin:run-query',
      'task-vault:admin:table-stats',
    ])
    dispose()
    expect(harness.channels()).toEqual([])
  })
}

const runAdminSql = (sql: string) => harness.invoke('task-vault:admin:run-query', { sql })

function registerAdminIpcHandlersChannelTests() {
  describe('table-stats', tableStatsTests)
  describe('run-query', runQueryTests)
}

function runQueryTests() {
  beforeEach(async () => {
    await seedTask(db, { id: 't1', text: 'hello', status: 'cancelled' })
    await seedTask(db, { id: 't2', text: 'world' })
    registerAdminIpcHandlers(harness.api, db)
  })

  describe('reads', runQueryReadsTests)
  describe('writes', runQueryWritesTests)
  describe('refusals', runQueryRefusalsTests)
  describe('errors', runQueryErrorsTests)
}

function runQueryReadsTests() {
  it('returns rows for a SELECT', async () => {
    const result = (await runAdminSql('SELECT id, text FROM tasks ORDER BY id')) as {
      rows: Record<string, unknown>[]
      changes: number
    }
    expect(result.rows.map((row) => ({ ...row }))).toEqual([
      { id: 't1', text: 'hello' },
      { id: 't2', text: 'world' },
    ])
    expect(result.changes).toBe(0)
  })

  it('runs a WITH query as a read', async () => {
    const result = (await runAdminSql(
      'WITH c AS (SELECT id FROM tasks) SELECT COUNT(*) AS n FROM c'
    )) as {
      rows: { n: number }[]
    }
    expect(result.rows[0].n).toBe(2)
  })
}

function runQueryWritesTests() {
  it('executes a write and reports how many rows it changed', async () => {
    const result = (await runAdminSql("DELETE FROM tasks WHERE status='cancelled'")) as {
      rows: unknown[]
      changes: number
    }
    expect(result).toEqual({ rows: [], changes: 1 })
    expect(await db.query('SELECT id FROM tasks')).toHaveLength(1)
  })

  it('reports zero changes when a write matches nothing', async () => {
    expect(await runAdminSql("UPDATE tasks SET status='open' WHERE 1=0")).toMatchObject({
      changes: 0,
    })
  })
}

function runQueryRefusalsTests() {
  it.each([
    'DROP TABLE tasks',
    'CREATE TABLE foo (id TEXT)',
    'ALTER TABLE tasks ADD COLUMN x TEXT',
  ])('refuses %s and leaves the schema alone', async (sql) => {
    const result = (await runAdminSql(sql)) as { error: string }
    expect(result.error).toMatch(/not permitted/i)
    expect(await db.query('SELECT id FROM tasks')).toHaveLength(2)
    expect(await db.get(`SELECT name FROM sqlite_master WHERE name = 'foo'`)).toBeUndefined()
  })
}

function runQueryErrorsTests() {
  it('returns an error for an empty query', async () => {
    expect(await runAdminSql('   ')).toEqual({ error: 'Empty query' })
  })

  it('returns the database error for invalid SQL', async () => {
    const result = (await runAdminSql('SELECT FROM nowhere')) as { error: string }
    expect(result.error).toMatch(/syntax error/i)
  })
}

function tableStatsTests() {
  it('counts the rows of every table', async () => {
    await seedArea(db, 'a1', 'Work')
    await seedArea(db, 'a2', 'Home')
    await seedTask(db, { id: 't1' })
    registerAdminIpcHandlers(harness.api, db)
    const result = (await harness.invoke('task-vault:admin:table-stats')) as {
      stats: Record<string, number>
    }
    expect(result.stats).toMatchObject({ tasks: 1, areas: 2, projects: 0 })
  })

  it('returns the error when the database is closed', async () => {
    const database = new DatabaseSync(':memory:')
    const closed = wrapDb(database)
    database.close()
    registerAdminIpcHandlers(harness.api, closed)
    const result = (await harness.invoke('task-vault:admin:table-stats')) as { error: string }
    expect(result.error).toMatch(/not open/)
  })
}
