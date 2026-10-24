import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { vi } from 'vitest'
import { makeTempDir } from '../../support/temp-dir'

let userData: string

vi.mock('electron', () => ({ app: { getPath: () => userData } }))

async function load() {
  vi.resetModules()
  return import('../../../src/main/tasks/task-store')
}

const FILE = () => path.join(userData, 'tasks.json')
const api = { repoRoot: '/code/api', branch: 'feat/x' }
const web = { repoRoot: '/code/web', branch: 'feat/x' }
const infra = { repoRoot: '/code/infra', branch: 'main' }

beforeEach(() => {
  userData = makeTempDir('task-store-')
})

describe('task store', () => {
  it('creates a task with its lanes, not done, not archived, not focused', async () => {
    const store = await load()
    const task = await store.createTask({ title: 'Billing', lanes: [api, web] })
    expect(task).toMatchObject({
      title: 'Billing',
      lanes: [api, web],
      ticket: null,
      focus: false,
      doneAt: null,
      archivedAt: null,
    })
    expect(store.listTasks()).toEqual([task])
  })

  it('ignores a duplicate lane within one task', async () => {
    const store = await load()
    const task = await store.createTask({ title: 'Billing', lanes: [api, { ...api }] })
    expect(task.lanes).toEqual([api])
    expect((await store.addLane(task.id, api)).lanes).toEqual([api])
  })
})

describe('task store lanes', () => {
  it('moves a lane that another task holds when it is added elsewhere', async () => {
    const store = await load()
    const first = await store.createTask({ title: 'Billing', lanes: [api, web] })
    const second = await store.createTask({ title: 'Infra', lanes: [infra] })
    await store.addLane(second.id, web)
    const byId = new Map(store.listTasks().map((t) => [t.id, t]))
    expect(byId.get(first.id)!.lanes).toEqual([api])
    expect(byId.get(second.id)!.lanes).toEqual([infra, web])
  })

  it('moves a lane out of an older task when a new task is created with it', async () => {
    const store = await load()
    const first = await store.createTask({ title: 'Billing', lanes: [api] })
    await store.createTask({ title: 'Again', lanes: [api] })
    expect(store.listTasks().find((t) => t.id === first.id)!.lanes).toEqual([])
  })

  it('keeps a task whose last lane is removed', async () => {
    const store = await load()
    const task = await store.createTask({ title: 'Billing', lanes: [api] })
    const emptied = await store.removeLane(task.id, api)
    expect(emptied.lanes).toEqual([])
    expect(store.listTasks()).toHaveLength(1)
  })
})

describe('task store updates', () => {
  it('updates title, focus and ticket, leaving what is not given', async () => {
    const store = await load()
    const task = await store.createTask({ title: 'Billing', lanes: [api] })
    const updated = await store.updateTask({
      id: task.id,
      title: 'Billing v2',
      focus: true,
      ticket: { tracker: 'linear', key: 'NW-1' },
    })
    expect(updated).toMatchObject({
      title: 'Billing v2',
      focus: true,
      ticket: { tracker: 'linear', key: 'NW-1' },
      lanes: [api],
    })
    const cleared = await store.updateTask({ id: task.id, ticket: null })
    expect(cleared.ticket).toBeNull()
    expect(cleared.title).toBe('Billing v2')
  })
})

describe('task store done and archive', () => {
  it('marks a task done with the time, and undoing clears it', async () => {
    const store = await load()
    const task = await store.createTask({ title: 'Billing', lanes: [api] })
    const done = await store.updateTask({ id: task.id, done: true })
    expect(Number.isNaN(Date.parse(done.doneAt!))).toBe(false)
    expect((await store.updateTask({ id: task.id, done: false })).doneAt).toBeNull()
  })

  it('archives a task and restores it', async () => {
    const store = await load()
    const task = await store.createTask({ title: 'Billing', lanes: [api] })
    const archived = await store.archiveTask(task.id, true)
    expect(Number.isNaN(Date.parse(archived.archivedAt!))).toBe(false)
    expect((await store.archiveTask(task.id, false)).archivedAt).toBeNull()
  })
})

describe('task store failures', () => {
  it('rejects an unknown id with NOT_FOUND on every write', async () => {
    const store = await load()
    const writes = [
      store.updateTask({ id: 'nope', focus: true }),
      store.addLane('nope', api),
      store.removeLane('nope', api),
      store.archiveTask('nope', true),
    ]
    for (const write of writes) await expect(write).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('announces the full list after a change', async () => {
    const store = await load()
    const seen: number[] = []
    store.onTaskChange((tasks) => seen.push(tasks.length))
    await store.createTask({ title: 'Billing', lanes: [api] })
    await store.createTask({ title: 'Infra', lanes: [infra] })
    expect(seen).toEqual([1, 2])
  })
})

describe('task store persistence', () => {
  it('writes the tasks to tasks.json and reads them back', async () => {
    const store = await load()
    const task = await store.createTask({ title: 'Billing', lanes: [api, web] })
    expect(JSON.parse(fs.readFileSync(FILE(), 'utf8'))).toEqual([task])

    const reloaded = await load()
    await reloaded.loadTasks()
    expect(reloaded.listTasks()).toEqual([task])
  })
})

describe('task store loading', () => {
  it('drops invalid stored entries and keeps the valid ones', async () => {
    const store = await load()
    const task = await store.createTask({ title: 'Billing', lanes: [api] })
    const stored = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    fs.writeFileSync(
      FILE(),
      JSON.stringify([
        stored[0],
        { id: 'not-a-uuid', title: 'x' },
        'junk',
        { ...stored[0], title: '' },
      ])
    )
    const reloaded = await load()
    await reloaded.loadTasks()
    expect(reloaded.listTasks()).toEqual([task])
  })

  it('starts empty when the file is missing or is not a list', async () => {
    const store = await load()
    await store.loadTasks()
    expect(store.listTasks()).toEqual([])
    fs.writeFileSync(FILE(), '{"not":"a list"}')
    await store.loadTasks()
    expect(store.listTasks()).toEqual([])
  })
})
