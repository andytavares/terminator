import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb } from '../../../../src/main/db/index'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { registerLinksIpcHandlers } from '../../src/ipc/links.ipc.js'
import {
  createIpcHarness,
  createVaultDb,
  seedArea,
  seedProject,
  seedTask,
  taskRow,
} from '../support/vault-db'

const TARGET = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

let db: ExtensionDB
let harness: ReturnType<typeof createIpcHarness>

beforeEach(async () => {
  db = await createVaultDb()
  harness = createIpcHarness()
  registerLinksIpcHandlers(harness.api, db)
})

const invoke = (channel: string, payload?: unknown) => harness.invoke(channel, payload)

async function linksOf(table: 'tasks' | 'projects', key: string): Promise<string[]> {
  const column = table === 'tasks' ? 'id' : 'name'
  const row = await db.get<{ terminator_links: string }>(
    `SELECT terminator_links FROM ${table} WHERE ${column} = ?`,
    [key]
  )
  return JSON.parse(row?.terminator_links ?? '[]') as string[]
}

describe('task-vault:links:create', () => {
  it('replaces all existing links of a task with the new one', async () => {
    await seedTask(db, { id: 't1', terminatorLinks: JSON.stringify([OTHER]) })

    expect(await invoke('task-vault:links:create', { taskId: 't1', targetId: TARGET })).toEqual({
      success: true,
    })
    expect(await linksOf('tasks', 't1')).toEqual([TARGET])
  })

  it('appends a link to a project once, however often it is created', async () => {
    await seedProject(db, 'p1', 'alpha')

    await invoke('task-vault:links:create', { projectFilePath: 'alpha', targetId: OTHER })
    await invoke('task-vault:links:create', { projectFilePath: 'alpha', targetId: TARGET })
    await invoke('task-vault:links:create', { projectFilePath: 'alpha', targetId: TARGET })

    expect(await linksOf('projects', 'alpha')).toEqual([OTHER, TARGET])
  })

  it('returns NOT_FOUND for an unknown task or project', async () => {
    expect(await invoke('task-vault:links:create', { taskId: 'x', targetId: TARGET })).toEqual({
      error: 'NOT_FOUND',
    })
    expect(
      await invoke('task-vault:links:create', { projectFilePath: 'nope', targetId: TARGET })
    ).toEqual({ error: 'NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR when targetId is not a UUID', async () => {
    await seedTask(db, { id: 't1' })

    expect(await invoke('task-vault:links:create', { taskId: 't1' })).toEqual({
      error: 'VALIDATION_ERROR',
    })
    expect(await invoke('task-vault:links:create', { taskId: 't1', targetId: 'nope' })).toEqual({
      error: 'VALIDATION_ERROR',
    })
    expect(await linksOf('tasks', 't1')).toEqual([])
  })
})

describe('task-vault:links:remove', () => {
  it('removes only the given link from a task', async () => {
    await seedTask(db, { id: 't1', terminatorLinks: JSON.stringify([TARGET, OTHER]) })

    expect(await invoke('task-vault:links:remove', { taskId: 't1', targetId: TARGET })).toEqual({
      success: true,
    })
    expect(await linksOf('tasks', 't1')).toEqual([OTHER])
  })

  it('removes the given link from a project', async () => {
    await seedProject(db, 'p1', 'alpha')
    await db.run(`UPDATE projects SET terminator_links = ? WHERE id = 'p1'`, [
      JSON.stringify([TARGET, OTHER]),
    ])

    await invoke('task-vault:links:remove', { projectFilePath: 'alpha', targetId: OTHER })

    expect(await linksOf('projects', 'alpha')).toEqual([TARGET])
  })

  it('returns NOT_FOUND for an unknown task or project', async () => {
    expect(await invoke('task-vault:links:remove', { taskId: 'x', targetId: TARGET })).toEqual({
      error: 'NOT_FOUND',
    })
    expect(
      await invoke('task-vault:links:remove', { projectFilePath: 'nope', targetId: TARGET })
    ).toEqual({ error: 'NOT_FOUND' })
  })

  it('returns VALIDATION_ERROR when targetId is missing', async () => {
    expect(await invoke('task-vault:links:remove', { taskId: 't1' })).toEqual({
      error: 'VALIDATION_ERROR',
    })
  })
})

describe('task-vault:links:get-for-terminator-target', () => {
  it('returns the tasks and projects linked to the target and no others', async () => {
    await seedTask(db, { id: 'linked', terminatorLinks: JSON.stringify([TARGET]) })
    await seedTask(db, { id: 'other', terminatorLinks: JSON.stringify([OTHER]) })
    await seedTask(db, { id: 'none' })
    await seedProject(db, 'p1', 'alpha')
    await seedProject(db, 'p2', 'beta')
    await db.run(`UPDATE projects SET terminator_links = ? WHERE id = 'p1'`, [
      JSON.stringify([TARGET]),
    ])

    const result = (await invoke('task-vault:links:get-for-terminator-target', {
      targetId: TARGET,
    })) as { tasks: { id: string }[]; projects: { name: string }[] }

    expect(result.tasks.map((task) => task.id)).toEqual(['linked'])
    expect(result.projects.map((project) => project.name)).toEqual(['alpha'])
  })

  it('names the area of a linked project', async () => {
    await seedArea(db, 'a1', 'Work')
    await seedProject(db, 'p1', 'alpha', { areaId: 'a1' })
    await db.run(`UPDATE projects SET terminator_links = ? WHERE id = 'p1'`, [
      JSON.stringify([TARGET]),
    ])

    const result = (await invoke('task-vault:links:get-for-terminator-target', {
      targetId: TARGET,
    })) as { projects: { name: string; area?: string }[] }

    expect(result.projects).toMatchObject([{ name: 'alpha', area: 'Work' }])
  })

  it('returns empty lists when nothing links to the target', async () => {
    await seedTask(db, { id: 'other', terminatorLinks: JSON.stringify([OTHER]) })

    expect(
      await invoke('task-vault:links:get-for-terminator-target', { targetId: TARGET })
    ).toEqual({ tasks: [], projects: [] })
  })

  it('returns VALIDATION_ERROR for a missing targetId', async () => {
    expect(await invoke('task-vault:links:get-for-terminator-target', {})).toEqual({
      error: 'VALIDATION_ERROR',
    })
  })
})

describe('database errors', () => {
  let closed: ExtensionDB
  let closedHarness: ReturnType<typeof createIpcHarness>

  beforeEach(() => {
    const database = new DatabaseSync(':memory:')
    closed = wrapDb(database)
    database.close()
    closedHarness = createIpcHarness()
    registerLinksIpcHandlers(closedHarness.api, closed)
  })

  it.each(['task-vault:links:create', 'task-vault:links:remove'])(
    '%s returns the error instead of throwing',
    async (channel) => {
      const result = await closedHarness.invoke(channel, { taskId: 't1', targetId: TARGET })
      expect(result).toMatchObject({ error: expect.stringMatching(/not open/) })
    }
  )

  it('get-for-terminator-target returns the error instead of throwing', async () => {
    const result = await closedHarness.invoke('task-vault:links:get-for-terminator-target', {
      targetId: TARGET,
    })
    expect(result).toMatchObject({ error: expect.stringMatching(/not open/) })
  })
})

describe('registerLinksIpcHandlers', () => {
  it('dispose removes every registered channel', () => {
    const own = createIpcHarness()
    const dispose = registerLinksIpcHandlers(own.api, db)
    expect(own.channels().sort()).toEqual([
      'task-vault:links:create',
      'task-vault:links:get-for-terminator-target',
      'task-vault:links:remove',
    ])
    dispose()
    expect(own.channels()).toEqual([])
  })

  it('leaves unrelated tasks untouched by a link change', async () => {
    await seedTask(db, { id: 't1' })
    await seedTask(db, { id: 't2' })
    await invoke('task-vault:links:create', { taskId: 't1', targetId: TARGET })
    expect(await taskRow(db, 't2')).toMatchObject({ terminator_links: '[]' })
  })
})
