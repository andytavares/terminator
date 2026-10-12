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

const areaRow = (name: string) =>
  db.get<Record<string, unknown>>(`SELECT * FROM areas WHERE name = ?`, [name])
const projectRow = (id: string) =>
  db.get<Record<string, unknown>>(`SELECT * FROM projects WHERE id = ?`, [id])

describe('task-vault:vault:list-areas', () => {
  type AreaSummary = {
    name: string
    status: string
    taskCount: number
    openTaskCount: number
    tasks: { id: string }[]
    projects: {
      name: string
      nextActionCount: number
      isStale: boolean
      totalTaskCount: number
      doneTaskCount: number
    }[]
  }
  const listAreas = (payload?: unknown) =>
    invoke('task-vault:vault:list-areas', payload) as Promise<{ areas: AreaSummary[] }>

  it('returns no areas for an empty database', async () => {
    expect(await listAreas()).toEqual({ areas: [] })
  })

  it('returns active areas by default, ordered by name; archived ones on request', async () => {
    await seedArea(db, 'a2', 'Work')
    await seedArea(db, 'a1', 'Home')
    await seedArea(db, 'a3', 'Old', 'archived')

    expect((await listAreas()).areas.map((area) => area.name)).toEqual(['Home', 'Work'])
    expect((await listAreas({ status: 'archived' })).areas.map((area) => area.name)).toEqual([
      'Old',
    ])
    expect((await listAreas({ status: 'all' })).areas.map((area) => area.name)).toEqual([
      'Home',
      'Old',
      'Work',
    ])
  })

  it('summarises tasks, projects and combined counts per area', async () => {
    await seedArea(db, 'a1', 'Work')
    await seedProject(db, 'p1', 'Work Project', { areaId: 'a1' })
    await seedTask(db, { id: 'area-open', areaId: 'a1' })
    await seedTask(db, { id: 'area-done', areaId: 'a1', status: 'done' })
    await seedTask(db, { id: 'project-open', projectId: 'p1' })
    await seedTask(db, { id: 'project-done', projectId: 'p1', status: 'done' })
    await seedTask(db, { id: 'project-sub', projectId: 'p1', parentId: 'project-open' })
    await seedTask(db, { id: 'elsewhere' })

    const [work] = (await listAreas()).areas

    expect(work.tasks.map((task) => task.id)).toEqual(['area-open'])
    expect(work.openTaskCount).toBe(2)
    expect(work.taskCount).toBe(4)
    expect(work.projects).toMatchObject([
      {
        name: 'Work Project',
        nextActionCount: 2,
        isStale: false,
        totalTaskCount: 2,
        doneTaskCount: 1,
      },
    ])
  })

  it('returns the error when the database fails', async () => {
    await db.exec('DROP TABLE areas')
    expect(await invoke('task-vault:vault:list-areas')).toMatchObject({
      error: expect.stringContaining('no such table'),
    })
  })
})

describe('task-vault:vault:create-area', () => {
  it('creates an active area named in display form', async () => {
    expect(await invoke('task-vault:vault:create-area', { name: 'side-projects' })).toEqual({
      success: true,
      filePath: 'Side Projects',
    })
    expect(await areaRow('Side Projects')).toMatchObject({ status: 'active' })
  })

  it('returns AREA_EXISTS for a name already in use', async () => {
    await seedArea(db, 'a1', 'Work')
    expect(await invoke('task-vault:vault:create-area', { name: 'Work' })).toEqual({
      error: 'AREA_EXISTS',
    })
    expect(await db.query('SELECT id FROM areas')).toHaveLength(1)
  })

  it('returns VALIDATION_ERROR for an empty name', async () => {
    expect(await invoke('task-vault:vault:create-area', { name: '' })).toMatchObject({
      error: expect.stringContaining('VALIDATION_ERROR'),
    })
  })
})

describe('task-vault:vault:rename-area', () => {
  beforeEach(async () => {
    await seedArea(db, 'a1', 'Work')
    await seedArea(db, 'a2', 'Personal')
  })

  it('renames the area', async () => {
    expect(
      await invoke('task-vault:vault:rename-area', {
        areaFilePath: 'Work',
        newName: ' Work 2026 ',
      })
    ).toMatchObject({ success: true })
    expect(await areaRow('Work')).toBeUndefined()
    expect(await areaRow('Work 2026')).toMatchObject({ id: 'a1' })
  })

  it.each([
    [{ newName: 'New Name' }, 'VALIDATION_ERROR'],
    [{ areaFilePath: 'Work' }, 'VALIDATION_ERROR'],
    [{ areaFilePath: 'Ghost', newName: 'Specter' }, 'NOT_FOUND'],
    [{ areaFilePath: 'Work', newName: 'Personal' }, 'AREA_EXISTS'],
  ])('rejects %j with %s and keeps both names', async (payload, error) => {
    expect(await invoke('task-vault:vault:rename-area', payload)).toMatchObject({ error })
    const names = await db.query<{ name: string }>(`SELECT name FROM areas ORDER BY name`)
    expect(names.map((row) => row.name)).toEqual(['Personal', 'Work'])
  })
})

