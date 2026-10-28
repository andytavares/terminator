import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionDB } from '@terminator/extension-sdk'
import {
  createIpcHarness,
  createVaultDb,
  seedArea,
  seedProject,
  seedTask,
  selectTaskRow,
} from '../support/vault-db'

vi.mock('../../src/notifications/task-scheduler.js', () => ({
  broadcast: vi.fn(),
}))

import { registerProjectsIpcHandlers } from '../../src/ipc/projects.ipc'

let db: ExtensionDB
let harness: ReturnType<typeof createIpcHarness>

beforeEach(async () => {
  db = await createVaultDb()
  harness = createIpcHarness()
  registerProjectsIpcHandlers(harness.api, db)
})

const projectRowNamed = (name: string) =>
  db.get<Record<string, unknown>>(`SELECT * FROM projects WHERE name = ?`, [name])

describe('registerProjectsIpcHandlers', () => {
  it('dispose removes every registered channel', () => {
    const own = createIpcHarness()
    const dispose = registerProjectsIpcHandlers(own.api, db)
    expect(own.channels()).toContain('task-vault:projects:list')
    dispose()
    expect(own.channels()).toEqual([])
  })
})

const projectNamesIn = (result: unknown) =>
  (result as { projects: { name: string }[] }).projects.map((project) => project.name)

describe('task-vault:projects:list', taskVaultProjectsListTests)

describe('task-vault:projects:update-status', taskVaultProjectsUpdateStatusTests)
describe('task-vault:projects:create', taskVaultProjectsCreateTests)
describe('task-vault:projects:delete', taskVaultProjectsDeleteTests)

describe('task-vault:projects:update-area', () => {
  it('moves the project to the area, creating the area when new', async () => {
    await seedProject(db, 'p1', 'Alpha')

    expect(
      await harness.invoke('task-vault:projects:update-area', {
        projectFilePath: 'Alpha',
        area: 'Home',
      })
    ).toEqual({ success: true })

    const area = await db.get<{ id: string }>(`SELECT id FROM areas WHERE name = 'Home'`)
    expect(await projectRowNamed('Alpha')).toMatchObject({ area_id: area?.id })
  })

  it('removes the project from its area when no area is given', async () => {
    await seedArea(db, 'a1', 'Home')
    await seedProject(db, 'p1', { name: 'Alpha', areaId: 'a1' })

    await harness.invoke('task-vault:projects:update-area', {
      projectFilePath: 'Alpha',
      area: null,
    })

    expect(await projectRowNamed('Alpha')).toMatchObject({ area_id: null })
  })
})

describe('task-vault:projects:update-deadline', () => {
  it('sets the deadline and clears it again with null', async () => {
    await seedProject(db, 'p1', 'Alpha')

    await harness.invoke('task-vault:projects:update-deadline', {
      projectFilePath: 'Alpha',
      deadline: '2026-05-01',
    })
    expect(await projectRowNamed('Alpha')).toMatchObject({ deadline: '2026-05-01' })

    await harness.invoke('task-vault:projects:update-deadline', {
      projectFilePath: 'Alpha',
      deadline: null,
    })
    expect(await projectRowNamed('Alpha')).toMatchObject({ deadline: null })
  })
})

describe('task-vault:projects:rename', () => {
  it('renames the project', async () => {
    await seedProject(db, 'p1', 'Old Name')

    expect(
      await harness.invoke('task-vault:projects:rename', {
        projectFilePath: 'Old Name',
        newName: '  New Name ',
      })
    ).toEqual({ success: true })

    expect(await projectRowNamed('Old Name')).toBeUndefined()
    expect(await projectRowNamed('New Name')).toMatchObject({ id: 'p1' })
  })

  it.each([
    [{ projectFilePath: 'Missing', newName: 'X' }, 'NOT_FOUND'],
    [{ projectFilePath: 'Old Name', newName: 'Taken' }, 'PROJECT_EXISTS'],
  ])('rejects %j with %s and leaves the names alone', async (payload, error) => {
    await seedProject(db, 'p1', 'Old Name')
    await seedProject(db, 'p2', 'Taken')

    expect(await harness.invoke('task-vault:projects:rename', payload)).toEqual({ error })

    const names = await db.query<{ name: string }>(`SELECT name FROM projects ORDER BY name`)
    expect(names.map((row) => row.name)).toEqual(['Old Name', 'Taken'])
  })
})

