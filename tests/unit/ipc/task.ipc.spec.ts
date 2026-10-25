import { describe, it, expect, beforeEach, vi } from 'vitest'
import { makeTempDir } from '../../support/temp-dir'
import type { Task } from '../../../src/shared/schemas/tasks.schema'

type Handler = (event: unknown, payload?: unknown) => unknown
const handlers = vi.hoisted(() => new Map<string, Handler>())

let userData: string

vi.mock('electron', () => ({
  app: { getPath: () => userData },
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
}))

let sent: Array<{ channel: string; data: unknown }>

const openWindow = () => ({
  isDestroyed: () => false,
  webContents: {
    isDestroyed: () => false,
    send: (channel: string, data: unknown) => sent.push({ channel, data }),
  },
})

async function invoke<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  const handler = handlers.get(channel)
  if (handler === undefined) throw new Error(`no handler for ${channel}`)
  return (await handler({}, payload)) as T
}

const api = { repoRoot: '/code/api', branch: 'feat/x' }
const web = { repoRoot: '/code/web', branch: 'feat/x' }

beforeEach(async () => {
  vi.resetModules()
  handlers.clear()
  userData = makeTempDir('task-ipc-')
  sent = []
  const mod = await import('../../../src/main/ipc/task.ipc')
  mod.registerTaskHandlers(() => openWindow() as never)
})

describe('task channels', () => {
  it('creates a task and lists it', async () => {
    const created = await invoke<{ data: Task }>('task:create', { title: 'Billing', lanes: [api] })
    expect(created.data.title).toBe('Billing')
    const listed = await invoke<{ data: Task[] }>('task:list')
    expect(listed.data.map((t) => t.id)).toEqual([created.data.id])
  })
})

describe('task channel validation', () => {
  it.each([
    ['an empty title', { title: '', lanes: [api] }],
    ['a title over 120 characters', { title: 'x'.repeat(121), lanes: [api] }],
    ['no lanes', { title: 'Billing', lanes: [] }],
    ['a lane with an empty branch', { title: 'Billing', lanes: [{ repoRoot: '/r', branch: '' }] }],
  ])('refuses to create a task with %s', async (_label, payload) => {
    const result = await invoke<{ error: string }>('task:create', payload)
    expect(result.error).toBe('VALIDATION_ERROR')
    expect((await invoke<{ data: Task[] }>('task:list')).data).toEqual([])
  })

  it('refuses a lane without a repository on add-lane', async () => {
    const result = await invoke<{ error: string }>('task:add-lane', {
      id: 'x',
      lane: { repoRoot: '', branch: 'main' },
    })
    expect(result.error).toBe('VALIDATION_ERROR')
  })

  it('answers NOT_FOUND for an unknown task', async () => {
    const result = await invoke<{ error: string }>('task:archive', { id: 'nope', archived: true })
    expect(result.error).toBe('NOT_FOUND')
  })
})

describe('task channel merge', () => {
  it('merges one task into another, leaving one', async () => {
    const into = await invoke<{ data: Task }>('task:create', { title: 'Billing', lanes: [api] })
    const from = await invoke<{ data: Task }>('task:create', { title: 'Web', lanes: [web] })
    const merged = await invoke<{ data: Task }>('task:merge', {
      from: from.data.id,
      into: into.data.id,
    })
    expect(merged.data.lanes).toEqual([api, web])
    expect((await invoke<{ data: Task[] }>('task:list')).data.map((t) => t.id)).toEqual([
      into.data.id,
    ])
  })

  it('answers SAME_TASK for a task merged into itself', async () => {
    const { data } = await invoke<{ data: Task }>('task:create', { title: 'Billing', lanes: [api] })
    const result = await invoke<{ error: string }>('task:merge', { from: data.id, into: data.id })
    expect(result.error).toBe('SAME_TASK')
  })
})

describe('task channel writes', () => {
  it('adds, removes and archives through their channels, announcing the full list', async () => {
    const { data } = await invoke<{ data: Task }>('task:create', { title: 'Billing', lanes: [api] })
    await invoke('task:add-lane', { id: data.id, lane: web })
    await invoke('task:remove-lane', { id: data.id, lane: api })
    await invoke('task:update', { id: data.id, done: true })
    await invoke('task:archive', { id: data.id, archived: true })

    const last = sent.at(-1)!
    expect(last.channel).toBe('task:changed')
    const [task] = last.data as Task[]
    expect(task.lanes).toEqual([web])
    expect(task.doneAt).not.toBeNull()
    expect(task.archivedAt).not.toBeNull()
    expect(sent).toHaveLength(5)
  })
})
