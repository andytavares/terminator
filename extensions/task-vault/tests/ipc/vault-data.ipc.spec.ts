import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionDB } from '../../../../src/main/extensions/api'
import { localDate } from '../../src/vault/recurrence'
import {
  createIpcHarness,
  createVaultDb,
  seedArea,
  seedProject,
  seedTask,
  taskRow,
} from '../support/vault-db'

vi.mock('../../src/notifications/task-scheduler.js', () => ({
  triggerSchedulerTick: vi.fn(),
  broadcast: vi.fn(),
}))

import { registerVaultIpcHandlers } from '../../src/ipc/vault.ipc'

let db: ExtensionDB
let harness: ReturnType<typeof createIpcHarness>

beforeEach(async () => {
  db = await createVaultDb()
  harness = createIpcHarness()
  registerVaultIpcHandlers(harness.api, db)
})

const invoke = (channel: string, payload?: unknown) => harness.invoke(channel, payload)

const metadataOf = async (id: string) =>
  JSON.parse((await taskRow(db, id))?.metadata as string) as Record<string, unknown>

describe('task-vault:vault:set-recurrence', () => {
  const setRecurrence = (payload: unknown) => invoke('task-vault:vault:set-recurrence', payload)

  it('writes the rule and notify time to the recurrence columns', async () => {
    await seedTask(db, { id: 'task-1', dueDate: '2026-06-01' })

    expect(await setRecurrence({ taskId: 'task-1', interval: 'daily', time: '08:00' })).toEqual({
      success: true,
    })
    expect(await taskRow(db, 'task-1')).toMatchObject({
      recurrence_rule: 'daily',
      recurrence_notify_at: '08:00',
      recurrence_end_type: 'none',
      recurrence_completed_count: 0,
    })
  })

  it('stores a weekly rule with its days sorted', async () => {
    await seedTask(db, { id: 'task-1', dueDate: '2026-06-01' })

    await setRecurrence({ taskId: 'task-1', interval: 'weekly', days: [5, 1, 3] })

    expect(await taskRow(db, 'task-1')).toMatchObject({ recurrence_rule: 'weekly:1,3,5' })
  })

  it('stores an on_date end condition in the columns and metadata', async () => {
    await seedTask(db, { id: 'task-1', dueDate: '2026-06-01' })

    await setRecurrence({
      taskId: 'task-1',
      interval: 'daily',
      endType: 'on_date',
      endDate: '2026-12-31',
    })

    expect(await taskRow(db, 'task-1')).toMatchObject({
      recurrence_end_type: 'on_date',
      recurrence_end_date: '2026-12-31',
      recurrence_end_count: null,
    })
    expect(await metadataOf('task-1')).toMatchObject({
      recurrence_end_type: 'on_date',
      recurrence_end_date: '2026-12-31',
      recurrence_completed_count: 0,
    })
  })

  it('stores an after_count end condition in the columns and metadata', async () => {
    await seedTask(db, { id: 'task-1', dueDate: '2026-06-01' })

    await setRecurrence({
      taskId: 'task-1',
      interval: 'weekly',
      days: [1],
      endType: 'after_count',
      endCount: 5,
    })

    expect(await taskRow(db, 'task-1')).toMatchObject({
      recurrence_end_type: 'after_count',
      recurrence_end_count: 5,
      recurrence_end_date: null,
    })
    expect(await metadataOf('task-1')).toMatchObject({
      recurrence_end_type: 'after_count',
      recurrence_end_count: 5,
      recurrence_completed_count: 0,
    })
  })

  it('backfills due_date from source_ref when the task has none', async () => {
    await seedTask(db, { id: 'task-1', source: 'daily', sourceRef: '2026-05-27' })

    await setRecurrence({ taskId: 'task-1', interval: 'daily' })

    expect(await taskRow(db, 'task-1')).toMatchObject({ due_date: '2026-05-27' })
  })

  it('keeps an existing due_date', async () => {
    await seedTask(db, {
      id: 'task-1',
      source: 'daily',
      sourceRef: '2026-05-27',
      dueDate: '2026-06-01',
    })

    await setRecurrence({ taskId: 'task-1', interval: 'daily' })

    expect(await taskRow(db, 'task-1')).toMatchObject({ due_date: '2026-06-01' })
  })

  it('spawns the next occurrence as a linked open task', async () => {
    await seedTask(db, { id: 'task-1', dueDate: localDate() })

    await setRecurrence({ taskId: 'task-1', interval: 'daily' })

    const next = await db.get<Record<string, unknown>>(
      `SELECT * FROM tasks WHERE recurrence_template_id = 'task-1'`
    )
    expect(next).toMatchObject({ status: 'open', recurrence_rule: 'daily' })
    expect((next?.due_date as string) > localDate()).toBe(true)
  })

  it('replaces the future occurrences of an earlier rule', async () => {
    await seedTask(db, { id: 'task-1', dueDate: localDate() })
    await setRecurrence({ taskId: 'task-1', interval: 'daily' })
    await setRecurrence({ taskId: 'task-1', interval: 'monthly' })

    const spawned = await db.query<Record<string, unknown>>(
      `SELECT recurrence_rule FROM tasks WHERE recurrence_template_id = 'task-1'`
    )
    expect(spawned).toHaveLength(1)
    expect(spawned[0].recurrence_rule).toBe('monthly')
  })

  it('returns STALE_ID for an unknown task', async () => {
    expect(await setRecurrence({ taskId: 'missing', interval: 'daily' })).toEqual({
      error: 'STALE_ID',
    })
  })

  it('returns VALIDATION_ERROR for an invalid interval and leaves the task', async () => {
    await seedTask(db, { id: 'task-1' })

    expect(await setRecurrence({ taskId: 'task-1', interval: 'hourly' })).toMatchObject({
      error: 'VALIDATION_ERROR',
    })
    expect(await taskRow(db, 'task-1')).toMatchObject({ recurrence_rule: null })
  })
})

