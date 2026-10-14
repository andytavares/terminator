import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { localDate } from '../../src/utils/local-date'
import {
  createIpcHarness,
  createVaultDb,
  seedArea,
  seedProject,
  seedTask,
  selectTaskRow,
  taskMetadata,
} from '../support/vault-db'
import { restoreLocalClock, setLocalClock } from '../support/clock'

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

const taskIds = async (where = '1=1') =>
  (await db.query<{ id: string }>(`SELECT id FROM tasks WHERE ${where} ORDER BY id`)).map(
    (row) => row.id
  )

describe('registerVaultIpcHandlers', () => {
  it('dispose removes every registered channel', () => {
    const own = createIpcHarness()
    const dispose = registerVaultIpcHandlers(own.api, db)
    expect(own.channels()).toEqual(expect.arrayContaining(['task-vault:vault:capture']))
    dispose()
    expect(own.channels()).toEqual([])
  })
})

describe('task-vault:vault:get-inbox', () => {
  it('returns no tasks when the inbox is empty', async () => {
    expect(await harness.invoke('task-vault:vault:get-inbox')).toEqual({ tasks: [] })
  })

  it('returns open top-level inbox tasks, with their subtasks, oldest first', async () => {
    await seedTask(db, { id: 'second', text: 'Second', createdAt: '2026-01-02T00:00:00.000Z' })
    await seedTask(db, { id: 'first', text: 'First', createdAt: '2026-01-01T00:00:00.000Z' })
    await seedTask(db, { id: 'child', parentId: 'first', text: 'Child' })
    await seedTask(db, { id: 'done', status: 'done' })
    await seedTask(db, { id: 'planned', source: 'daily', sourceRef: '2026-01-01' })

    const result = (await harness.invoke('task-vault:vault:get-inbox')) as {
      tasks: { id: string; text: string; subtasks?: { id: string }[] }[]
    }

    expect(result.tasks.map((task) => task.id)).toEqual(['first', 'second'])
    expect(result.tasks[0].subtasks?.map((task) => task.id)).toEqual(['child'])
  })

  it('returns the error when the database fails', async () => {
    await db.exec('DROP TABLE tasks')
    expect(await harness.invoke('task-vault:vault:get-inbox')).toMatchObject({
      error: expect.stringContaining('no such table'),
    })
  })
})

describe('task-vault:vault:complete-task', taskVaultVaultCompleteTaskTests)

describe('task-vault:vault:delete-task', () => {
  it('deletes the task and its subtasks at every depth, leaving others', async () => {
    await seedTask(db, { id: 'parent-1' })
    await seedTask(db, { id: 'child', parentId: 'parent-1' })
    await seedTask(db, { id: 'grandchild', parentId: 'child' })
    await seedTask(db, { id: 'bystander' })

    expect(await harness.invoke('task-vault:vault:delete-task', { taskId: 'parent-1' })).toEqual({
      success: true,
    })
    expect(await taskIds()).toEqual(['bystander'])
  })

  it('returns STALE_ID for an unknown task', async () => {
    expect(await harness.invoke('task-vault:vault:delete-task', { taskId: 'ghost-id' })).toEqual({
      error: 'STALE_ID',
    })
  })
})

describe('task-vault:vault:cancel-task', () => {
  it('sets the task to cancelled', async () => {
    await seedTask(db, { id: 'task-1' })

    expect(await harness.invoke('task-vault:vault:cancel-task', { taskId: 'task-1' })).toEqual({
      success: true,
    })
    expect(await selectTaskRow(db, 'task-1')).toMatchObject({ status: 'cancelled' })
  })

  it('returns STALE_ID for an unknown task', async () => {
    expect(await harness.invoke('task-vault:vault:cancel-task', { taskId: 'missing' })).toEqual({
      error: 'STALE_ID',
    })
  })
})

describe.each(['restore-task', 'reopen-task'])('task-vault:vault:%s', (action) => {
  const channel = `task-vault:vault:${action}`
  describe('reopening', () => taskReopeningTests(channel))
  describe('migrations', () => migrationTests(channel))
})

function taskReopeningTests(channel: string) {
  it('reopens a finished task and clears its completion', async () => {
    await seedTask(db, { id: 'task-1', status: 'done', completedDate: '2026-01-05' })

    expect(await harness.invoke(channel, { taskId: 'task-1' })).toEqual({ success: true })
    expect(await selectTaskRow(db, 'task-1')).toMatchObject({
      status: 'open',
      completed_date: null,
    })
  })

  it('returns STALE_ID for an unknown task', async () => {
    expect(await harness.invoke(channel, { taskId: 'gone' })).toEqual({ error: 'STALE_ID' })
  })
}

