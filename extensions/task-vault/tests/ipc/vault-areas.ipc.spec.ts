import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { localDate } from '../../src/utils/local-date'
import {
  createIpcHarness,
  createVaultDb,
  seedArea,
  seedProject,
  seedTask,
  selectTaskRow,
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

const areaRow = (name: string) =>
  db.get<Record<string, unknown>>(`SELECT * FROM areas WHERE name = ?`, [name])
const projectRowById = (id: string) =>
  db.get<Record<string, unknown>>(`SELECT * FROM projects WHERE id = ?`, [id])

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

const listAreasVia = (payload?: unknown) =>
  harness.invoke('task-vault:vault:list-areas', payload) as Promise<{ areas: AreaSummary[] }>

describe('task-vault:vault:list-areas', taskVaultVaultListAreasTests)

describe('task-vault:vault:create-area', () => {
  it('creates an active area named in display form', async () => {
    expect(await harness.invoke('task-vault:vault:create-area', { name: 'side-projects' })).toEqual(
      {
        success: true,
        filePath: 'Side Projects',
      }
    )
    expect(await areaRow('Side Projects')).toMatchObject({ status: 'active' })
  })

  it('returns AREA_EXISTS for a name already in use', async () => {
    await seedArea(db, 'a1', 'Work')
    expect(await harness.invoke('task-vault:vault:create-area', { name: 'Work' })).toEqual({
      error: 'AREA_EXISTS',
    })
    expect(await db.query('SELECT id FROM areas')).toHaveLength(1)
  })
})

describe('task-vault:vault:rename-area', () => {
  beforeEach(async () => {
    await seedArea(db, 'a1', 'Work')
    await seedArea(db, 'a2', 'Personal')
  })

  it('renames the area', async () => {
    expect(
      await harness.invoke('task-vault:vault:rename-area', {
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
    expect(await harness.invoke('task-vault:vault:rename-area', payload)).toMatchObject({ error })
    const names = await db.query<{ name: string }>(`SELECT name FROM areas ORDER BY name`)
    expect(names.map((row) => row.name)).toEqual(['Personal', 'Work'])
  })
})

const archiveWorkArea = () => harness.invoke('task-vault:vault:archive-area', { areaName: 'Work' })

describe('task-vault:vault:archive-area and restore-area', taskVaultVaultArchiveAreaTests)
describe('task-vault:vault:delete-area', taskVaultVaultDeleteAreaTests)

const updateProjectStatusVia = (payload: unknown) =>
  harness.invoke('task-vault:vault:update-project-status', payload)

describe('task-vault:vault:update-project-status', taskVaultVaultUpdateProjectTests)
describe('task-vault:vault:list-someday and someday-to-today', taskVaultVaultListSomedayTests)

function taskVaultVaultListAreasTests() {
  describe('listing', taskVaultVaultListAreasListingTests)
  describe('summaries', taskVaultVaultListAreasSummariesTests)
  describe('project areas and errors', taskVaultVaultListAreasProjectAreasErrorsTests)
}

function taskVaultVaultListAreasListingTests() {
  it('returns no areas for an empty database', async () => {
    expect(await listAreasVia()).toEqual({ areas: [] })
  })

  it('returns active areas by default, ordered by name; archived ones on request', async () => {
    await seedArea(db, 'a2', 'Work')
    await seedArea(db, 'a1', 'Home')
    await seedArea(db, 'a3', { name: 'Old', status: 'archived' })

    expect((await listAreasVia()).areas.map((area) => area.name)).toEqual(['Home', 'Work'])
    expect((await listAreasVia({ status: 'archived' })).areas.map((area) => area.name)).toEqual([
      'Old',
    ])
    expect((await listAreasVia({ status: 'all' })).areas.map((area) => area.name)).toEqual([
      'Home',
      'Old',
      'Work',
    ])
  })
}

function taskVaultVaultListAreasSummariesTests() {
  it('summarises tasks, projects and combined counts per area', async () => {
    await seedArea(db, 'a1', 'Work')
    await seedProject(db, 'p1', { name: 'Work Project', areaId: 'a1' })
    await seedTask(db, { id: 'area-open', areaId: 'a1' })
    await seedTask(db, { id: 'area-done', areaId: 'a1', status: 'done' })
    await seedTask(db, { id: 'project-open', projectId: 'p1' })
    await seedTask(db, { id: 'project-done', projectId: 'p1', status: 'done' })
    await seedTask(db, { id: 'project-sub', projectId: 'p1', parentId: 'project-open' })
    await seedTask(db, { id: 'elsewhere' })

    const [work] = (await listAreasVia()).areas

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
}

function taskVaultVaultListAreasProjectAreasErrorsTests() {
  it('names the area on each listed project', async () => {
    await seedArea(db, 'a1', 'Work')
    await seedProject(db, 'p1', { name: 'Work Project', areaId: 'a1' })

    const [work] = (await listAreasVia()).areas

    expect(work.projects).toMatchObject([{ name: 'Work Project', area: 'Work' }])
  })

  it('returns the error when the database fails', async () => {
    await db.exec('DROP TABLE areas')
    expect(await harness.invoke('task-vault:vault:list-areas')).toMatchObject({
      error: expect.stringContaining('no such table'),
    })
  })
}

function taskVaultVaultArchiveAreaTests() {
  beforeEach(async () => {
    await seedArea(db, 'a1', 'Work')
    await seedProject(db, 'p1', { name: 'Work Project', areaId: 'a1' })
    await seedTask(db, { id: 'project-task', projectId: 'p1' })
    await seedTask(db, { id: 'project-sub', parentId: 'project-task', status: 'blocked' })
    await seedTask(db, { id: 'area-task', areaId: 'a1', status: 'in-progress' })
    await seedTask(db, { id: 'finished', areaId: 'a1', status: 'done' })
    await seedTask(db, { id: 'user-cancelled', areaId: 'a1', status: 'cancelled' })
    await seedTask(db, { id: 'elsewhere' })
  })

  describe('archiving', taskVaultVaultArchiveAreaArchivingTests)
  describe('restoring tasks', taskVaultVaultArchiveAreaRestoringTasksTests)
  describe('restoring subtasks', taskVaultVaultArchiveAreaRestoringSubtasksTests)
  describe('restoring after changes', taskVaultVaultArchiveAreaRestoringAfterChangesTests)
  describe('legacy archives', taskVaultVaultArchiveAreaLegacyArchivesTests)
  describe('missing areas', taskVaultVaultArchiveAreaMissingAreasTests)
}

function taskVaultVaultArchiveAreaArchivingTests() {
  it('archives the area and its projects and cancels their unfinished tasks', async () => {
    expect(await archiveWorkArea()).toMatchObject({ success: true })

    expect(await areaRow('Work')).toMatchObject({ status: 'archived' })
    expect(await projectRowById('p1')).toMatchObject({ status: 'archived' })
    for (const id of ['project-task', 'project-sub', 'area-task']) {
      expect(await selectTaskRow(db, id)).toMatchObject({ status: 'cancelled' })
    }
    expect(await selectTaskRow(db, 'finished')).toMatchObject({ status: 'done' })
    expect(await selectTaskRow(db, 'elsewhere')).toMatchObject({ status: 'open' })
  })

  it('creates an "Area archived" notification', async () => {
    await archiveWorkArea()
    expect(harness.createNotification).toHaveBeenCalledWith({
      type: 'info',
      title: 'Area archived',
      message: 'Work',
      key: 'areaArchived',
    })
  })
}

function taskVaultVaultArchiveAreaRestoringTasksTests() {
  it('restore reopens the tasks the archive cancelled but not ones the user cancelled earlier', async () => {
    await db.run(
      `UPDATE tasks SET updated_at = '2026-01-01T00:00:00.000Z' WHERE id = 'user-cancelled'`
    )
    await archiveWorkArea()

    expect(
      await harness.invoke('task-vault:vault:restore-area', { areaName: 'Work' })
    ).toMatchObject({
      success: true,
    })

    expect(await areaRow('Work')).toMatchObject({ status: 'active' })
    expect(await projectRowById('p1')).toMatchObject({ status: 'active' })
    expect(await selectTaskRow(db, 'project-task')).toMatchObject({ status: 'open' })
    expect(await selectTaskRow(db, 'area-task')).toMatchObject({ status: 'in-progress' })
    expect(await selectTaskRow(db, 'user-cancelled')).toMatchObject({ status: 'cancelled' })
  })
}

function taskVaultVaultArchiveAreaRestoringSubtasksTests() {
  it('restore reopens subtasks the archive cancelled and leaves user-cancelled subtasks cancelled', async () => {
    await seedTask(db, { id: 'area-sub', parentId: 'area-task' })
    await seedTask(db, { id: 'area-sub-cancelled', parentId: 'area-task', status: 'cancelled' })
    await seedTask(db, {
      id: 'project-sub-cancelled',
      parentId: 'project-task',
      status: 'cancelled',
    })
    await archiveWorkArea()

    await harness.invoke('task-vault:vault:restore-area', { areaName: 'Work' })

    expect(await selectTaskRow(db, 'project-sub')).toMatchObject({ status: 'blocked' })
    expect(await selectTaskRow(db, 'area-sub')).toMatchObject({ status: 'open' })
    expect(await selectTaskRow(db, 'area-sub-cancelled')).toMatchObject({ status: 'cancelled' })
    expect(await selectTaskRow(db, 'project-sub-cancelled')).toMatchObject({ status: 'cancelled' })
  })
}

function taskVaultVaultArchiveAreaRestoringAfterChangesTests() {
  it('restore still reopens what archive cancelled after the area was renamed', async () => {
    await archiveWorkArea()
    await harness.invoke('task-vault:vault:rename-area', { areaFilePath: 'Work', newName: 'Job' })

    await harness.invoke('task-vault:vault:restore-area', { areaName: 'Job' })

    expect(await selectTaskRow(db, 'area-task')).toMatchObject({ status: 'in-progress' })
    expect(await selectTaskRow(db, 'project-sub')).toMatchObject({ status: 'blocked' })
  })

  it('restore keeps a project that was not active before the archive as it was', async () => {
    await seedProject(db, 'parked', { name: 'Parked', areaId: 'a1', status: 'someday' })
    await seedProject(db, 'finished', { name: 'Finished', areaId: 'a1', status: 'archived' })
    await archiveWorkArea()

    await harness.invoke('task-vault:vault:restore-area', { areaName: 'Work' })

    expect(await projectRowById('p1')).toMatchObject({ status: 'active' })
    expect(await projectRowById('parked')).toMatchObject({ status: 'someday' })
    expect(await projectRowById('finished')).toMatchObject({ status: 'archived' })
  })
}

function taskVaultVaultArchiveAreaLegacyArchivesTests() {
  it('restores an area archived before changes were recorded by matching the archive time', async () => {
    const archivedAt = '2026-02-01T10:00:00.000Z'
    await db.run(`UPDATE areas SET status='archived', updated_at=? WHERE id='a1'`, [archivedAt])
    await db.run(`UPDATE projects SET status='archived', updated_at=? WHERE id='p1'`, [archivedAt])
    for (const id of ['project-task', 'project-sub', 'area-task']) {
      await db.run(`UPDATE tasks SET status='cancelled', updated_at=? WHERE id=?`, [archivedAt, id])
    }

    await harness.invoke('task-vault:vault:restore-area', { areaName: 'Work' })

    expect(await projectRowById('p1')).toMatchObject({ status: 'active' })
    for (const id of ['project-task', 'area-task']) {
      expect(await selectTaskRow(db, id)).toMatchObject({ status: 'open' })
    }
    expect(await selectTaskRow(db, 'user-cancelled')).toMatchObject({ status: 'cancelled' })
  })
}

function taskVaultVaultArchiveAreaMissingAreasTests() {
  it.each(['archive-area', 'restore-area'])(
    '%s returns NOT_FOUND for an unknown area',
    async (name) => {
      expect(await harness.invoke(`task-vault:vault:${name}`, { areaName: 'Ghost' })).toMatchObject(
        {
          error: 'NOT_FOUND',
        }
      )
    }
  )
}

function taskVaultVaultDeleteAreaTests() {
  beforeEach(async () => {
    await seedArea(db, 'a1', { name: 'Work', status: 'archived' })
    await seedProject(db, 'p1', { name: 'Work Project', areaId: 'a1', status: 'archived' })
    await seedTask(db, { id: 'project-task', projectId: 'p1' })
    await seedTask(db, { id: 'project-sub', parentId: 'project-task' })
    await seedTask(db, { id: 'area-task', areaId: 'a1' })
    await seedTask(db, { id: 'elsewhere' })
  })

  describe('deleting', taskVaultVaultDeleteAreaDeletingTests)
  describe('refusing', taskVaultVaultDeleteAreaRefusingTests)
}

function taskVaultVaultDeleteAreaDeletingTests() {
  it('deletes an archived area with its projects and tasks', async () => {
    expect(
      await harness.invoke('task-vault:vault:delete-area', { areaFilePath: 'areas/Work.md' })
    ).toMatchObject({ success: true })

    expect(await areaRow('Work')).toBeUndefined()
    expect(await projectRowById('p1')).toBeUndefined()
    expect((await db.query<{ id: string }>('SELECT id FROM tasks')).map((t) => t.id)).toEqual([
      'elsewhere',
    ])
  })
}

function taskVaultVaultDeleteAreaRefusingTests() {
  it('returns MUST_ARCHIVE_FIRST for an active area and keeps everything', async () => {
    await db.run(`UPDATE areas SET status = 'active'`)

    expect(
      await harness.invoke('task-vault:vault:delete-area', { areaFilePath: 'areas/Work.md' })
    ).toMatchObject({ error: 'MUST_ARCHIVE_FIRST' })
    expect(await areaRow('Work')).toBeDefined()
    expect(await db.query('SELECT id FROM tasks')).toHaveLength(4)
  })

  it('returns NOT_FOUND for an unknown area', async () => {
    expect(
      await harness.invoke('task-vault:vault:delete-area', { areaFilePath: 'areas/Ghost.md' })
    ).toMatchObject({ error: 'NOT_FOUND' })
  })
}

function taskVaultVaultUpdateProjectTests() {
  beforeEach(async () => {
    await seedProject(db, 'proj-1', 'MyProject')
    await seedTask(db, { id: 'open', projectId: 'proj-1' })
    await seedTask(db, { id: 'sub', parentId: 'open', status: 'in-review' })
    await seedTask(db, { id: 'done', projectId: 'proj-1', status: 'done' })
  })

  describe('updating', taskVaultVaultUpdateProjectUpdatingTests)
  describe('archiving', taskVaultVaultUpdateProjectArchivingTests)
}

function taskVaultVaultUpdateProjectUpdatingTests() {
  it('updates a project found by name, leaving its tasks alone', async () => {
    expect(
      await updateProjectStatusVia({ projectFilePath: 'MyProject', status: 'someday' })
    ).toEqual({
      success: true,
    })
    expect(await projectRowById('proj-1')).toMatchObject({ status: 'someday' })
    expect(await selectTaskRow(db, 'open')).toMatchObject({ status: 'open' })
    expect(harness.createNotification).not.toHaveBeenCalled()
  })

  it('falls back to the project id', async () => {
    expect(await updateProjectStatusVia({ projectFilePath: 'proj-1', status: 'active' })).toEqual({
      success: true,
    })
  })
}

function taskVaultVaultUpdateProjectArchivingTests() {
  it('cancels the unfinished tasks, subtasks included, and notifies when archiving', async () => {
    expect(
      await updateProjectStatusVia({ projectFilePath: 'MyProject', status: 'archived' })
    ).toEqual({
      success: true,
    })

    expect(await projectRowById('proj-1')).toMatchObject({ status: 'archived' })
    expect(await selectTaskRow(db, 'open')).toMatchObject({ status: 'cancelled' })
    expect(await selectTaskRow(db, 'sub')).toMatchObject({ status: 'cancelled' })
    expect(await selectTaskRow(db, 'done')).toMatchObject({ status: 'done' })
    expect(harness.createNotification).toHaveBeenCalledWith({
      type: 'info',
      title: 'Project archived',
      message: 'MyProject',
      key: 'projectArchived',
    })
  })

  it('returns NOT_FOUND when neither the name nor the id matches', async () => {
    expect(await updateProjectStatusVia({ projectFilePath: 'ghost', status: 'archived' })).toEqual({
      error: 'NOT_FOUND',
    })
  })
}

function taskVaultVaultListSomedayTests() {
  describe('listing', taskVaultVaultListSomedayListingTests)
  describe('moving to today', taskVaultVaultListSomedayMovingTodayTests)
}

function taskVaultVaultListSomedayListingTests() {
  it('lists open top-level someday tasks and someday projects', async () => {
    await seedTask(db, { id: 'parked', source: 'someday' })
    await seedTask(db, { id: 'parked-sub', source: 'someday', parentId: 'parked' })
    await seedTask(db, { id: 'parked-done', source: 'someday', status: 'done' })
    await seedProject(db, 'p1', { name: 'Maybe', status: 'someday' })
    await seedProject(db, 'p2', 'Live')

    const result = (await harness.invoke('task-vault:vault:list-someday')) as {
      tasks: { id: string }[]
      projects: { name: string }[]
    }

    expect(result.tasks.map((task) => task.id)).toEqual(['parked'])
    expect(result.projects.map((project) => project.name)).toEqual(['Maybe'])
  })

  it('names the area of a someday project', async () => {
    await seedArea(db, 'a1', 'Home')
    await seedProject(db, 'p1', { name: 'Maybe', status: 'someday', areaId: 'a1' })

    const result = (await harness.invoke('task-vault:vault:list-someday')) as {
      projects: { name: string; area?: string }[]
    }

    expect(result.projects).toMatchObject([{ name: 'Maybe', area: 'Home' }])
  })
}

function taskVaultVaultListSomedayMovingTodayTests() {
  it('moves a someday task and its subtasks to today and opens it', async () => {
    await seedTask(db, { id: 'parked', source: 'someday', status: 'cancelled' })
    await seedTask(db, { id: 'parked-sub', source: 'someday', parentId: 'parked' })

    expect(await harness.invoke('task-vault:vault:someday-to-today', { taskId: 'parked' })).toEqual(
      {
        success: true,
      }
    )
    expect(await selectTaskRow(db, 'parked')).toMatchObject({
      source: 'daily',
      source_ref: localDate(),
      status: 'open',
    })
    expect(await selectTaskRow(db, 'parked-sub')).toMatchObject({
      source: 'daily',
      source_ref: localDate(),
    })
  })
}