describe('task-vault:vault:archive-area and restore-area', () => {
  beforeEach(async () => {
    await seedArea(db, 'a1', 'Work')
    await seedProject(db, 'p1', 'Work Project', { areaId: 'a1' })
    await seedTask(db, { id: 'project-task', projectId: 'p1' })
    await seedTask(db, { id: 'project-sub', parentId: 'project-task', status: 'blocked' })
    await seedTask(db, { id: 'area-task', areaId: 'a1', status: 'in-progress' })
    await seedTask(db, { id: 'finished', areaId: 'a1', status: 'done' })
    await seedTask(db, { id: 'user-cancelled', areaId: 'a1', status: 'cancelled' })
    await seedTask(db, { id: 'elsewhere' })
  })

  const archive = () => invoke('task-vault:vault:archive-area', { areaName: 'Work' })

  it('archives the area and its projects and cancels their unfinished tasks', async () => {
    expect(await archive()).toMatchObject({ success: true })

    expect(await areaRow('Work')).toMatchObject({ status: 'archived' })
    expect(await projectRow('p1')).toMatchObject({ status: 'archived' })
    for (const id of ['project-task', 'project-sub', 'area-task']) {
      expect(await taskRow(db, id)).toMatchObject({ status: 'cancelled' })
    }
    expect(await taskRow(db, 'finished')).toMatchObject({ status: 'done' })
    expect(await taskRow(db, 'elsewhere')).toMatchObject({ status: 'open' })
  })

  it('creates an "Area archived" notification', async () => {
    await archive()
    expect(harness.createNotification).toHaveBeenCalledWith({
      type: 'info',
      title: 'Area archived',
      message: 'Work',
      key: 'areaArchived',
    })
  })

  it('restore reopens the tasks the archive cancelled but not ones the user cancelled earlier', async () => {
    await db.run(
      `UPDATE tasks SET updated_at = '2026-01-01T00:00:00.000Z' WHERE id = 'user-cancelled'`
    )
    await archive()

    expect(await invoke('task-vault:vault:restore-area', { areaName: 'Work' })).toMatchObject({
      success: true,
    })

    expect(await areaRow('Work')).toMatchObject({ status: 'active' })
    expect(await projectRow('p1')).toMatchObject({ status: 'active' })
    for (const id of ['project-task', 'area-task']) {
      expect(await taskRow(db, id)).toMatchObject({ status: 'open' })
    }
    expect(await taskRow(db, 'user-cancelled')).toMatchObject({ status: 'cancelled' })
  })

  it.each(['archive-area', 'restore-area'])(
    '%s returns NOT_FOUND for an unknown area',
    async (name) => {
      expect(await invoke(`task-vault:vault:${name}`, { areaName: 'Ghost' })).toMatchObject({
        error: 'NOT_FOUND',
      })
    }
  )

  it.each(['archive-area', 'restore-area'])(
    '%s returns VALIDATION_ERROR without areaName',
    async (name) => {
      expect(await invoke(`task-vault:vault:${name}`, {})).toMatchObject({
        error: expect.stringContaining('VALIDATION_ERROR'),
      })
    }
  )
})