function taskVaultProjectsListTests() {
  beforeEach(async () => {
    await seedProject(db, 'p-active', 'Alpha')
    await seedProject(db, 'p-someday', { name: 'Beta', status: 'someday' })
    await seedProject(db, 'p-archived', { name: 'Gamma', status: 'archived' })
  })

  describe('statuses', taskVaultProjectsListStatusesTests)
  describe('counts and areas', taskVaultProjectsListCountsAreasTests)
}

function taskVaultProjectsListStatusesTests() {
  it('returns only active projects by default', async () => {
    expect(projectNamesIn(await harness.invoke('task-vault:projects:list', {}))).toEqual(['Alpha'])
  })

  it('returns nothing when no project has the status', async () => {
    await db.run(`DELETE FROM projects`)
    expect(projectNamesIn(await harness.invoke('task-vault:projects:list', {}))).toEqual([])
  })

  it('filters by one status', async () => {
    const result = await harness.invoke('task-vault:projects:list', { status: 'someday' })
    expect(projectNamesIn(result)).toEqual(['Beta'])
  })

  it('accepts an array of statuses and orders by name', async () => {
    const result = await harness.invoke('task-vault:projects:list', {
      status: ['someday', 'active'],
    })
    expect(projectNamesIn(result)).toEqual(['Alpha', 'Beta'])
  })
}

function taskVaultProjectsListCountsAreasTests() {
  it('counts open tasks as next actions and marks a project with none as stale', async () => {
    await seedTask(db, { id: 't1', projectId: 'p-active' })
    await seedTask(db, { id: 't2', projectId: 'p-active' })
    await seedTask(db, { id: 't3', projectId: 'p-active', status: 'done' })

    const result = (await harness.invoke('task-vault:projects:list', {
      status: ['active', 'someday'],
    })) as {
      projects: { name: string; nextActionCount: number; isStale: boolean }[]
    }

    expect(result.projects).toMatchObject([
      { name: 'Alpha', nextActionCount: 2, isStale: false },
      { name: 'Beta', nextActionCount: 0, isStale: true },
    ])
  })

  it('names the area of each project', async () => {
    await seedArea(db, 'a1', 'Work')
    await db.run(`UPDATE projects SET area_id = 'a1' WHERE id = 'p-active'`)

    const result = (await harness.invoke('task-vault:projects:list', {})) as {
      projects: { area?: string }[]
    }

    expect(result.projects[0].area).toBe('Work')
  })
}

function taskVaultProjectsUpdateStatusTests() {
  describe('updating', taskVaultProjectsUpdateStatusUpdatingTests)
  describe('archiving', taskVaultProjectsUpdateStatusArchivingTests)
}

function taskVaultProjectsUpdateStatusUpdatingTests() {
  it('updates a project found by name', async () => {
    await seedProject(db, 'p1', 'Alpha')

    expect(
      await harness.invoke('task-vault:projects:update-status', {
        projectFilePath: 'Alpha',
        status: 'someday',
      })
    ).toEqual({ success: true })
    expect(await projectRowNamed('Alpha')).toMatchObject({ status: 'someday' })
  })

  it('finds the project by id when no project has that name', async () => {
    await seedProject(db, 'p1', 'Alpha')

    await harness.invoke('task-vault:projects:update-status', {
      projectFilePath: 'p1',
      status: 'done',
    })

    expect(await projectRowNamed('Alpha')).toMatchObject({ status: 'done' })
  })
}

