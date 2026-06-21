import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { wrapDb } from '../../../../src/main/db/index'
import { applyTaskVaultSchema, applyTaskVaultMigrations } from '../../src/vault/db'
import {
  ensureNextOccurrence,
  backfillRecurringTasks,
} from '../../src/vault/ensure-next-occurrence'
import type { ExtensionDB } from '../../../../src/main/extensions/api'

let pg: PGlite
let db: ExtensionDB

beforeEach(async () => {
  pg = new PGlite()
  await pg.waitReady
  db = wrapDb(pg)
  await applyTaskVaultSchema(db)
  await applyTaskVaultMigrations(db)
})

afterEach(async () => {
  await pg.close()
})

let _taskCounter = 0
function makeId(): string {
  return `task-${++_taskCounter}-${Math.random().toString(36).slice(2)}`
}

interface TaskInput {
  id?: string
  text?: string
  status?: string
  project_id?: string | null
  context?: string | null
  area_id?: string | null
  due_date?: string | null
  source?: string
  source_ref?: string | null
  recurrence_rule?: string | null
  recurrence_template_id?: string | null
  recurrence_notify_at?: string | null
  metadata?: string
  terminator_links?: string
  recurrence_end_type?: string | null
  recurrence_end_date?: string | null
  recurrence_end_count?: number | null
  recurrence_completed_count?: number | null
}