describe('task-vault:vault:clear-recurrence', () => {
  const clear = (taskId: string) => invoke('task-vault:vault:clear-recurrence', { taskId })

  it('nulls the recurrence columns, removes the recurrence metadata and keeps the rest', async () => {
    await seedTask(db, {
      id: 'task-1',
      dueDate: '2026-06-01',
      recurrenceRule: 'daily',
      recurrenceNotifyAt: '09:00',
      recurrenceEndType: 'after_count',
      recurrenceEndCount: 5,
      recurrenceCompletedCount: 2,
      metadata: JSON.stringify({
        recurrence_interval: 'daily',
        recurrence_time: '09:00',
        recurrence_end_type: 'after_count',
        recurrence_end_count: 5,
        recurrence_completed_count: 2,
        other_key: 'keep',
      }),
    })

    expect(await clear('task-1')).toEqual({ success: true })

    expect(await taskRow(db, 'task-1')).toMatchObject({
      recurrence_rule: null,
      recurrence_notify_at: null,
      recurrence_end_type: null,
      recurrence_end_date: null,
      recurrence_end_count: null,
      recurrence_completed_count: null,
    })
    expect(await metadataOf('task-1')).toEqual({ other_key: 'keep' })
  })

  it('deletes the open occurrences it spawned and keeps finished ones', async () => {
    await seedTask(db, { id: 'task-1', dueDate: '2026-06-01', recurrenceRule: 'daily' })
    await seedTask(db, { id: 'spawn-open', recurrenceTemplateId: 'task-1', dueDate: '2026-06-02' })
    await seedTask(db, {
      id: 'spawn-done',
      recurrenceTemplateId: 'task-1',
      dueDate: '2026-06-03',
      status: 'done',
    })

    await clear('task-1')

    expect(await taskRow(db, 'spawn-open')).toBeUndefined()
    expect(await taskRow(db, 'spawn-done')).toBeDefined()
  })

  it('still clears the columns when the metadata is not valid JSON', async () => {
    await seedTask(db, {
      id: 'task-1',
      recurrenceRule: 'daily',
      dueDate: '2026-06-01',
      metadata: 'NOT_VALID_JSON',
    })

    expect(await clear('task-1')).toEqual({ success: true })
    expect(await taskRow(db, 'task-1')).toMatchObject({ recurrence_rule: null, metadata: '{}' })
  })

  it('returns STALE_ID for an unknown task', async () => {
    expect(await clear('missing')).toEqual({ error: 'STALE_ID' })
  })
})

