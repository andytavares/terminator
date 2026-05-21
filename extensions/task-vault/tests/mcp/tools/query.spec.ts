import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRun, mockGet, mockAll, mockPrepare } = vi.hoisted(() => {
  const mockRun = vi.fn().mockReturnValue({ changes: 1 })
  const mockGet = vi.fn()
  const mockAll = vi.fn().mockReturnValue([])
  const mockPrepare = vi.fn().mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
  return { mockRun, mockGet, mockAll, mockPrepare }
})

vi.mock('../../../src/vault/db', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare })),
  randomUUID: vi.fn(() => 'test-uuid'),
}))

import { queryTasks } from '../../../src/mcp/tools/query'

const VAULT = '/vault'

const rowA = {
  id: 'uuid-a',
  text: 'Task A',
  status: 'open',
  project: 'proj1',
  context: 'home',
  area: 'work',
  due_date: '2026-05-20',
  source: 'daily',
  source_ref: '2026-05-19',
  terminator_links: '[]',
}

const rowB = {
  id: 'uuid-b',
  text: 'Task B',
  status: 'done',
  project: 'proj2',
  context: 'phone',
  area: 'personal',
  due_date: '2026-05-25',
  source: 'daily',
  source_ref: '2026-05-19',
  terminator_links: '[]',
}

const rowC = {
  id: 'uuid-c',
  text: 'Task C',
  status: 'open',
  project: null,
  context: null,
  area: null,
  due_date: null,
  source: 'inbox',
  source_ref: null,
  terminator_links: '[]',
}

const allRows = [rowA, rowB, rowC]

beforeEach(() => {
  vi.clearAllMocks()
  mockAll.mockReturnValue(allRows)
  mockGet.mockReturnValue(undefined)
  mockRun.mockReturnValue({ changes: 1 })
  mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
})

describe('queryTasks', () => {
  it('returns all tasks when no filters', async () => {
    const result = await queryTasks({}, VAULT)
    expect('tasks' in result).toBe(true)
    expect((result as { tasks: unknown[] }).tasks).toHaveLength(3)
  })

  it('filters by status: open', async () => {
    mockAll.mockReturnValue([rowA, rowC])
    const result = (await queryTasks({ status: 'open' }, VAULT)) as { tasks: { status: string }[] }
    expect(result.tasks.every((t) => t.status === 'open')).toBe(true)
    expect(result.tasks).toHaveLength(2)
  })

  it('filters by status array', async () => {
    mockAll.mockReturnValue(allRows)
    const result = (await queryTasks({ status: ['open', 'done'] }, VAULT)) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(3)
  })

  it('filters by context', async () => {
    mockAll.mockReturnValue([rowA])
    const result = (await queryTasks({ context: 'home' }, VAULT)) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(1)
  })

  it('filters by project', async () => {
    mockAll.mockReturnValue([rowA])
    const result = (await queryTasks({ project: 'proj1' }, VAULT)) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(1)
  })

  it('filters by area', async () => {
    mockAll.mockReturnValue([rowA])
    const result = (await queryTasks({ area: 'work' }, VAULT)) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(1)
  })

  it('filters by dueBefore', async () => {
    mockAll.mockReturnValue([rowA])
    const result = (await queryTasks({ dueBefore: '2026-05-22' }, VAULT)) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(1)
  })

  it('returns empty tasks when getDb throws', async () => {
    const { getDb } = await import('../../../src/vault/db')
    vi.mocked(getDb).mockImplementationOnce(() => {
      throw new Error('VaultDB not initialized')
    })
    const result = (await queryTasks({}, VAULT)) as { error: string }
    expect('error' in result).toBe(true)
  })
})