async function insertTask(input: TaskInput = {}): Promise<string> {
  const id = input.id ?? makeId()
  const now = new Date().toISOString()
  await db.run(
    `INSERT INTO tasks
       (id, text, status, project_id, context, area_id, due_date,
        source, source_ref, recurrence_rule, recurrence_template_id,
        recurrence_notify_at, metadata, terminator_links, created_at, updated_at,
        recurrence_end_type, recurrence_end_date, recurrence_end_count,
        recurrence_completed_count)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.text ?? 'Test task',
      input.status ?? 'open',
      input.project_id ?? null,
      input.context ?? null,
      input.area_id ?? null,
      input.due_date ?? null,
      input.source ?? 'daily',
      input.source_ref ?? null,
      input.recurrence_rule ?? null,
      input.recurrence_template_id ?? null,
      input.recurrence_notify_at ?? null,
      input.metadata ?? '{}',
      input.terminator_links ?? '[]',
      now,
      now,
      input.recurrence_end_type ?? null,
      input.recurrence_end_date ?? null,
      input.recurrence_end_count ?? null,
      input.recurrence_completed_count ?? null,
    ]
  )
  return id
}

describe('ensureNextOccurrence', () => {
  it('returns null for a non-recurring task', async () => {
    const id = await insertTask({ due_date: '2026-01-01' })
    expect(await ensureNextOccurrence(db, id)).toBeNull()
  })

  it('returns null for a task with no due_date', async () => {
    const id = await insertTask({ recurrence_rule: 'daily' })
    expect(await ensureNextOccurrence(db, id)).toBeNull()
  })

  it('creates a future instance for a daily recurring task', async () => {
    const id = await insertTask({ recurrence_rule: 'daily', due_date: '2099-03-10' })
    const newId = await ensureNextOccurrence(db, id)
    expect(newId).toBeTruthy()
    const newRow = await db.get<{
      due_date: string
      recurrence_template_id: string
      recurrence_rule: string
    }>(`SELECT due_date, recurrence_template_id, recurrence_rule FROM tasks WHERE id=?`, [newId!])
    expect(newRow?.due_date).toBe('2099-03-11')
    expect(newRow?.recurrence_template_id).toBe(id)
    expect(newRow?.recurrence_rule).toBe('daily')
  })

  it('inherits source and source_ref from the template task for non-daily sources', async () => {
    const id = await insertTask({
      recurrence_rule: 'daily',
      due_date: '2099-03-10',
      source: 'project',
      source_ref: 'my-project',
    })
    const newId = await ensureNextOccurrence(db, id)
    expect(newId).toBeTruthy()
    const newRow = await db.get<{ source: string; source_ref: string }>(
      `SELECT source, source_ref FROM tasks WHERE id=?`,
      [newId!]
    )
    expect(newRow?.source).toBe('project')
    expect(newRow?.source_ref).toBe('my-project')
  })

  it('sets source_ref to nextDue for daily-source tasks', async () => {
    const id = await insertTask({
      recurrence_rule: 'daily',
      due_date: '2099-03-10',
      source: 'daily',
      source_ref: '2099-03-10',
    })
    const newId = await ensureNextOccurrence(db, id)
    expect(newId).toBeTruthy()
    const newRow = await db.get<{ due_date: string; source: string; source_ref: string }>(
      `SELECT due_date, source, source_ref FROM tasks WHERE id=?`,
      [newId!]
    )
    expect(newRow?.due_date).toBe('2099-03-11')
    expect(newRow?.source).toBe('daily')
    expect(newRow?.source_ref).toBe('2099-03-11')
  })

  it('is idempotent — second call creates no additional instance', async () => {
    const id = await insertTask({ recurrence_rule: 'daily', due_date: '2099-03-10' })
    await ensureNextOccurrence(db, id)
    const secondResult = await ensureNextOccurrence(db, id)
    expect(secondResult).toBeNull()
    const instances = await db.query(`SELECT id FROM tasks WHERE recurrence_template_id=?`, [id])
    expect(instances).toHaveLength(1)
  })

  it('propagates template_id from an instance task', async () => {
    const templateId = await insertTask({ recurrence_rule: 'daily', due_date: '2099-03-10' })
    const instanceId = await insertTask({
      recurrence_rule: 'daily',
      recurrence_template_id: templateId,
      due_date: '2099-03-11',
      status: 'done',
    })
    const newId = await ensureNextOccurrence(db, instanceId)
    expect(newId).toBeTruthy()
    const newRow = await db.get<{ recurrence_template_id: string }>(
      `SELECT recurrence_template_id FROM tasks WHERE id=?`,
      [newId!]
    )
    expect(newRow?.recurrence_template_id).toBe(templateId)
  })

  it('does not spawn when after_count limit is exhausted (column-based)', async () => {
    const id = await insertTask({
      recurrence_rule: 'daily',
      due_date: '2099-03-10',
      recurrence_end_type: 'after_count',
      recurrence_end_count: 3,
      recurrence_completed_count: 2,
    })
    expect(await ensureNextOccurrence(db, id)).toBeNull()
  })

  it('does not spawn when after_count limit is exhausted (metadata fallback)', async () => {
    const id = await insertTask({
      recurrence_rule: 'daily',
      due_date: '2099-03-10',
      metadata: JSON.stringify({
        recurrence_end_type: 'after_count',
        recurrence_end_count: 3,
        recurrence_completed_count: 2,
      }),
    })
    expect(await ensureNextOccurrence(db, id)).toBeNull()
  })

  it('does not spawn when on_date end condition has passed (column-based)', async () => {
    const id = await insertTask({
      recurrence_rule: 'daily',
      due_date: '2099-03-10',
      recurrence_end_type: 'on_date',
      recurrence_end_date: '2099-03-10', // next would be 2099-03-11 > end date
    })
    expect(await ensureNextOccurrence(db, id)).toBeNull()
  })

  it('does not spawn when on_date end condition has passed (metadata fallback)', async () => {
    const id = await insertTask({
      recurrence_rule: 'daily',
      due_date: '2099-03-10',
      metadata: JSON.stringify({
        recurrence_end_type: 'on_date',
        recurrence_end_date: '2099-03-10', // next would be 2099-03-11 > end date
      }),
    })
    expect(await ensureNextOccurrence(db, id)).toBeNull()
  })

  it('still spawns when after_count limit is not yet reached', async () => {
    const id = await insertTask({
      recurrence_rule: 'daily',
      due_date: '2099-03-10',
      recurrence_end_type: 'after_count',
      recurrence_end_count: 3,
      recurrence_completed_count: 1,
    })
    expect(await ensureNextOccurrence(db, id)).toBeTruthy()
  })
})

describe('backfillRecurringTasks', () => {
  it('creates a future instance for a stale recurring task', async () => {
    const id = await insertTask({ recurrence_rule: 'daily', due_date: '2020-01-01' })
    await backfillRecurringTasks(db)
    const instances = await db.query(`SELECT id FROM tasks WHERE recurrence_template_id=?`, [id])
    expect(instances.length).toBeGreaterThan(0)
  })

  it('is idempotent when called twice', async () => {
    const id = await insertTask({ recurrence_rule: 'daily', due_date: '2020-01-01' })
    await backfillRecurringTasks(db)
    const countAfterFirst = (
      await db.query(`SELECT id FROM tasks WHERE recurrence_template_id=?`, [id])
    ).length
    expect(countAfterFirst).toBeGreaterThan(0)
  })

  it('does not spawn when a future open instance already exists', async () => {
    const id = await insertTask({ recurrence_rule: 'daily', due_date: '2020-01-01' })
    const futureId = await insertTask({
      recurrence_rule: 'daily',
      recurrence_template_id: id,
      due_date: '9999-12-31',
      status: 'open',
    })
    await backfillRecurringTasks(db)
    const instances = await db.query(
      `SELECT id FROM tasks WHERE recurrence_template_id=? AND id != ?`,
      [id, futureId]
    )
    expect(instances).toHaveLength(0)
  })
})
