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

describe('task store merge', () => {
  it('moves every lane of one task into another and drops the first, in one write', async () => {
    const store = await load()
    const into = await store.createTask({ title: 'Billing', lanes: [api] })
    const from = await store.createTask({
      title: 'Infra',
      lanes: [web, infra],
      ticket: { tracker: 'linear', key: 'NW-88' },
    })
    await store.updateTask({ id: from.id, focus: true })
    const seen: number[] = []
    store.onTaskChange((tasks) => seen.push(tasks.length))
    const merged = await store.mergeTasks(from.id, into.id)
    expect(merged).toMatchObject({
      id: into.id,
      title: 'Billing',
      lanes: [api, web, infra],
      focus: true,
      ticket: { tracker: 'linear', key: 'NW-88' },
    })
    expect(store.listTasks()).toEqual([merged])
    expect(seen).toEqual([1])
    expect(JSON.parse(fs.readFileSync(FILE(), 'utf8'))).toEqual([merged])
  })
})

describe('task store merge — what the receiver keeps', () => {
  it('keeps the receiving task’s own ticket', async () => {
    const store = await load()
    const into = await store.createTask({
      title: 'Billing',
      lanes: [api],
      ticket: { tracker: 'jira', key: 'BIL-1' },
    })
    const from = await store.createTask({
      title: 'Infra',
      lanes: [infra],
      ticket: { tracker: 'linear', key: 'NW-88' },
    })
    expect((await store.mergeTasks(from.id, into.id)).ticket).toEqual({
      tracker: 'jira',
      key: 'BIL-1',
    })
  })
})

describe('task store merge — refusals', () => {
  it('refuses to merge a task into itself or into one that does not exist', async () => {
    const store = await load()
    const task = await store.createTask({ title: 'Billing', lanes: [api] })
    await expect(store.mergeTasks(task.id, task.id)).rejects.toMatchObject({ code: 'SAME_TASK' })
    await expect(store.mergeTasks(task.id, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(store.mergeTasks('nope', task.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(store.listTasks()).toEqual([task])
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

describe('task store startup', () => {
  const stored = {
    id: '6f1c2a4e-1b7d-4c1e-9a55-0d3f6b2c8e11',
    title: 'Rate limits',
    lanes: [api],
    ticket: null,
    focus: false,
    doneAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    archivedAt: null,
  }

  it('tells a window that listed before the file was read what it holds', async () => {
    fs.writeFileSync(FILE(), JSON.stringify([stored]))
    const store = await load()
    const seen: string[][] = []
    store.onTaskChange((tasks) => seen.push(tasks.map((t) => t.title)))
    await store.loadTasks()
    expect(seen).toEqual([['Rate limits']])
  })

  it('keeps a task created while the file is still being read', async () => {
    fs.writeFileSync(FILE(), JSON.stringify([stored]))
    const store = await load()
    const loading = store.loadTasks()
    const created = await store.createTask({ title: 'Billing', lanes: [web] })
    await loading
    expect(store.listTasks().map((t) => t.id)).toEqual([stored.id, created.id])
  })
})

describe('task store write failures', () => {
  it('keeps memory as it was when the write fails, so a refused change is not saved later', async () => {
    const store = await load()
    await store.createTask({ title: 'Billing', lanes: [api] })
    const docs = await store.createTask({ title: 'Docs', lanes: [web] })
    const before = store.listTasks()
    userData = path.join(FILE(), 'not-a-folder')
    await expect(store.addLane(docs.id, api)).rejects.toThrow()
    expect(store.listTasks()).toEqual(before)
  })
})
