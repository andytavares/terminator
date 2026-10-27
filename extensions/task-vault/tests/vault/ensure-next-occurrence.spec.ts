import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb } from '../../../../src/main/db/index'
import { applyTaskVaultSchema } from '../../src/vault/db'
import {
  ensureNextOccurrence,
  backfillRecurringTasks,
} from '../../src/vault/ensure-next-occurrence'
import type { ExtensionDB } from '@terminator/extension-sdk'

let db: ExtensionDB

beforeEach(async () => {
  db = wrapDb(new DatabaseSync(':memory:'))
  await applyTaskVaultSchema(db)
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

/** Column defaults for a seeded task; created_at and updated_at are set at insert time. */
const TASK_DEFAULTS: Record<string, unknown> = {
  text: 'Test task',
  status: 'open',
  project_id: null,
  context: null,
  area_id: null,
  due_date: null,
  source: 'daily',
  source_ref: null,
  recurrence_rule: null,
  recurrence_template_id: null,
  recurrence_notify_at: null,
  metadata: '{}',
  terminator_links: '[]',
  recurrence_end_type: null,
  recurrence_end_date: null,
  recurrence_end_count: null,
  recurrence_completed_count: null,
}

async function insertTask(input: TaskInput = {}): Promise<string> {
  const id = input.id ?? makeId()
  const now = new Date().toISOString()
  const given = Object.entries(input).filter(([, value]) => value != null)
  const row = {
    ...TASK_DEFAULTS,
    ...Object.fromEntries(given),
    id,
    created_at: now,
    updated_at: now,
  }
  const columns = Object.keys(row)
  await db.run(
    `INSERT INTO tasks (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(',')})`,
    Object.values(row)
  )
  return id
}

describe('ensureNextOccurrence', ensureNextOccurrenceTests)
describe('backfillRecurringTasks', backfillRecurringTasksTests)

function ensureNextOccurrenceTests() {
  describe('not recurring', ensureNextOccurrenceNotRecurringTests)
  describe('spawning', ensureNextOccurrenceSpawningTests)
  describe('month end', ensureNextOccurrenceMonthEndTests)
  describe('sources', ensureNextOccurrenceSourcesTests)
  describe('idempotence and templates', ensureNextOccurrenceIdempotenceTemplatesTests)
  describe('count limits', ensureNextOccurrenceCountLimitsTests)
  describe('date limits', ensureNextOccurrenceDateLimitsTests)
}

function ensureNextOccurrenceNotRecurringTests() {
  it('returns null for a non-recurring task', async () => {
    const id = await insertTask({ due_date: '2026-01-01' })
    expect(await ensureNextOccurrence(db, id)).toBeNull()
  })

  it('returns null for a task with no due_date', async () => {
    const id = await insertTask({ recurrence_rule: 'daily' })
    expect(await ensureNextOccurrence(db, id)).toBeNull()
  })

  it('adds no task after a due date typed as a word', async () => {
    const id = await insertTask({ recurrence_rule: 'daily', due_date: 'friday' })
    expect(await ensureNextOccurrence(db, id)).toBeNull()
    expect(await db.query(`SELECT id FROM tasks WHERE id != ?`, [id])).toEqual([])
  })
}

function ensureNextOccurrenceSpawningTests() {
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
}

function ensureNextOccurrenceMonthEndTests() {
  it('a series started on the 31st is due on the 31st again after February', async () => {
    const templateId = await insertTask({ recurrence_rule: 'monthly', due_date: '2099-01-31' })
    const february = await insertTask({
      recurrence_rule: 'monthly',
      due_date: '2099-02-28',
      recurrence_template_id: templateId,
      status: 'done',
    })
    const marchId = await ensureNextOccurrence(db, february)
    const march = await db.get<{ due_date: string }>(`SELECT due_date FROM tasks WHERE id=?`, [
      marchId!,
    ])
    expect(march?.due_date).toBe('2099-03-31')
  })
}

function ensureNextOccurrenceSourcesTests() {
  describe('other sources', ensureNextOccurrenceSourcesOtherSourcesTests)
  describe('daily source', ensureNextOccurrenceSourcesDailySourceTests)
}

function ensureNextOccurrenceSourcesOtherSourcesTests() {
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
}

function ensureNextOccurrenceSourcesDailySourceTests() {
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
}

function ensureNextOccurrenceIdempotenceTemplatesTests() {
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
}

function ensureNextOccurrenceCountLimitsTests() {
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
}

function ensureNextOccurrenceDateLimitsTests() {
  describe('passed dates', ensureNextOccurrenceDateLimitsPassedDatesTests)
  describe('counts not reached', ensureNextOccurrenceDateLimitsCountsNotReachedTests)
}

function ensureNextOccurrenceDateLimitsPassedDatesTests() {
  it('does not spawn when on_date end condition has passed (column-based)', async () => {
    const id = await insertTask({
      recurrence_rule: 'daily',
      due_date: '2099-03-10',
      recurrence_end_type: 'on_date',
      recurrence_end_date: '2099-03-10', // next would be 2099-03-11 > end date
    })
    expect(await ensureNextOccurrence(db, id)).toBeNull()
  })
}

function ensureNextOccurrenceDateLimitsCountsNotReachedTests() {
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
}

function backfillRecurringTasksTests() {
  describe('spawning', backfillRecurringTasksSpawningTests)
  describe('existing instances', backfillRecurringTasksExistingInstancesTests)
}

function backfillRecurringTasksSpawningTests() {
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
}

function backfillRecurringTasksExistingInstancesTests() {
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
}