describe('task-vault:vault:delete-area', () => {
  beforeEach(async () => {
    await seedArea(db, 'a1', 'Work', 'archived')
    await seedProject(db, 'p1', 'Work Project', { areaId: 'a1', status: 'archived' })
    await seedTask(db, { id: 'project-task', projectId: 'p1' })
    await seedTask(db, { id: 'project-sub', parentId: 'project-task' })
    await seedTask(db, { id: 'area-task', areaId: 'a1' })
    await seedTask(db, { id: 'elsewhere' })
  })

  it('deletes an archived area with its projects and tasks', async () => {
    expect(
      await invoke('task-vault:vault:delete-area', { areaFilePath: 'areas/Work.md' })
    ).toMatchObject({ success: true })

    expect(await areaRow('Work')).toBeUndefined()
    expect(await projectRow('p1')).toBeUndefined()
    expect((await db.query<{ id: string }>('SELECT id FROM tasks')).map((t) => t.id)).toEqual([
      'elsewhere',
    ])
  })

  it('returns MUST_ARCHIVE_FIRST for an active area and keeps everything', async () => {
    await db.run(`UPDATE areas SET status = 'active'`)

    expect(
      await invoke('task-vault:vault:delete-area', { areaFilePath: 'areas/Work.md' })
    ).toMatchObject({ error: 'MUST_ARCHIVE_FIRST' })
    expect(await areaRow('Work')).toBeDefined()
    expect(await db.query('SELECT id FROM tasks')).toHaveLength(4)
  })

  it('returns NOT_FOUND for an unknown area', async () => {
    expect(
      await invoke('task-vault:vault:delete-area', { areaFilePath: 'areas/Ghost.md' })
    ).toMatchObject({ error: 'NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR without areaFilePath', async () => {
    expect(await invoke('task-vault:vault:delete-area', {})).toMatchObject({
      error: expect.stringContaining('VALIDATION_ERROR'),
    })
  })
})

describe('task-vault:vault:update-project-status', () => {
  beforeEach(async () => {
    await seedProject(db, 'proj-1', 'MyProject')
    await seedTask(db, { id: 'open', projectId: 'proj-1' })
    await seedTask(db, { id: 'sub', parentId: 'open', status: 'in-review' })
    await seedTask(db, { id: 'done', projectId: 'proj-1', status: 'done' })
  })

  const update = (payload: unknown) => invoke('task-vault:vault:update-project-status', payload)

  it('updates a project found by name, leaving its tasks alone', async () => {
    expect(await update({ projectFilePath: 'MyProject', status: 'someday' })).toEqual({
      success: true,
    })
    expect(await projectRow('proj-1')).toMatchObject({ status: 'someday' })
    expect(await taskRow(db, 'open')).toMatchObject({ status: 'open' })
    expect(harness.createNotification).not.toHaveBeenCalled()
  })

  it('falls back to the project id', async () => {
    expect(await update({ projectFilePath: 'proj-1', status: 'active' })).toEqual({ success: true })
  })

  it('cancels the unfinished tasks, subtasks included, and notifies when archiving', async () => {
    expect(await update({ projectFilePath: 'MyProject', status: 'archived' })).toEqual({
      success: true,
    })

    expect(await projectRow('proj-1')).toMatchObject({ status: 'archived' })
    expect(await taskRow(db, 'open')).toMatchObject({ status: 'cancelled' })
    expect(await taskRow(db, 'sub')).toMatchObject({ status: 'cancelled' })
    expect(await taskRow(db, 'done')).toMatchObject({ status: 'done' })
    expect(harness.createNotification).toHaveBeenCalledWith({
      type: 'info',
      title: 'Project archived',
      message: 'MyProject',
      key: 'projectArchived',
    })
  })

  it('returns NOT_FOUND when neither the name nor the id matches', async () => {
    expect(await update({ projectFilePath: 'ghost', status: 'archived' })).toEqual({
      error: 'NOT_FOUND',
    })
  })

  it('returns VALIDATION_ERROR without projectFilePath', async () => {
    expect(await update({ status: 'archived' })).toMatchObject({
      error: expect.stringContaining('VALIDATION_ERROR'),
    })
  })
})

describe('task-vault:vault:list-someday and someday-to-today', () => {
  it('lists open top-level someday tasks and someday projects', async () => {
    await seedTask(db, { id: 'parked', source: 'someday' })
    await seedTask(db, { id: 'parked-sub', source: 'someday', parentId: 'parked' })
    await seedTask(db, { id: 'parked-done', source: 'someday', status: 'done' })
    await seedProject(db, 'p1', 'Maybe', { status: 'someday' })
    await seedProject(db, 'p2', 'Live')

    const result = (await invoke('task-vault:vault:list-someday')) as {
      tasks: { id: string }[]
      projects: { name: string }[]
    }

    expect(result.tasks.map((task) => task.id)).toEqual(['parked'])
    expect(result.projects.map((project) => project.name)).toEqual(['Maybe'])
  })

  it('names the area of a someday project', async () => {
    await seedArea(db, 'a1', 'Home')
    await seedProject(db, 'p1', 'Maybe', { status: 'someday', areaId: 'a1' })

    const result = (await invoke('task-vault:vault:list-someday')) as {
      projects: { name: string; area?: string }[]
    }

    expect(result.projects).toMatchObject([{ name: 'Maybe', area: 'Home' }])
  })

  it('moves a someday task and its subtasks to today and opens it', async () => {
    await seedTask(db, { id: 'parked', source: 'someday', status: 'cancelled' })
    await seedTask(db, { id: 'parked-sub', source: 'someday', parentId: 'parked' })

    expect(await invoke('task-vault:vault:someday-to-today', { taskId: 'parked' })).toEqual({
      success: true,
    })
    expect(await taskRow(db, 'parked')).toMatchObject({
      source: 'daily',
      source_ref: localDate(),
      status: 'open',
    })
    expect(await taskRow(db, 'parked-sub')).toMatchObject({
      source: 'daily',
      source_ref: localDate(),
    })
  })

  it('returns VALIDATION_ERROR without taskId', async () => {
    expect(await invoke('task-vault:vault:someday-to-today', {})).toEqual({
      error: 'VALIDATION_ERROR',
    })
  })
})