function taskVaultProjectsUpdateStatusArchivingTests() {
  it('cancels open tasks, subtasks included, when archiving and leaves finished ones', async () => {
    await seedProject(db, 'p1', 'Alpha')
    await seedProject(db, 'p2', 'Other')
    await seedTask(db, { id: 'open', projectId: 'p1' })
    await seedTask(db, { id: 'blocked-child', parentId: 'open', status: 'blocked' })
    await seedTask(db, { id: 'done', projectId: 'p1', status: 'done' })
    await seedTask(db, { id: 'elsewhere', projectId: 'p2' })

    await harness.invoke('task-vault:projects:update-status', {
      projectFilePath: 'Alpha',
      status: 'archived',
    })

    expect(await selectTaskRow(db, 'open')).toMatchObject({ status: 'cancelled' })
    expect(await selectTaskRow(db, 'blocked-child')).toMatchObject({ status: 'cancelled' })
    expect(await selectTaskRow(db, 'done')).toMatchObject({ status: 'done' })
    expect(await selectTaskRow(db, 'elsewhere')).toMatchObject({ status: 'open' })
  })

  it('returns NOT_FOUND for an unknown project', async () => {
    expect(
      await harness.invoke('task-vault:projects:update-status', {
        projectFilePath: 'nope',
        status: 'done',
      })
    ).toEqual({ error: 'NOT_FOUND' })
  })
}

function taskVaultProjectsCreateTests() {
  describe('creating', taskVaultProjectsCreateCreatingTests)
  describe('areas', taskVaultProjectsCreateAreasTests)
}

function taskVaultProjectsCreateCreatingTests() {
  it('creates an active project named in display form', async () => {
    const result = await harness.invoke('task-vault:projects:create', {
      name: 'new-project',
      deadline: '2026-06-01',
      outcome: 'Shipped',
    })

    expect(result).toEqual({ success: true, filePath: 'New Project' })
    expect(await projectRowNamed('New Project')).toMatchObject({
      status: 'active',
      deadline: '2026-06-01',
      outcome: 'Shipped',
    })
  })

  it('returns PROJECT_EXISTS for a name already in use', async () => {
    await seedProject(db, 'p1', 'Existing')

    expect(await harness.invoke('task-vault:projects:create', { name: 'Existing' })).toEqual({
      error: 'PROJECT_EXISTS',
    })
    expect(await db.query('SELECT id FROM projects')).toHaveLength(1)
  })
}

function taskVaultProjectsCreateAreasTests() {
  it('creates the area when it is new and reuses it when it exists', async () => {
    await harness.invoke('task-vault:projects:create', { name: 'First', area: 'work' })
    await harness.invoke('task-vault:projects:create', { name: 'Second', area: 'work' })

    const areas = await db.query<{ id: string; name: string }>(`SELECT id, name FROM areas`)
    expect(areas.map((area) => area.name)).toEqual(['Work'])
    expect(await db.query('SELECT id FROM projects WHERE area_id = ?', [areas[0].id])).toHaveLength(
      2
    )
  })
}

function taskVaultProjectsDeleteTests() {
  describe('deleting', taskVaultProjectsDeleteDeletingTests)
  describe('refusing', taskVaultProjectsDeleteRefusingTests)
}

function taskVaultProjectsDeleteDeletingTests() {
  it('deletes an archived project with its tasks and subtasks', async () => {
    await seedProject(db, 'p1', { name: 'Old', status: 'archived' })
    await seedTask(db, { id: 'parent', projectId: 'p1' })
    await seedTask(db, { id: 'child', parentId: 'parent' })
    await seedTask(db, { id: 'unrelated' })

    expect(await harness.invoke('task-vault:projects:delete', { projectFilePath: 'Old' })).toEqual({
      success: true,
    })

    expect(await projectRowNamed('Old')).toBeUndefined()
    expect((await db.query<{ id: string }>('SELECT id FROM tasks')).map((t) => t.id)).toEqual([
      'unrelated',
    ])
  })
}

function taskVaultProjectsDeleteRefusingTests() {
  it('returns MUST_ARCHIVE_FIRST for a project that is not archived and keeps it', async () => {
    await seedProject(db, 'p1', 'Live')

    expect(await harness.invoke('task-vault:projects:delete', { projectFilePath: 'Live' })).toEqual(
      {
        error: 'MUST_ARCHIVE_FIRST',
      }
    )
    expect(await projectRowNamed('Live')).toBeDefined()
  })

  it('returns NOT_FOUND for an unknown project', async () => {
    expect(await harness.invoke('task-vault:projects:delete', { projectFilePath: 'nope' })).toEqual(
      {
        error: 'NOT_FOUND',
      }
    )
  })
}
