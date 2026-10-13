import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { wrapDb } from '../../../../src/main/db/index'
import type { ExtensionDB } from '@terminator/extension-sdk'
import { registerKanbanIpcHandlers } from '../../src/ipc/kanban.ipc.js'
import { DEFAULT_KANBAN_CONFIG } from '../../src/vault/types.js'
import {
  createIpcHarness,
  createVaultDb,
  seedArea,
  seedProject,
  seedTask,
  taskRow,
} from '../support/vault-db'

let db: ExtensionDB
let harness: ReturnType<typeof createIpcHarness>

beforeEach(async () => {
  db = await createVaultDb()
  harness = createIpcHarness()
  registerKanbanIpcHandlers(harness.api, db)
})

const invoke = (channel: string, payload?: unknown) => harness.invoke(channel, payload)

describe('registerKanbanIpcHandlers', registerKanbanIpcHandlersTests)

function registerKanbanIpcHandlersTests() {
  describe('registration', registerKanbanIpcHandlersRegistrationTests)
  registerKanbanIpcHandlersConfigTests()
}

function registerKanbanIpcHandlersRegistrationTests() {
  it('registers the five kanban channels and dispose removes them', () => {
    const dispose = registerKanbanIpcHandlers(harness.api, db)
    expect(harness.channels().sort()).toEqual([
      'task-vault:kanban:get-config',
      'task-vault:kanban:list-contexts',
      'task-vault:kanban:list-tasks',
      'task-vault:kanban:move-task',
      'task-vault:kanban:save-config',
    ])
    dispose()
    expect(harness.channels()).toEqual([])
  })
}

const config = {
  viewMode: 'kanban',
  lanes: [{ id: 'todo', label: 'Todo', taskStatuses: ['open'] }],
  swimlaneGrouping: 'project',
}

function registerKanbanIpcHandlersConfigTests() {
  describe('config', configTests)
  describe('list-contexts', listContextsTests)
  describe('list-tasks', listTasksTests)
  describe('move-task', moveTaskTests)
  describe('when the database is closed', databaseClosedTests)
}

function listTasksTests() {
  describe('listing', listTasksListingTests)
  describe('metadata', listTasksMetadataTests)
}

function listTasksListingTests() {
  it('returns top-level tasks with project and area names, excluding migrated and cancelled', async () => {
    await seedProject(db, 'p1', 'alpha')
    await seedArea(db, 'a1', 'Work')
    await seedTask(db, { id: 'shown', projectId: 'p1', areaId: 'a1', dueDate: '2026-02-01' })
    await seedTask(db, { id: 'done', status: 'done' })
    await seedTask(db, { id: 'migrated', status: 'migrated' })
    await seedTask(db, { id: 'cancelled', status: 'cancelled' })
    await seedTask(db, { id: 'child', parentId: 'shown' })

    const result = (await invoke('task-vault:kanban:list-tasks')) as {
      tasks: Record<string, unknown>[]
    }

    expect(result.tasks.map((task) => task.id).sort()).toEqual(['done', 'shown'])
    expect(result.tasks.find((task) => task.id === 'shown')).toMatchObject({
      project: 'alpha',
      area: 'Work',
      dueDate: '2026-02-01',
      status: 'open',
    })
  })
}

function listTasksMetadataTests() {
  it('extracts the description from metadata', async () => {
    await seedTask(db, {
      id: 'described',
      metadata: JSON.stringify({ description: 'Detailed explanation' }),
    })
    await seedTask(db, { id: 'plain' })

    const result = (await invoke('task-vault:kanban:list-tasks')) as {
      tasks: Record<string, unknown>[]
    }

    expect(result.tasks.find((task) => task.id === 'described')?.description).toBe(
      'Detailed explanation'
    )
    expect(result.tasks.find((task) => task.id === 'plain')?.description).toBeUndefined()
  })

  it('tolerates malformed metadata', async () => {
    await seedTask(db, { id: 'bad', metadata: 'not-json{{{' })

    const result = (await invoke('task-vault:kanban:list-tasks')) as {
      tasks: Record<string, unknown>[]
    }

    expect(result.tasks).toHaveLength(1)
    expect(result.tasks[0].description).toBeUndefined()
  })
}

function configTests() {
  it('returns the default config when nothing is stored', async () => {
    expect(await invoke('task-vault:kanban:get-config')).toEqual(DEFAULT_KANBAN_CONFIG)
  })

  it('returns what save-config stored', async () => {
    expect(await invoke('task-vault:kanban:save-config', config)).toEqual({ ok: true })
    expect(await invoke('task-vault:kanban:get-config')).toEqual(config)
  })

  it("keeps a lane's calendar dot colour", async () => {
    const coloured = { ...config, lanes: [{ ...config.lanes[0], dotColor: '#ff8800' }] }
    await invoke('task-vault:kanban:save-config', coloured)
    expect(await invoke('task-vault:kanban:get-config')).toEqual(coloured)
  })

  it('replaces the stored config on a second save instead of adding a row', async () => {
    await invoke('task-vault:kanban:save-config', config)
    await invoke('task-vault:kanban:save-config', { ...config, swimlaneGrouping: 'area' })

    expect(await invoke('task-vault:kanban:get-config')).toMatchObject({
      swimlaneGrouping: 'area',
    })
    expect(await db.query(`SELECT key FROM settings WHERE key = 'kanban_config'`)).toHaveLength(1)
  })

  it('falls back to the default config when the stored value is not JSON', async () => {
    await db.run(
      `INSERT INTO settings (extension_id, key, value) VALUES ('task-vault', 'kanban_config', 'oops{')`
    )
    expect(await invoke('task-vault:kanban:get-config')).toEqual(DEFAULT_KANBAN_CONFIG)
  })
}

function listContextsTests() {
  it('returns the distinct non-empty contexts in order', async () => {
    await seedTask(db, { id: 't1', context: 'work' })
    await seedTask(db, { id: 't2', context: 'home' })
    await seedTask(db, { id: 't3', context: 'work' })
    await seedTask(db, { id: 't4', context: '' })
    await seedTask(db, { id: 't5' })

    expect(await invoke('task-vault:kanban:list-contexts')).toEqual({
      contexts: ['home', 'work'],
    })
  })
}

function moveTaskTests() {
  it('updates the task status', async () => {
    await seedTask(db, { id: 'task-1' })

    expect(
      await invoke('task-vault:kanban:move-task', { taskId: 'task-1', toStatus: 'in-progress' })
    ).toEqual({ ok: true })
    expect(await taskRow(db, 'task-1')).toMatchObject({ status: 'in-progress' })
  })

  it('reports a missing task', async () => {
    expect(
      await invoke('task-vault:kanban:move-task', { taskId: 'nonexistent', toStatus: 'done' })
    ).toEqual({ error: 'Task not found' })
  })
}

function databaseClosedTests() {
  it.each(['task-vault:kanban:list-tasks', 'task-vault:kanban:list-contexts'])(
    '%s returns the error',
    async (channel) => {
      const database = new DatabaseSync(':memory:')
      const closed = wrapDb(database)
      database.close()
      const other = createIpcHarness()
      registerKanbanIpcHandlers(other.api, closed)

      expect(await other.invoke(channel)).toMatchObject({
        error: expect.stringMatching(/not open/),
      })
    }
  )
}
