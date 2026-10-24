import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Task } from '../../../../src/shared/schemas/tasks.schema'

let changed: ((tasks: Task[]) => void) | null = null

const api = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  addLane: vi.fn(),
  removeLane: vi.fn(),
  archive: vi.fn(),
  onChanged: vi.fn((handler: typeof changed) => {
    changed = handler
    return () => {
      changed = null
    }
  }),
}

Object.defineProperty(globalThis, 'window', {
  value: { electronAPI: { tasks: api } },
  writable: true,
})

import { useTaskStore } from '../../../../src/renderer/stores/task.store'

const task = (patch: Partial<Task> = {}): Task => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Billing',
  lanes: [{ repoRoot: '/code/api', branch: 'feat/x' }],
  ticket: null,
  focus: false,
  doneAt: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  archivedAt: null,
  ...patch,
})

beforeEach(() => {
  vi.clearAllMocks()
  changed = null
  useTaskStore.setState({ tasks: [] })
})

describe('task store', () => {
  it('loads every task main holds', async () => {
    api.list.mockResolvedValue({ data: [task(), task({ id: '2' })] })
    await useTaskStore.getState().load()
    expect(useTaskStore.getState().tasks.map((t) => t.id)).toHaveLength(2)
  })

  it('keeps the last known tasks when the load fails', async () => {
    useTaskStore.setState({ tasks: [task()] })
    api.list.mockRejectedValue(new Error('down'))
    await useTaskStore.getState().load()
    expect(useTaskStore.getState().tasks).toHaveLength(1)
  })
})

describe('task store events', () => {
  it('replaces its list with the payload of task:changed', () => {
    useTaskStore.setState({ tasks: [task()] })
    useTaskStore.getState().subscribe()
    changed!([task({ id: 'b', title: 'Infra' })])
    expect(useTaskStore.getState().tasks.map((t) => t.title)).toEqual(['Infra'])
  })

  it('stops listening when unsubscribed', () => {
    const unsubscribe = useTaskStore.getState().subscribe()
    unsubscribe()
    expect(changed).toBeNull()
  })
})

describe('task store writes', () => {
  it('mirrors an accepted write in place of the task it changed', async () => {
    useTaskStore.setState({ tasks: [task(), task({ id: 'b' })] })
    api.update.mockResolvedValue({ data: task({ focus: true }) })
    const ok = await useTaskStore.getState().update({ id: task().id, focus: true })
    expect(ok).toBe(true)
    expect(useTaskStore.getState().tasks.map((t) => t.focus)).toEqual([true, false])
  })

  it('appends a created task and passes the lane to addLane as given', async () => {
    api.create.mockResolvedValue({ data: task() })
    expect(await useTaskStore.getState().create({ title: 'Billing', lanes: task().lanes })).toBe(
      true
    )
    expect(useTaskStore.getState().tasks).toHaveLength(1)

    api.addLane.mockResolvedValue({ data: task() })
    await useTaskStore.getState().addLane('id-1', { repoRoot: '/r', branch: 'b' })
    expect(api.addLane).toHaveBeenCalledWith({ id: 'id-1', lane: { repoRoot: '/r', branch: 'b' } })
  })

  it('leaves the mirror as it was when a write is refused', async () => {
    useTaskStore.setState({ tasks: [task()] })
    api.archive.mockResolvedValue({ error: 'NOT_FOUND', message: 'No task' })
    expect(await useTaskStore.getState().archive('x', true)).toBe(false)
    expect(useTaskStore.getState().tasks).toEqual([task()])
  })
})
