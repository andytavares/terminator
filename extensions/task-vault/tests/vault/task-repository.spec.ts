import { describe, it, expect, vi } from 'vitest'
import { insertTask } from '../../src/vault/task-repository'

function capture() {
  const run = vi.fn().mockResolvedValue(undefined)
  return { db: { run }, run }
}

describe('insertTask', () => {
  it('inserts with the canonical column list and schema defaults for omitted fields', async () => {
    const { db, run } = capture()
    await insertTask(db, {
      id: 't1',
      text: 'Do the thing',
      status: 'open',
      source: 'inbox',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const [sql, params] = run.mock.calls[0]
    expect(sql).toContain('INSERT INTO tasks')
    expect(sql).not.toContain('ON CONFLICT')
    // canonical column count matches placeholder count
    expect((sql.match(/\?/g) ?? []).length).toBe(25)
    expect(params).toHaveLength(25)
    expect(params[0]).toBe('t1')
    expect(params[1]).toBe('Do the thing')
    // omitted optionals become NULL / schema defaults
    expect(params[3]).toBeNull() // project_id
    expect(params[12]).toBe(0) // sort_order
    expect(params[21]).toBe('{}') // metadata
    expect(params[22]).toBe('[]') // terminator_links
  })

  it('passes every provided field through in column order', async () => {
    const { db, run } = capture()
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
      completedDate: null,
      migratedTo: null,
      parentId: 'root',
      sortOrder: 4,
      todaySince: '2026-02-01',
      recurrenceRule: 'weekly:1,3',
      recurrenceTemplateId: 'tmpl',
      recurrenceNotifyAt: '09:00',
      recurrenceEndType: 'after_count',
      recurrenceEndDate: null,
      recurrenceEndCount: 5,
      recurrenceCompletedCount: 2,
      metadata: '{"k":1}',
      terminatorLinks: '["x"]',
      createdAt: 'c',
      updatedAt: 'u',
    })
    const [, params] = run.mock.calls[0]
    expect(params).toEqual([
      't2',
      'Recurring',
      'open',
      'p1',
      '@home',
      'a1',
      '2026-02-03',
      null,
      null,
      'daily',
      '2026-02-02',
      'root',
      4,
      '2026-02-01',
      'weekly:1,3',
      'tmpl',
      '09:00',
      'after_count',
      null,
      5,
      2,
      '{"k":1}',
      '["x"]',
      'c',
      'u',
    ])
  })

  it('appends ON CONFLICT DO NOTHING when orIgnore is set', async () => {
    const { db, run } = capture()
    await insertTask(
      db,
      { id: 't3', text: 'x', status: 'open', source: 'inbox', createdAt: 'c', updatedAt: 'u' },
      { orIgnore: true }
    )
    expect(run.mock.calls[0][0]).toContain('ON CONFLICT DO NOTHING')
  })
})