function migrationTests(channel: string) {
  describe('twins', () => migrationTwinTests(channel))
  describe('subtasks', () => migrationSubtaskTests(channel))
}

function migrationTwinTests(channel: string) {
  it('deletes the migration twin and its subtasks and forgets the twin id', async () => {
    await seedTask(db, {
      id: 'original',
      status: 'migrated',
      metadata: JSON.stringify({ migration_twin_id: 'twin', keep: 'me' }),
    })
    await seedTask(db, { id: 'twin', source: 'daily', sourceRef: '2026-01-12' })
    await seedTask(db, { id: 'twin-child', parentId: 'twin' })

    await harness.invoke(channel, { taskId: 'original' })

    expect(await taskIds()).toEqual(['original'])
    expect(await taskMetadata(db, 'original')).toEqual({ keep: 'me' })
  })
}

function migrationSubtaskTests(channel: string) {
  it('reopens the migrated subtasks of the task', async () => {
    await seedTask(db, { id: 'parent-1', status: 'migrated' })
    await seedTask(db, {
      id: 'sub',
      parentId: 'parent-1',
      status: 'migrated',
      migratedTo: '2026-01-12',
      metadata: JSON.stringify({ migration_twin_id: 'sub-twin' }),
    })

    await harness.invoke(channel, { taskId: 'parent-1' })

    expect(await selectTaskRow(db, 'sub')).toMatchObject({ status: 'open', migrated_to: null })
    expect(await taskMetadata(db, 'sub')).toEqual({})
  })
}

describe('task-vault:vault:restore-task', () => {
  it('moves the task to today, unlike reopen-task which keeps its source', async () => {
    await seedTask(db, { id: 'restored', status: 'cancelled', source: 'someday' })
    await seedTask(db, { id: 'reopened', status: 'cancelled', source: 'someday' })

    await harness.invoke('task-vault:vault:restore-task', { taskId: 'restored' })
    await harness.invoke('task-vault:vault:reopen-task', { taskId: 'reopened' })

    expect(await selectTaskRow(db, 'restored')).toMatchObject({
      source: 'daily',
      source_ref: localDate(),
    })
    expect(await selectTaskRow(db, 'reopened')).toMatchObject({
      source: 'someday',
      source_ref: null,
    })
  })
})

describe('task-vault:vault:edit-task', () => {
  it('rewrites the text and its inline tags', async () => {
    await seedTask(db, { id: 'task-1', text: 'Old', context: 'Home' })

    expect(
      await harness.invoke('task-vault:vault:edit-task', {
        taskId: 'task-1',
        text: 'New text @alpha +office due:2026-04-01',
      })
    ).toEqual({ success: true })

    const row = await db.get<Record<string, unknown>>(
      `SELECT t.text, t.context, t.due_date, p.name AS project
       FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = 'task-1'`
    )
    expect(row).toMatchObject({
      text: 'New text',
      context: 'Office',
      due_date: '2026-04-01',
      project: 'Alpha',
    })
  })

  it('returns STALE_ID for an unknown task and creates no project', async () => {
    expect(
      await harness.invoke('task-vault:vault:edit-task', { taskId: 'gone', text: 'hi @x' })
    ).toEqual({
      error: 'STALE_ID',
    })
  })
})

const addTaskVia = (payload: unknown) => harness.invoke('task-vault:vault:add-task', payload)

describe('task-vault:vault:add-task', taskVaultVaultAddTaskTests)

describe('task-vault:vault:add-subtask', () => {
  it('adds a subtask that inherits the parent source', async () => {
    await seedTask(db, { id: 'task-1', source: 'daily', sourceRef: '2026-05-20' })

    expect(
      await harness.invoke('task-vault:vault:add-subtask', {
        taskId: 'task-1',
        text: '  Sub item  ',
      })
    ).toEqual({ success: true })

    const child = await db.get<Record<string, unknown>>(
      `SELECT * FROM tasks WHERE parent_id = 'task-1'`
    )
    expect(child).toMatchObject({ text: 'Sub item', source: 'daily', source_ref: '2026-05-20' })
  })

  it('returns STALE_ID when the parent does not exist', async () => {
    expect(
      await harness.invoke('task-vault:vault:add-subtask', { taskId: 'gone', text: 'Sub item' })
    ).toEqual({ error: 'STALE_ID' })
  })
})

