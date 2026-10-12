import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionDB } from '@terminator/extension-sdk'
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

const TASK_ID = 'task-uuid-1'
const SUBTASK_ID = 'subtask-uuid-1'

let db: ExtensionDB
let harness: ReturnType<typeof createIpcHarness>

beforeEach(async () => {
  db = await createVaultDb()
  harness = createIpcHarness()
  registerVaultIpcHandlers(harness.api, db)
  await seedTask(db, { id: TASK_ID, text: 'Item one' })
  await seedTask(db, { id: SUBTASK_ID, text: 'Sub item', parentId: TASK_ID })
})

const processItem = (payload: unknown) =>
  harness.invoke('task-vault:vault:process-inbox-item', payload)

describe('task-vault:vault:process-inbox-item', () => {
  it('trash cancels the item and its subtasks', async () => {
    expect(await processItem({ taskId: TASK_ID, action: 'trash' })).toMatchObject({
      success: true,
    })
    expect(await taskRow(db, TASK_ID)).toMatchObject({ status: 'cancelled' })
    expect(await taskRow(db, SUBTASK_ID)).toMatchObject({ status: 'cancelled' })
  })

  it('do-now moves the task and its subtasks to today and starts the task', async () => {
    expect(await processItem({ taskId: TASK_ID, action: 'do-now' })).toMatchObject({
      success: true,
    })
    expect(await taskRow(db, TASK_ID)).toMatchObject({
      status: 'in-progress',
      source: 'daily',
      source_ref: localDate(),
    })
    expect(await taskRow(db, SUBTASK_ID)).toMatchObject({
      source: 'daily',
      source_ref: localDate(),
    })
  })

  it('someday files the task and its subtasks, clearing source_ref and today_since so it is not immediately stale on return', async () => {
    await db.run(
      `UPDATE tasks SET source='daily', source_ref='2026-01-01', today_since='2026-01-01'`
    )

    expect(await processItem({ taskId: TASK_ID, action: 'someday' })).toMatchObject({
      success: true,
    })

    for (const id of [TASK_ID, SUBTASK_ID]) {
      expect(await taskRow(db, id)).toMatchObject({
        source: 'someday',
        source_ref: null,
        today_since: null,
      })
    }
  })

  it('file with an existing project destination links the task to that project', async () => {
    await seedProject(db, 'p-alpha', 'alpha')

    const result = await processItem({
      taskId: TASK_ID,
      action: 'file',
      destination: 'projects/alpha.md',
    })

    expect(result).toMatchObject({ success: true, newTaskId: TASK_ID })
    expect(await taskRow(db, TASK_ID)).toMatchObject({
      project_id: 'p-alpha',
      source: 'daily',
      source_ref: localDate(),
    })
    expect(await taskRow(db, SUBTASK_ID)).toMatchObject({ project_id: 'p-alpha' })
  })

  it('file with an area destination links the task to that area', async () => {
    await seedArea(db, 'a-home', 'home')

    await processItem({ taskId: TASK_ID, action: 'file', destination: 'areas/home.md' })

    expect(await taskRow(db, TASK_ID)).toMatchObject({ area_id: 'a-home', project_id: null })
  })

  it('file with newProjectName creates the project when missing and links the task', async () => {
    await processItem({ taskId: TASK_ID, action: 'file', newProjectName: 'Brand New Project' })

    const project = await db.get<{ id: string; status: string }>(
      `SELECT id, status FROM projects WHERE name = 'Brand New Project'`
    )
    expect(project?.status).toBe('active')
    expect(await taskRow(db, TASK_ID)).toMatchObject({ project_id: project?.id })
  })

  it('file with newProjectName reuses the project when it exists', async () => {
    await seedProject(db, 'p-existing', 'Existing Project')

    await processItem({ taskId: TASK_ID, action: 'file', newProjectName: 'Existing Project' })

    expect(await db.query('SELECT id FROM projects')).toHaveLength(1)
    expect(await taskRow(db, TASK_ID)).toMatchObject({ project_id: 'p-existing' })
  })

  it('file without destination or newProjectName returns an error and leaves the task', async () => {
    const result = await processItem({ taskId: TASK_ID, action: 'file' })

    expect(result).toMatchObject({ error: 'destination required for action: file' })
    expect(await taskRow(db, TASK_ID)).toMatchObject({ source: 'inbox' })
  })

  it('returns STALE_ID when the task does not exist', async () => {
    expect(await processItem({ taskId: 'gone', action: 'trash' })).toMatchObject({
      error: 'STALE_ID',
    })
  })
})
