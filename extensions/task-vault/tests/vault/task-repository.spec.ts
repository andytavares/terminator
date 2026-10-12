import { describe, it, expect, beforeEach } from 'vitest'
import type { ExtensionDB } from '../../../../src/main/extensions/api'
import { insertTask } from '../../src/vault/task-repository'
import { createVaultDb, seedArea, seedProject, seedTask, taskRow } from '../support/vault-db'

let db: ExtensionDB

beforeEach(async () => {
  db = await createVaultDb()
})

describe('insertTask', () => {
  it('stores the required fields and applies schema defaults to the omitted ones', async () => {
    await insertTask(db, {
      id: 't1',
      text: 'Do the thing',
      status: 'open',
      source: 'inbox',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(await taskRow(db, 't1')).toMatchObject({
      text: 'Do the thing',
      status: 'open',
      source: 'inbox',
      project_id: null,
      parent_id: null,
      sort_order: 0,
      metadata: '{}',
      terminator_links: '[]',
      recurrence_rule: null,
      created_at: '2026-01-01T00:00:00.000Z',
    })
  })

  it('stores every provided field in its own column', async () => {
    await seedProject(db, 'p1', 'Project')
    await seedArea(db, 'a1', 'Area')
    await seedTask(db, { id: 'root' })
    await seedTask(db, { id: 'tmpl' })

    await insertTask(db, {
      id: 't2',
      text: 'Recurring',
      status: 'open',
      source: 'daily',
      sourceRef: '2026-02-02',
      projectId: 'p1',
      context: '@home',
      areaId: 'a1',
      dueDate: '2026-02-03',
      completedDate: '2026-02-04',
      migratedTo: '2026-02-05',
      parentId: 'root',
      sortOrder: 4,
      todaySince: '2026-02-01',
      recurrenceRule: 'weekly:1,3',
      recurrenceTemplateId: 'tmpl',
      recurrenceNotifyAt: '09:00',
      recurrenceEndType: 'after_count',
      recurrenceEndDate: '2026-12-31',
      recurrenceEndCount: 5,
      recurrenceCompletedCount: 2,
      metadata: '{"k":1}',
      terminatorLinks: '["x"]',
      createdAt: 'c',
      updatedAt: 'u',
    })

    expect(await taskRow(db, 't2')).toMatchObject({
      source: 'daily',
      source_ref: '2026-02-02',
      project_id: 'p1',
      context: '@home',
      area_id: 'a1',
      due_date: '2026-02-03',
      completed_date: '2026-02-04',
      migrated_to: '2026-02-05',
      parent_id: 'root',
      sort_order: 4,
      today_since: '2026-02-01',
      recurrence_rule: 'weekly:1,3',
      recurrence_template_id: 'tmpl',
      recurrence_notify_at: '09:00',
      recurrence_end_type: 'after_count',
      recurrence_end_date: '2026-12-31',
      recurrence_end_count: 5,
      recurrence_completed_count: 2,
      metadata: '{"k":1}',
      terminator_links: '["x"]',
      created_at: 'c',
      updated_at: 'u',
    })
  })

  const row = {
    id: 't3',
    text: 'x',
    status: 'open',
    source: 'inbox',
    createdAt: 'c',
    updatedAt: 'u',
  }

  it('rejects a duplicate id by default', async () => {
    await insertTask(db, row)
    await expect(insertTask(db, { ...row, text: 'second' })).rejects.toThrow(/UNIQUE/)
  })

  it('keeps the existing row when orIgnore is set', async () => {
    await insertTask(db, row)
    await insertTask(db, { ...row, text: 'second' }, { orIgnore: true })

    expect(await taskRow(db, 't3')).toMatchObject({ text: 'x' })
  })
})