describe('task-vault:vault:get-calendar-month', () => {
  it('counts top-level daily tasks per day and status within the month', async () => {
    const daily = (id: string, day: string, extra = {}) =>
      seedTask(db, { id, source: 'daily', sourceRef: day, ...extra })
    await daily('a', '2026-06-01', { status: 'done' })
    await daily('b', '2026-06-01', { status: 'done' })
    await daily('c', '2026-06-01')
    await daily('d', '2026-06-30')
    await daily('sub', '2026-06-01', { parentId: 'a' })
    await daily('may', '2026-05-31')
    await daily('july', '2026-07-01')
    await seedTask(db, { id: 'inbox-task' })

    const result = (await invoke('task-vault:vault:get-calendar-month', {
      year: 2026,
      month: 6,
    })) as { days: { date: string; status: string; count: number }[] }

    expect(result.days.map((day) => ({ ...day }))).toEqual(
      expect.arrayContaining([
        { date: '2026-06-01', status: 'done', count: 2 },
        { date: '2026-06-01', status: 'open', count: 1 },
        { date: '2026-06-30', status: 'open', count: 1 },
      ])
    )
    expect(result.days).toHaveLength(3)
  })

  it('returns no days for a month without tasks', async () => {
    expect(await invoke('task-vault:vault:get-calendar-month', { year: 2026, month: 1 })).toEqual({
      days: [],
    })
  })
})