type Today = {
  date: string
  tasks: { id: string; subtasks?: { id: string }[] }[]
  rolledOver: number
  rolledOverIds: string[]
  exists: boolean
  staleDaysThreshold: number
}

const getTodayVia = () => harness.invoke('task-vault:vault:get-today') as Promise<Today>

describe('task-vault:vault:get-today', taskVaultVaultGetTodayTests)

describe('task-vault:vault:get-daily', () => {
  it('returns the tasks of the given date only', async () => {
    await seedTask(db, { id: 'on-date', source: 'daily', sourceRef: '2026-05-20' })
    await seedTask(db, { id: 'other-date', source: 'daily', sourceRef: '2026-05-21' })

    const result = (await harness.invoke('task-vault:vault:get-daily', { date: '2026-05-20' })) as {
      date: string
      tasks: { id: string }[]
      exists: boolean
    }

    expect(result.date).toBe('2026-05-20')
    expect(result.tasks.map((task) => task.id)).toEqual(['on-date'])
    expect(result.exists).toBe(true)
  })
})

const migrateVia = (payload: unknown) => harness.invoke('task-vault:vault:migrate-task', payload)

describe('task-vault:vault:migrate-task', taskVaultVaultMigrateTaskTests)

const idsListed = async (payload: unknown) =>
  (
    (await harness.invoke('task-vault:vault:query', payload)) as { tasks: { id: string }[] }
  ).tasks.map((task) => task.id)

describe('task-vault:vault:query', taskVaultVaultQueryTests)

describe('task-vault:projects:get-tasks', () => {
  it("returns the project's tasks and no others", async () => {
    await seedProject(db, 'p1', 'MyProject')
    await seedTask(db, { id: 'in-project', projectId: 'p1' })
    await seedTask(db, { id: 'elsewhere' })

    const result = (await harness.invoke('task-vault:projects:get-tasks', {
      projectName: 'MyProject',
    })) as { tasks: { id: string }[] }

    expect(result.tasks.map((task) => task.id)).toEqual(['in-project'])
  })
})

describe('task-vault:vault:block-task and unblock-task', taskVaultVaultBlockTaskTests)

describe('task-vault:vault:reorder-tasks', () => {
  it('sets sort_order to the position in the given list', async () => {
    for (const id of ['id-1', 'id-2', 'id-3']) await seedTask(db, { id })

    expect(
      await harness.invoke('task-vault:vault:reorder-tasks', {
        orderedIds: ['id-3', 'id-1', 'id-2'],
      })
    ).toEqual({ success: true })

    const order = await db.query<{ id: string }>(`SELECT id FROM tasks ORDER BY sort_order`)
    expect(order.map((row) => row.id)).toEqual(['id-3', 'id-1', 'id-2'])
  })
})

describe('task-vault:vault task detail', taskVaultVaultTaskDetailTests)
describe('task-vault:vault:list-archive', taskVaultVaultListArchiveTests)

function taskVaultVaultCompleteTaskTests() {
  describe('completing', taskVaultVaultCompleteTaskCompletingTests)
  describe('recurrence', taskVaultVaultCompleteTaskRecurrenceTests)
}

function taskVaultVaultCompleteTaskCompletingTests() {
  it('marks the task done with today as its completion date', async () => {
    await seedTask(db, { id: 'task-1' })

    expect(await harness.invoke('task-vault:vault:complete-task', { taskId: 'task-1' })).toEqual({
      success: true,
    })
    expect(await selectTaskRow(db, 'task-1')).toMatchObject({
      status: 'done',
      completed_date: localDate(),
    })
  })

  it('returns STALE_ID for an unknown task', async () => {
    expect(
      await harness.invoke('task-vault:vault:complete-task', { taskId: 'missing-id' })
    ).toEqual({
      error: 'STALE_ID',
    })
  })

  it('spawns no new task for a task without recurrence', async () => {
    await seedTask(db, { id: 'task-1', dueDate: '2026-01-10' })

    await harness.invoke('task-vault:vault:complete-task', { taskId: 'task-1' })

    expect(await taskIds()).toEqual(['task-1'])
  })
}

