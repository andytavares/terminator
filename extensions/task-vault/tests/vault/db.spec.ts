import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { wrapDb } from '../../../../src/main/db/index'
import { applyTaskVaultSchema, applyTaskVaultMigrations, hasColumn } from '../../src/vault/db'
import type { ExtensionDB } from '../../../../src/main/db/index'

let pg: PGlite
let db: ExtensionDB

beforeEach(async () => {
  pg = new PGlite()
  await pg.waitReady
  db = wrapDb(pg)
})

afterEach(async () => {
  await pg.close()
})

describe('applyTaskVaultSchema', () => {
  it('creates all required tables', async () => {
    await applyTaskVaultSchema(db)
    const rows = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    )
    const tables = rows.map((r) => r.table_name)
    expect(tables).toContain('settings')
    expect(tables).toContain('areas')
    expect(tables).toContain('projects')
    expect(tables).toContain('tasks')
  })

  it('is idempotent — safe to call twice', async () => {
    await applyTaskVaultSchema(db)
    await expect(applyTaskVaultSchema(db)).resolves.not.toThrow()
  })
})

describe('settings composite PK (extension_id, key)', () => {
  beforeEach(async () => {
    await applyTaskVaultSchema(db)
    await applyTaskVaultMigrations(db)
  })

  it('settings table has extension_id column after migration', async () => {
    expect(await hasColumn(db, 'settings', 'extension_id')).toBe(true)
  })

  it('two different extension_ids can hold the same key independently', async () => {
    await db.run(`INSERT INTO settings (extension_id, key, value) VALUES (?, ?, ?)`, [
      'task-vault',
      'kanban_config',
      '{}',
    ])
    await db.run(`INSERT INTO settings (extension_id, key, value) VALUES (?, ?, ?)`, [
      'other-ext',
      'kanban_config',
      '{"cols":[]}',
    ])
    const rows = await db.query<{ extension_id: string; value: string }>(
      `SELECT extension_id, value FROM settings WHERE key = 'kanban_config' ORDER BY extension_id`
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ extension_id: 'other-ext' })
    expect(rows[1]).toMatchObject({ extension_id: 'task-vault' })
  })

  it('duplicate (extension_id, key) insert is rejected by PK constraint', async () => {
    await db.run(`INSERT INTO settings (extension_id, key, value) VALUES (?, ?, ?)`, [
      'task-vault',
      'stale_days_threshold',
      '7',
    ])
    await expect(
      db.run(`INSERT INTO settings (extension_id, key, value) VALUES (?, ?, ?)`, [
        'task-vault',
        'stale_days_threshold',
        '14',
      ])
    ).rejects.toThrow()
  })

  it('ON CONFLICT (extension_id, key) upsert updates value correctly', async () => {
    await db.run(
      `INSERT INTO settings (extension_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (extension_id, key) DO UPDATE SET value = EXCLUDED.value`,
      ['task-vault', 'stale_days_threshold', '7']
    )
    await db.run(
      `INSERT INTO settings (extension_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (extension_id, key) DO UPDATE SET value = EXCLUDED.value`,
      ['task-vault', 'stale_days_threshold', '14']
    )
    const row = await db.get<{ value: string }>(
      `SELECT value FROM settings WHERE extension_id = 'task-vault' AND key = 'stale_days_threshold'`
    )
    expect(row?.value).toBe('14')
  })
})
