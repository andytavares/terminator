import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockIndex } = vi.hoisted(() => ({
  mockIndex: {
    version: 1,
    builtAt: '',
    vaultPath: '/vault',
    tasks: [
      {
        id: '/vault/daily/2026-05-19.md:1',
        filePath: '/vault/daily/2026-05-19.md',
        line: 1,
        status: 'open',
        text: 'Task A',
        project: 'proj1',
        context: 'home',
        area: 'work',
        dueDate: '2026-05-20',
        terminatorLinks: [],
      },
      {
        id: '/vault/daily/2026-05-19.md:2',
        filePath: '/vault/daily/2026-05-19.md',
        line: 2,
        status: 'done',
        text: 'Task B',
        project: 'proj2',
        context: 'phone',
        area: 'personal',
        dueDate: '2026-05-25',
        terminatorLinks: [],
      },
      {
        id: '/vault/daily/2026-05-19.md:3',
        filePath: '/vault/daily/2026-05-19.md',
        line: 3,
        status: 'open',
        text: 'Task C',
        terminatorLinks: [],
      },
    ],
    projects: [],
    inboxCount: 0,
  },
}))

vi.mock('../../../src/vault/indexer', () => ({
  readIndex: vi.fn().mockResolvedValue(mockIndex),
}))

import { queryTasks } from '../../../src/mcp/tools/query'

const VAULT = '/vault'

beforeEach(() => vi.clearAllMocks())

describe('queryTasks', () => {
  it('returns all tasks when no filters', async () => {
    const result = await queryTasks({}, VAULT)
    expect('tasks' in result).toBe(true)
    expect((result as { tasks: unknown[] }).tasks).toHaveLength(3)
  })

  it('filters by status: open', async () => {
    const result = (await queryTasks({ status: 'open' }, VAULT)) as { tasks: { status: string }[] }
    expect(result.tasks.every((t) => t.status === 'open')).toBe(true)
    expect(result.tasks).toHaveLength(2)
  })

  it('filters by status array', async () => {
    const result = (await queryTasks({ status: ['open', 'done'] }, VAULT)) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(3)
  })

  it('filters by context', async () => {
    const result = (await queryTasks({ context: 'home' }, VAULT)) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(1)
  })

  it('filters by project', async () => {
    const result = (await queryTasks({ project: 'proj1' }, VAULT)) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(1)
  })

  it('filters by area', async () => {
    const result = (await queryTasks({ area: 'work' }, VAULT)) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(1)
  })

  it('filters by dueBefore', async () => {
    const result = (await queryTasks({ dueBefore: '2026-05-22' }, VAULT)) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(1)
  })

  it('returns empty tasks when index is null', async () => {
    const { readIndex } = await import('../../../src/vault/indexer')
    vi.mocked(readIndex).mockResolvedValueOnce(null)
    const result = (await queryTasks({}, VAULT)) as { tasks: unknown[] }
    expect(result.tasks).toHaveLength(0)
  })
})