function taskVaultVaultCompleteTaskRecurrenceTests() {
  it('spawns the next occurrence of a recurring task in the same transaction', async () => {
    await seedTask(db, {
      id: 'daily',
      source: 'daily',
      sourceRef: localDate(),
      dueDate: localDate(),
      recurrenceRule: 'daily',
    })

    await harness.invoke('task-vault:vault:complete-task', { taskId: 'daily' })

    const next = await db.get<Record<string, unknown>>(
      `SELECT * FROM tasks WHERE recurrence_template_id = 'daily'`
    )
    expect(next).toMatchObject({ status: 'open', recurrence_rule: 'daily' })
    expect((next?.due_date as string) > localDate()).toBe(true)
  })

  it('does not create a notification (the renderer owns that event)', async () => {
    await seedTask(db, { id: 'task-1' })
    await harness.invoke('task-vault:vault:complete-task', { taskId: 'task-1' })
    expect(harness.createNotification).not.toHaveBeenCalled()
  })
}

function taskVaultVaultAddTaskTests() {
  describe('inbox and daily', taskVaultVaultAddTaskInboxDailyTests)
  describe('tags', taskVaultVaultAddTaskTagsTests)
}

function taskVaultVaultAddTaskInboxDailyTests() {
  it('inserts an inbox task and returns its id', async () => {
    const { taskId } = (await addTaskVia({ filePath: 'inbox', text: 'New task' })) as {
      taskId: string
    }

    expect(await selectTaskRow(db, taskId)).toMatchObject({
      text: 'New task',
      source: 'inbox',
      source_ref: null,
    })
  })

  it('resolves the daily source and date from the file path', async () => {
    const { taskId } = (await addTaskVia({
      filePath: 'daily/2026-05-20.md',
      text: 'Daily task',
    })) as { taskId: string }

    expect(await selectTaskRow(db, taskId)).toMatchObject({
      source: 'daily',
      source_ref: '2026-05-20',
      today_since: '2026-05-20',
    })
  })
}

function taskVaultVaultAddTaskTagsTests() {
  it('applies the tags it is given', async () => {
    const { taskId } = (await addTaskVia({
      filePath: 'inbox',
      text: 'Tagged',
      dueDate: '2026-07-01',
      tags: { project: 'alpha', context: 'office', area: 'work' },
    })) as { taskId: string }

    const row = await db.get<Record<string, unknown>>(
      `SELECT t.context, t.due_date, p.name AS project, a.name AS area
       FROM tasks t JOIN projects p ON p.id = t.project_id JOIN areas a ON a.id = t.area_id
       WHERE t.id = ?`,
      [taskId]
    )
    expect(row).toMatchObject({
      context: 'Office',
      due_date: '2026-07-01',
      project: 'Alpha',
      area: 'Work',
    })
  })
}

function taskVaultVaultGetTodayTests() {
  describe('empty and listing', taskVaultVaultGetTodayEmptyListingTests)
  describe('threshold', taskVaultVaultGetTodayThresholdTests)
  describe('rolling over', taskVaultVaultGetTodayRollingOverTests)
  describe('not rolling over', taskVaultVaultGetTodayNotRollingOverTests)
}

function taskVaultVaultGetTodayEmptyListingTests() {
  it("returns today's date and no tasks for an empty database", async () => {
    const result = await getTodayVia()

    expect(result).toMatchObject({
      date: localDate(),
      tasks: [],
      exists: false,
      rolledOver: 0,
      staleDaysThreshold: 7,
    })
  })

  it("returns today's top-level tasks with their subtasks", async () => {
    await seedTask(db, { id: 'today-1', source: 'daily', sourceRef: localDate() })
    await seedTask(db, { id: 'sub', parentId: 'today-1', source: 'daily', sourceRef: localDate() })
    await seedTask(db, { id: 'tomorrow', source: 'daily', sourceRef: '2999-01-01' })

    const result = await getTodayVia()

    expect(result.exists).toBe(true)
    expect(result.tasks.map((task) => task.id)).toEqual(['today-1'])
    expect(result.tasks[0].subtasks?.map((task) => task.id)).toEqual(['sub'])
  })
}

function taskVaultVaultGetTodayThresholdTests() {
  it('reads the stale threshold from the "Stale task threshold" setting', async () => {
    harness.settings.set('terminator.task-vault.staleThresholdDays', 12)
    expect((await getTodayVia()).staleDaysThreshold).toBe(12)
  })
}