describe('task-vault:vault:export-json and import-json', () => {
  const now = '2026-02-01T10:00:00.000Z'

  it('exports every task, project and area with a version and timestamp', async () => {
    await seedArea(db, 'a1', 'Work')
    await seedProject(db, 'p1', 'Alpha')
    await seedTask(db, { id: 't1' })
    await seedTask(db, { id: 't2' })

    const result = (await invoke('task-vault:vault:export-json')) as {
      version: number
      exportedAt: string
      tasks: { id: string }[]
      projects: { name: string }[]
      areas: { name: string }[]
    }

    expect(result.version).toBe(1)
    expect(Number.isNaN(Date.parse(result.exportedAt))).toBe(false)
    expect(result.tasks.map((task) => task.id)).toEqual(['t1', 't2'])
    expect(result.projects.map((project) => project.name)).toEqual(['Alpha'])
    expect(result.areas.map((area) => area.name)).toEqual(['Work'])
  })

  it('returns the error when the database fails', async () => {
    await db.exec('DROP TABLE tasks')
    expect(await invoke('task-vault:vault:export-json')).toMatchObject({
      error: expect.stringContaining('no such table'),
    })
  })

  it('imports areas, projects and tasks, linking tasks to the project and area by name', async () => {
    const result = await invoke('task-vault:vault:import-json', {
      version: 1,
      areas: [{ id: 'a1', name: 'Work', created_at: now }],
      projects: [{ id: 'p1', name: 'Project', status: 'active', created_at: now, updated_at: now }],
      tasks: [
        {
          id: 't1',
          text: 'Task',
          project: 'Project',
          area: 'Work',
          created_at: now,
          updated_at: now,
        },
      ],
    })

    expect(result).toEqual({ success: true, imported: 3 })
    expect(await taskRow(db, 't1')).toMatchObject({
      text: 'Task',
      status: 'open',
      source: 'inbox',
      project_id: 'p1',
      area_id: 'a1',
    })
  })

  it('imports tasks alone and an empty payload as nothing', async () => {
    expect(
      await invoke('task-vault:vault:import-json', {
        tasks: [{ id: 't1', text: 'Task', created_at: now, updated_at: now }],
      })
    ).toEqual({ success: true, imported: 1 })
    expect(await invoke('task-vault:vault:import-json', {})).toEqual({
      success: true,
      imported: 0,
    })
  })

  it('skips rows whose id already exists instead of overwriting them', async () => {
    await seedTask(db, { id: 't1', text: 'Original' })

    await invoke('task-vault:vault:import-json', {
      tasks: [{ id: 't1', text: 'Imported', created_at: now, updated_at: now }],
    })

    expect(await taskRow(db, 't1')).toMatchObject({ text: 'Original' })
  })

  it('carries tasks from one database to another through an export', async () => {
    await seedTask(db, {
      id: 't1',
      text: 'Round trip',
      status: 'done',
      dueDate: '2026-03-01',
      metadata: JSON.stringify({ description: 'kept' }),
    })
    const exported = await invoke('task-vault:vault:export-json')

    const other = await createVaultDb()
    const otherHarness = createIpcHarness()
    registerVaultIpcHandlers(otherHarness.api, other)
    await otherHarness.invoke('task-vault:vault:import-json', exported)

    expect(await taskRow(other, 't1')).toMatchObject({
      text: 'Round trip',
      status: 'done',
      due_date: '2026-03-01',
      metadata: JSON.stringify({ description: 'kept' }),
    })
  })

  it('keeps every project in its area through an export into an empty database', async () => {
    await seedArea(db, 'a1', 'Work')
    await seedArea(db, 'a2', 'Home')
    await seedProject(db, 'p1', 'Alpha', { areaId: 'a1' })
    await seedProject(db, 'p2', 'Beta', { areaId: 'a2' })
    await seedProject(db, 'p3', 'Loose')
    const exported = await invoke('task-vault:vault:export-json')

    const other = await createVaultDb()
    const otherHarness = createIpcHarness()
    registerVaultIpcHandlers(otherHarness.api, other)
    await otherHarness.invoke('task-vault:vault:import-json', exported)

    const projects = await other.query<{ name: string; area_id: string | null }>(
      `SELECT name, area_id FROM projects ORDER BY name`
    )
    expect(projects).toEqual([
      { name: 'Alpha', area_id: 'a1' },
      { name: 'Beta', area_id: 'a2' },
      { name: 'Loose', area_id: null },
    ])
  })

  it('keeps each task in its project and area through an export', async () => {
    await seedArea(db, 'a1', 'Work')
    await seedProject(db, 'p1', 'Alpha', { areaId: 'a1' })
    await seedTask(db, { id: 'in-project', projectId: 'p1' })
    await seedTask(db, { id: 'in-area', areaId: 'a1' })
    const exported = await invoke('task-vault:vault:export-json')

    const other = await createVaultDb()
    const otherHarness = createIpcHarness()
    registerVaultIpcHandlers(otherHarness.api, other)
    await otherHarness.invoke('task-vault:vault:import-json', exported)

    expect(await taskRow(other, 'in-project')).toMatchObject({ project_id: 'p1', area_id: null })
    expect(await taskRow(other, 'in-area')).toMatchObject({ project_id: null, area_id: 'a1' })
  })

  it('places an imported project in the area named by its legacy area field', async () => {
    await invoke('task-vault:vault:import-json', {
      areas: [{ id: 'a1', name: 'Work', created_at: now }],
      projects: [{ id: 'p1', name: 'Alpha', area: 'Work', created_at: now, updated_at: now }],
    })

    expect(await db.get(`SELECT area_id FROM projects WHERE id = 'p1'`)).toEqual({ area_id: 'a1' })
  })

  it.each([null, 'not-an-object'])('returns INVALID_PAYLOAD for %j', async (payload) => {
    expect(await invoke('task-vault:vault:import-json', payload)).toEqual({
      error: 'INVALID_PAYLOAD',
    })
  })

  it('returns the database error when a row violates the schema', async () => {
    const result = await invoke('task-vault:vault:import-json', {
      areas: [{ id: 'a1', name: null, created_at: now }],
    })

    expect(result).toMatchObject({ error: expect.stringContaining('NOT NULL') })
    expect(await db.query('SELECT id FROM areas')).toEqual([])
  })
})

describe('task-vault settings and today_since', () => {
  it('set-stale-threshold stores the days and overwrites a previous value', async () => {
    await invoke('task-vault:settings:set-stale-threshold', { days: 5 })
    await invoke('task-vault:settings:set-stale-threshold', { days: 9 })

    const rows = await db.query<{ value: string }>(
      `SELECT value FROM settings WHERE extension_id = 'task-vault' AND key = 'stale_days_threshold'`
    )
    expect(rows.map((row) => row.value)).toEqual(['9'])
  })

  it.each([0, 'ten', undefined])('set-stale-threshold rejects %j', async (days) => {
    expect(await invoke('task-vault:settings:set-stale-threshold', { days })).toEqual({
      error: 'VALIDATION_ERROR',
    })
  })

  it('reset-today-since sets today_since to today', async () => {
    await seedTask(db, { id: 't1', todaySince: '2026-01-01' })

    expect(await invoke('task-vault:vault:reset-today-since', { taskId: 't1' })).toEqual({
      success: true,
    })
    expect(await taskRow(db, 't1')).toMatchObject({ today_since: localDate() })
  })
})
