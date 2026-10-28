import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb } from '../../../../src/main/db/index'
import { applyTaskVaultSchema } from '../../src/vault/db'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { seedArea, seedTask, selectTaskRow } from '../support/vault-db'

let db: ExtensionDB

beforeEach(() => {
  db = wrapDb(new DatabaseSync(':memory:'))
})

describe('applyTaskVaultSchema', () => {
  it('creates all required tables', async () => {
    await applyTaskVaultSchema(db)
    const rows = await db.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    )
    expect(rows.map((r) => r.name).sort()).toEqual([
      'area_archive_changes',
      'areas',
      'projects',
      'settings',
      'tasks',
    ])
  })

  it('is idempotent — safe to call twice', async () => {
    await applyTaskVaultSchema(db)
    await expect(applyTaskVaultSchema(db)).resolves.not.toThrow()
  })
})

describe('a database from before weekly review and kanban were removed', removedFeatureTests)
describe('a recurring task whose end condition is only in metadata', legacyEndConditionTests)

const OLD_WEEKLY_TABLES = `
  CREATE TABLE weekly_reviews (id TEXT PRIMARY KEY, started_at TEXT NOT NULL);
  CREATE TABLE weekly_review_actions (id TEXT PRIMARY KEY, review_id TEXT NOT NULL);
  INSERT INTO weekly_reviews VALUES ('r1', '2026-01-04');
  INSERT INTO weekly_review_actions VALUES ('a1', 'r1');`

async function tableNames(): Promise<string[]> {
  const rows = await db.query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
  )
  return rows.map((r) => r.name)
}

async function seedFromBeforeTheRemoval(): Promise<void> {
  await applyTaskVaultSchema(db)
  await db.exec(OLD_WEEKLY_TABLES)
  await seedArea(db, 'area-1', 'Home')
  await seedArea(db, 'area-2', { name: 'Old', status: 'archived' })
  await seedTask(db, { id: 'task-1' })
  await seedTask(db, { id: 'task-2', status: 'done' })
  for (const extensionId of ['task-vault', 'other-ext']) {
    await db.run(`INSERT INTO settings (extension_id, key, value) VALUES (?, ?, ?)`, [
      extensionId,
      'kanban_config',
      '{}',
    ])
  }
}

function removedFeatureTests() {
  beforeEach(async () => {
    await seedFromBeforeTheRemoval()
    await applyTaskVaultSchema(db)
  })

  it('drops the review tables', async () => {
    expect(await tableNames()).not.toContain('weekly_reviews')
    expect(await tableNames()).not.toContain('weekly_review_actions')
  })

  it("deletes the vault's kanban setting and no other extension's", async () => {
    const settings = await db.query(`SELECT extension_id, key FROM settings`)
    expect(settings).toEqual([{ extension_id: 'other-ext', key: 'kanban_config' }])
  })

  it('keeps the areas, the archive and the tasks', async () => {
    expect(await db.query(`SELECT id, status FROM areas ORDER BY id`)).toEqual([
      { id: 'area-1', status: 'active' },
      { id: 'area-2', status: 'archived' },
    ])
    expect(await db.query(`SELECT id, status FROM tasks ORDER BY id`)).toEqual([
      { id: 'task-1', status: 'open' },
      { id: 'task-2', status: 'done' },
    ])
  })
}

const LEGACY_METADATA = JSON.stringify({
  recurrence_end_type: 'after_count',
  recurrence_end_count: 5,
  recurrence_completed_count: 2,
})

function legacyEndConditionTests() {
  it('moves the end condition into the columns', async () => {
    await applyTaskVaultSchema(db)
    await seedTask(db, { id: 'legacy', metadata: LEGACY_METADATA })
    await seedTask(db, {
      id: 'current',
      recurrenceEndType: 'on_date',
      recurrenceEndDate: '2026-03-01',
    })
    await seedTask(db, { id: 'broken', metadata: '{not json' })

    await applyTaskVaultSchema(db)

    const row = await selectTaskRow(db, 'legacy')
    expect(row).toMatchObject({
      recurrence_end_type: 'after_count',
      recurrence_end_date: null,
      recurrence_end_count: 5,
      recurrence_completed_count: 2,
    })
    expect(await selectTaskRow(db, 'current')).toMatchObject({
      recurrence_end_type: 'on_date',
      recurrence_end_date: '2026-03-01',
    })
    expect(await selectTaskRow(db, 'broken')).toMatchObject({ recurrence_end_type: null })
  })
}

describe('settings composite PK (extension_id, key)', settingsCompositePKExtensionIdTests)

function settingsCompositePKExtensionIdTests() {
  beforeEach(async () => {
    await applyTaskVaultSchema(db)
  })

  describe('independent', settingsCompositePKExtensionIdIndependentTests)
  describe('duplicates', settingsCompositePKExtensionIdDuplicatesTests)
  describe('upserts', settingsCompositePKExtensionIdUpsertsTests)
}

function settingsCompositePKExtensionIdIndependentTests() {
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
}

function settingsCompositePKExtensionIdDuplicatesTests() {
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
}

function settingsCompositePKExtensionIdUpsertsTests() {
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
}