/** A task with one subtask on an earlier day's log, there since 2026-04-28. */
async function seedPastTaskWithSubtask(status: string): Promise<void> {
  await seedTask(db, {
    id: 'old',
    status,
    source: 'daily',
    sourceRef: '2026-05-01',
    todaySince: '2026-04-28',
  })
  await seedTask(db, { id: 'old-sub', parentId: 'old', source: 'daily', sourceRef: '2026-05-01' })
}

function taskVaultVaultGetTodayRollingOverTests() {
  it.each(['open', 'blocked', 'in-progress'])(
    'rolls a %s task from a past day over to today and marks the original migrated',
    async (status) => {
      await seedPastTaskWithSubtask(status)
      const result = await getTodayVia()

      expect(result.rolledOver).toBe(1)
      expect(await selectTaskRow(db, 'old')).toMatchObject({
        status: 'migrated',
        migrated_to: localDate(),
      })
      expect(await selectTaskRow(db, 'old-sub')).toMatchObject({ source_ref: localDate() })
      const [newId] = result.rolledOverIds
      expect(await selectTaskRow(db, newId)).toMatchObject({
        status: 'open',
        source: 'daily',
        source_ref: localDate(),
        today_since: '2026-04-28',
      })
      expect(result.tasks.map((task) => task.id)).toContain(newId)
    }
  )
}

function taskVaultVaultGetTodayNotRollingOverTests() {
  it('does not roll over recurring, finished or sub tasks', async () => {
    await seedTask(db, {
      id: 'recurring',
      source: 'daily',
      sourceRef: '2026-05-01',
      recurrenceRule: 'daily',
    })
    await seedTask(db, { id: 'done', status: 'done', source: 'daily', sourceRef: '2026-05-01' })
    await seedTask(db, { id: 'parent-1', status: 'done', source: 'daily', sourceRef: '2026-05-01' })
    await seedTask(db, {
      id: 'sub',
      parentId: 'parent-1',
      source: 'daily',
      sourceRef: '2026-05-01',
    })

    expect((await getTodayVia()).rolledOver).toBe(0)
  })

  it('returns the error when the database fails', async () => {
    await db.exec('DROP TABLE tasks')
    expect(await harness.invoke('task-vault:vault:get-today')).toMatchObject({
      error: expect.stringContaining('no such table'),
    })
  })
}

function taskVaultVaultMigrateTaskTests() {
  describe('migrating', taskVaultVaultMigrateTaskMigratingTests)
  describe('subtasks', taskVaultVaultMigrateTaskSubtasksTests)
  describe('no-ops and errors', taskVaultVaultMigrateTaskNoOpsErrorsTests)
}

const CARRY_ON = {
  id: 'task-1',
  text: 'Carry on',
  projectId: 'p1',
  context: 'Home',
  source: 'daily',
  sourceRef: '2026-05-20',
}

function taskVaultVaultMigrateTaskMigratingTests() {
  it('marks the task migrated and creates an open twin on the target date', async () => {
    await seedProject(db, 'p1', 'Alpha')
    await seedTask(db, CARRY_ON)

    const { newTaskId } = (await migrateVia({ taskId: 'task-1', targetDate: '2026-05-21' })) as {
      newTaskId: string
    }

    expect(await selectTaskRow(db, 'task-1')).toMatchObject({
      status: 'migrated',
      migrated_to: '2026-05-21',
    })
    expect(await taskMetadata(db, 'task-1')).toEqual({ migration_twin_id: newTaskId })
    expect(await selectTaskRow(db, newTaskId)).toMatchObject({
      text: 'Carry on',
      status: 'open',
      project_id: 'p1',
      context: 'Home',
      source: 'daily',
      source_ref: '2026-05-21',
    })
  })
}

