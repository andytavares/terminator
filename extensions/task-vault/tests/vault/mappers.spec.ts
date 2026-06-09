import { describe, it, expect } from 'vitest'
import { rowToTask, rowToProject } from '../../src/vault/mappers'

function baseTaskRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    text: 'Do the thing',
    status: 'open',
    project: 'My Project',
    context: 'work',
    area: 'Work',
    due_date: '2099-01-15',
    completed_date: null,
    migrated_to: null,
    terminator_links: '[]',
    source: 'daily',
    source_ref: '2099-01-15',
    parent_id: null,
    sort_order: 0,
    metadata: '{}',
    created_at: '2099-01-01T00:00:00.000Z',
    updated_at: '2099-01-01T00:00:00.000Z',
    project_id: 'proj-1',
    area_id: 'area-1',
    recurrence_rule: null,
    recurrence_template_id: null,
    recurrence_notify_at: null,
    blocked_reason: null,
    blocked_check_interval: null,
    recurrence_end_type: null,
    recurrence_end_date: null,
    recurrence_end_count: null,
    recurrence_completed_count: null,
    ...overrides,
  }
}

describe('rowToTask', () => {
  it('maps a minimal task row correctly', () => {
    const task = rowToTask(baseTaskRow())
    expect(task.id).toBe('task-1')
    expect(task.text).toBe('Do the thing')
    expect(task.status).toBe('open')
    expect(task.project).toBe('My Project')
    expect(task.context).toBe('work')
    expect(task.area).toBe('Work')
    expect(task.dueDate).toBe('2099-01-15')
    expect(task.filePath).toBe('daily/2099-01-15')
    expect(task.terminatorLinks).toEqual([])
    expect(task.subtasks).toEqual([])
  })

  it('builds filePath from source only when source_ref is null', () => {
    const task = rowToTask(baseTaskRow({ source: 'inbox', source_ref: null }))
    expect(task.filePath).toBe('inbox')
  })

  it('reads blocked_reason from promoted column', () => {
    const task = rowToTask(baseTaskRow({ blocked_reason: 'waiting on PR' }))
    expect(task.blockedReason).toBe('waiting on PR')
  })

  it('reads blocked_check_interval from promoted column', () => {
    const task = rowToTask(baseTaskRow({ blocked_check_interval: '1d' }))
    expect(task.blockedCheckInterval).toBe('1d')
  })

  it('reads recurrence end fields from promoted columns', () => {
    const task = rowToTask(
      baseTaskRow({
        recurrence_end_type: 'after_count',
        recurrence_end_count: 5,
        recurrence_completed_count: 2,
        recurrence_end_date: null,
      })
    )
    expect(task.recurrenceEndType).toBe('after_count')
    expect(task.recurrenceEndCount).toBe(5)
    expect(task.recurrenceCompletedCount).toBe(2)
  })

  it('falls back to metadata for blocked_reason when columns are null', () => {
    const task = rowToTask(
      baseTaskRow({
        blocked_reason: null,
        blocked_check_interval: null,
        recurrence_end_type: null,
        metadata: JSON.stringify({ blocked_reason: 'from meta', blocked_check_interval: '2d' }),
      })
    )
    expect(task.blockedReason).toBe('from meta')
    expect(task.blockedCheckInterval).toBe('2d')
  })

  it('falls back to metadata for recurrence end fields when columns are null', () => {
    const task = rowToTask(
      baseTaskRow({
        blocked_reason: null,
        blocked_check_interval: null,
        recurrence_end_type: null,
        recurrence_end_date: null,
        recurrence_end_count: null,
        recurrence_completed_count: null,
        metadata: JSON.stringify({
          recurrence_end_type: 'on_date',
          recurrence_end_date: '2099-12-31',
          recurrence_end_count: 10,
          recurrence_completed_count: 3,
        }),
      })
    )
    expect(task.recurrenceEndType).toBe('on_date')
    expect(task.recurrenceEndDate).toBe('2099-12-31')
    expect(task.recurrenceEndCount).toBe(10)
    expect(task.recurrenceCompletedCount).toBe(3)
  })

  it('handles malformed metadata gracefully (fallback path)', () => {
    const task = rowToTask(
      baseTaskRow({
        blocked_reason: null,
        blocked_check_interval: null,
        recurrence_end_type: null,
        metadata: 'not-valid-json{{',
      })
    )
    expect(task.blockedReason).toBeUndefined()
    expect(task.blockedCheckInterval).toBeUndefined()
    expect(task.recurrenceEndType).toBeUndefined()
  })

  it('reads recurrence rule columns', () => {
    const task = rowToTask(
      baseTaskRow({
        recurrence_rule: 'daily',
        recurrence_template_id: 'tmpl-1',
        recurrence_notify_at: '09:00',
      })
    )
    expect(task.recurrenceRule).toBe('daily')
    expect(task.recurrenceTemplateId).toBe('tmpl-1')
    expect(task.recurrenceNotifyAt).toBe('09:00')
  })

  it('parses terminator_links JSON array', () => {
    const task = rowToTask(baseTaskRow({ terminator_links: '["link-1","link-2"]' }))
    expect(task.terminatorLinks).toEqual(['link-1', 'link-2'])
  })
})

describe('rowToProject', () => {
  it('maps a basic project row', () => {
    const row: Record<string, unknown> = {
      id: 'proj-1',
      name: 'My Project',
      status: 'active',
      area: 'Work',
      deadline: '2099-06-01',
      outcome: 'Ship the thing',
      terminator_links: '["link-a"]',
      created_at: '2099-01-01T00:00:00.000Z',
      updated_at: '2099-01-02T00:00:00.000Z',
    }
    const project = rowToProject(row)
    expect(project.id).toBe('proj-1')
    expect(project.name).toBe('My Project')
    expect(project.filePath).toBe('My Project')
    expect(project.status).toBe('active')
    expect(project.area).toBe('Work')
    expect(project.deadline).toBe('2099-06-01')
    expect(project.isStale).toBe(false)
    expect(project.nextActionCount).toBe(0)
    expect(project.lastModified).toBe('2099-01-02T00:00:00.000Z')
    expect(project.terminatorLinks).toEqual(['link-a'])
  })

  it('handles null area and deadline gracefully', () => {
    const row: Record<string, unknown> = {
      id: 'proj-2',
      name: 'Lone Project',
      status: 'someday',
      area: null,
      deadline: null,
      outcome: null,
      terminator_links: '[]',
      created_at: '2099-01-01T00:00:00.000Z',
      updated_at: '2099-01-01T00:00:00.000Z',
    }
    const project = rowToProject(row)
    expect(project.area).toBeUndefined()
    expect(project.deadline).toBeUndefined()
  })
})