function taskVaultVaultMigrateTaskSubtasksTests() {
  it('migrates subtasks too, as twins under the new parent', async () => {
    await seedTask(db, { id: 'task-1', source: 'daily', sourceRef: '2026-05-20' })
    await seedTask(db, { id: 'sub-1', parentId: 'task-1', text: 'Subtask one', sortOrder: 0 })
    await seedTask(db, {
      id: 'sub-2',
      parentId: 'task-1',
      text: 'Subtask two',
      sortOrder: 1,
      status: 'done',
    })

    const { newTaskId } = (await migrateVia({ taskId: 'task-1', targetDate: '2026-05-21' })) as {
      newTaskId: string
    }

    expect(await selectTaskRow(db, 'sub-1')).toMatchObject({ status: 'migrated' })
    expect(await selectTaskRow(db, 'sub-2')).toMatchObject({ status: 'migrated' })
    const twins = await db.query<Record<string, unknown>>(
      `SELECT text, status, source_ref FROM tasks WHERE parent_id = ? ORDER BY sort_order`,
      [newTaskId]
    )
    expect(twins.map((twin) => ({ ...twin }))).toEqual([
      { text: 'Subtask one', status: 'open', source_ref: '2026-05-21' },
      { text: 'Subtask two', status: 'done', source_ref: '2026-05-21' },
    ])
  })
}

function taskVaultVaultMigrateTaskNoOpsErrorsTests() {
  it('is a no-op when the task is already on the target date', async () => {
    await seedTask(db, { id: 'task-1', source: 'daily', sourceRef: '2026-05-21' })

    expect(await migrateVia({ taskId: 'task-1', targetDate: '2026-05-21' })).toMatchObject({
      noop: true,
      newTaskId: 'task-1',
    })
    expect(await taskIds()).toEqual(['task-1'])
    expect(await selectTaskRow(db, 'task-1')).toMatchObject({ status: 'open' })
  })

  it('returns STALE_ID for an unknown task', async () => {
    expect(await migrateVia({ taskId: 'ghost', targetDate: '2026-05-21' })).toMatchObject({
      error: 'STALE_ID',
    })
  })
}

function taskVaultVaultQueryTests() {
  beforeEach(seedQueryTasks)

  describe('unfiltered', taskVaultVaultQueryUnfilteredTests)
  describe('filtered', taskVaultVaultQueryFilteredTests)
}

/** Four tasks, oldest first: one matching every filter, and three that each miss one. */
async function seedQueryTasks() {
  await seedProject(db, 'p1', 'Alpha')
  await seedArea(db, 'a1', 'Work')
  await seedTask(db, {
    id: 'match',
    context: 'office',
    projectId: 'p1',
    areaId: 'a1',
    dueDate: '2026-05-01',
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  await seedTask(db, {
    id: 'in-progress',
    status: 'in-progress',
    createdAt: '2026-01-02T00:00:00.000Z',
  })
  await seedTask(db, {
    id: 'late',
    context: 'office',
    projectId: 'p1',
    areaId: 'a1',
    dueDate: '2026-08-01',
    createdAt: '2026-01-03T00:00:00.000Z',
  })
  await seedTask(db, { id: 'done', status: 'done', createdAt: '2026-01-04T00:00:00.000Z' })
}

function taskVaultVaultQueryUnfilteredTests() {
  it('returns every task, oldest first, when no filter is given', async () => {
    expect(await idsListed({})).toEqual(['match', 'in-progress', 'late', 'done'])
  })

  it('filters by a list of statuses', async () => {
    expect(await idsListed({ status: ['open', 'in-progress'] })).toEqual([
      'match',
      'in-progress',
      'late',
    ])
  })
}

function taskVaultVaultQueryFilteredTests() {
  it('filters by a single status', async () => {
    expect(await idsListed({ status: 'done' })).toEqual(['done'])
  })

  it('combines context, project, area and dueBefore', async () => {
    expect(
      await idsListed({
        context: 'office',
        project: 'Alpha',
        area: 'Work',
        dueBefore: '2026-06-01',
      })
    ).toEqual(['match'])
  })

  it('returns nothing when no task matches every filter', async () => {
    expect(await idsListed({ context: 'elsewhere' })).toEqual([])
  })
}

function taskVaultVaultBlockTaskTests() {
  describe('blocking', taskVaultVaultBlockTaskBlockingTests)
  describe('unblocking', taskVaultVaultBlockTaskUnblockingTests)
}

function taskVaultVaultBlockTaskBlockingTests() {
  it('blocks a task, recording the reason and check interval in the columns and metadata', async () => {
    await seedTask(db, { id: 'task-1', metadata: JSON.stringify({ keep: 'me' }) })

    const result = await harness.invoke('task-vault:vault:block-task', {
      taskId: 'task-1',
      reason: 'Waiting on design',
      checkInterval: '1-day',
    })

    expect(result).toEqual({ success: true })
    expect(await selectTaskRow(db, 'task-1')).toMatchObject({
      status: 'blocked',
      blocked_reason: 'Waiting on design',
      blocked_check_interval: '1-day',
    })
    expect(await taskMetadata(db, 'task-1')).toEqual({
      keep: 'me',
      blocked_reason: 'Waiting on design',
      blocked_check_interval: '1-day',
    })
  })
}

function taskVaultVaultBlockTaskUnblockingTests() {
  describe('reopening', taskVaultVaultBlockTaskUnblockingReopeningTests)
  describe('missing tasks', taskVaultVaultBlockTaskUnblockingMissingTasksTests)
}

function taskVaultVaultBlockTaskUnblockingReopeningTests() {
  it('unblocking reopens the task and clears the reason everywhere', async () => {
    await seedTask(db, { id: 'task-1' })
    await harness.invoke('task-vault:vault:block-task', {
      taskId: 'task-1',
      reason: 'X',
      checkInterval: '1-day',
    })

    expect(await harness.invoke('task-vault:vault:unblock-task', { taskId: 'task-1' })).toEqual({
      success: true,
    })
    expect(await selectTaskRow(db, 'task-1')).toMatchObject({
      status: 'open',
      blocked_reason: null,
      blocked_check_interval: null,
    })
    expect(await taskMetadata(db, 'task-1')).toEqual({})
  })
}

function taskVaultVaultBlockTaskUnblockingMissingTasksTests() {
  it.each(['block-task', 'unblock-task'])(
    '%s returns STALE_ID for an unknown task',
    async (name) => {
      expect(
        await harness.invoke(`task-vault:vault:${name}`, {
          taskId: 'missing',
          reason: 'X',
          checkInterval: '2-hour',
        })
      ).toEqual({ error: 'STALE_ID' })
    }
  )
}

function taskVaultVaultTaskDetailTests() {
  describe('reading', taskVaultVaultTaskDetailReadingTests)
  describe('saving', taskVaultVaultTaskDetailSavingTests)
}

function taskVaultVaultTaskDetailReadingTests() {
  it('returns the detail fields stored in metadata, empty when absent', async () => {
    await seedTask(db, {
      id: 'detailed',
      metadata: JSON.stringify({
        description: 'Describe it',
        acceptance_criteria: '- [ ] criterion',
        dev_hints: 'Use X pattern',
      }),
    })
    await seedTask(db, { id: 'bare' })

    expect(
      await harness.invoke('task-vault:vault:get-task-detail', { taskId: 'detailed' })
    ).toEqual({
      description: 'Describe it',
      acceptanceCriteria: '- [ ] criterion',
      devHints: 'Use X pattern',
    })
    expect(await harness.invoke('task-vault:vault:get-task-detail', { taskId: 'bare' })).toEqual({
      description: '',
      acceptanceCriteria: '',
      devHints: '',
    })
  })
}

function taskVaultVaultTaskDetailSavingTests() {
  describe('merging', taskVaultVaultTaskDetailSavingMergingTests)
  describe('missing tasks', taskVaultVaultTaskDetailSavingMissingTasksTests)
}

function taskVaultVaultTaskDetailSavingMergingTests() {
  it('save-task-detail merges the fields into existing metadata', async () => {
    await seedTask(db, { id: 'task-1', metadata: JSON.stringify({ other: 'value' }) })

    expect(
      await harness.invoke('task-vault:vault:save-task-detail', {
        taskId: 'task-1',
        description: 'New desc',
        acceptanceCriteria: '- [ ] AC',
        devHints: 'Hint',
      })
    ).toEqual({ ok: true })

    expect(await taskMetadata(db, 'task-1')).toEqual({
      other: 'value',
      description: 'New desc',
      acceptance_criteria: '- [ ] AC',
      dev_hints: 'Hint',
    })
  })
}

function taskVaultVaultTaskDetailSavingMissingTasksTests() {
  it('reports a missing task', async () => {
    expect(await harness.invoke('task-vault:vault:get-task-detail', { taskId: 'nope' })).toEqual({
      error: 'Task not found',
    })
    expect(
      await harness.invoke('task-vault:vault:save-task-detail', {
        taskId: 'nope',
        description: '',
        acceptanceCriteria: '',
        devHints: '',
      })
    ).toEqual({ error: 'Task not found' })
  })
}

function taskVaultVaultListArchiveTests() {
  describe('listing', taskVaultVaultListArchiveListingTests)
  describe('the window', taskVaultVaultListArchiveWindowTests)
  describe('areas and errors', taskVaultVaultListArchiveAreasErrorsTests)
}

function taskVaultVaultListArchiveListingTests() {
  it('returns finished tasks within the window, archived projects and archived areas', async () => {
    const recent = new Date().toISOString()
    await seedTask(db, { id: 'recent-done', status: 'done', updatedAt: recent })
    await seedTask(db, { id: 'recent-cancelled', status: 'cancelled', updatedAt: recent })
    await seedTask(db, { id: 'ancient', status: 'done', updatedAt: '2020-01-01T00:00:00.000Z' })
    await seedTask(db, { id: 'open', updatedAt: recent })
    await seedArea(db, 'a-old', { name: 'Old Area', status: 'archived' })
    await seedArea(db, 'a-live', 'Live Area')
    await seedProject(db, 'p-old', { name: 'Old Project', status: 'archived', areaId: 'a-old' })
    await seedProject(db, 'p-live', 'Live Project')

    const result = (await harness.invoke('task-vault:vault:list-archive', { days: 30 })) as {
      tasks: { id: string }[]
      projects: { name: string }[]
      areas: { id: string; name: string; updatedAt: string }[]
    }

    expect(result.tasks.map((task) => task.id).sort()).toEqual(['recent-cancelled', 'recent-done'])
    expect(result.projects.map((project) => project.name)).toEqual(['Old Project'])
    expect(result.areas).toEqual([{ id: 'a-old', name: 'Old Area', updatedAt: expect.any(String) }])
  })
}

/** The ids of the tasks finished within the last `days` days. */
async function archivedTaskIds(days: number): Promise<string[]> {
  const result = (await harness.invoke('task-vault:vault:list-archive', { days })) as {
    tasks: { id: string }[]
  }
  return result.tasks.map((task) => task.id).sort()
}

function taskVaultVaultListArchiveWindowTests() {
  afterEach(restoreLocalClock)

  it('starts at local midnight west of UTC, the night the clocks went forward', async () => {
    // Monday 00:30 in New York. One day back is Sunday, which began at 05:00 UTC.
    setLocalClock('America/New_York', '2026-03-09T04:30:00.000Z')
    await seedTask(db, {
      id: 'saturday-2345',
      status: 'done',
      updatedAt: '2026-03-08T04:45:00.000Z',
    })
    await seedTask(db, { id: 'sunday-0010', status: 'done', updatedAt: '2026-03-08T05:10:00.000Z' })

    expect(await archivedTaskIds(1)).toEqual(['sunday-0010'])
  })

  it('starts at local midnight east of UTC', async () => {
    // Wednesday 01:00 in Auckland. One day back is Tuesday, which began at 12:00 UTC on Monday.
    setLocalClock('Pacific/Auckland', '2026-06-30T13:00:00.000Z')
    await seedTask(db, { id: 'monday-2330', status: 'done', updatedAt: '2026-06-29T11:30:00.000Z' })
    await seedTask(db, {
      id: 'tuesday-0900',
      status: 'done',
      updatedAt: '2026-06-29T21:00:00.000Z',
    })

    expect(await archivedTaskIds(1)).toEqual(['tuesday-0900'])
  })

  it('takes whole days only', async () => {
    await seedTask(db, { id: 'done', status: 'done', updatedAt: new Date().toISOString() })

    const answer = await harness.invoke('task-vault:vault:list-archive', { days: 1.5 })

    expect(answer).not.toHaveProperty('tasks')
    expect(answer).not.toMatchObject({ error: expect.stringContaining('RangeError') })
  })
}

function taskVaultVaultListArchiveAreasErrorsTests() {
  it('names the area of an archived project', async () => {
    await seedArea(db, 'a1', { name: 'Work', status: 'archived' })
    await seedProject(db, 'p1', { name: 'Old Project', status: 'archived', areaId: 'a1' })

    const result = (await harness.invoke('task-vault:vault:list-archive', {})) as {
      projects: { name: string; area?: string }[]
    }

    expect(result.projects).toMatchObject([{ name: 'Old Project', area: 'Work' }])
  })

  it('returns the error when the database fails', async () => {
    await db.exec('DROP TABLE tasks')
    expect(await harness.invoke('task-vault:vault:list-archive', {})).toMatchObject({
      error: expect.stringContaining('no such table'),
    })
  })
}
