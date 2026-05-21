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

vi.mock('../../../src/mcp/auto-execute', () => ({
  getAutoExecuteSetting: vi.fn().mockResolvedValue(true),
  makeSuggestion: vi.fn((tool: string, desc: string) => ({
    suggestion: desc,
    tool,
    description: desc,
  })),
}))

import { migrateTaskMcp } from '../../../src/mcp/tools/migrate-task'

const VAULT = '/vault'

beforeEach(() => {
  vi.clearAllMocks()
  mockAll.mockReturnValue([])
  mockGet.mockReturnValue(undefined)
  mockRun.mockReturnValue({ changes: 1 })
  mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
})

describe('migrateTaskMcp', () => {
  it('migrates a valid task', async () => {
    mockGet.mockReturnValue({
      id: 'task-1',
      text: 'Task',
      project: null,
      context: null,
      area: null,
      due_date: null,
    })
    const result = await migrateTaskMcp({ taskId: 'task-1', targetDate: '2026-05-20' }, VAULT)
    expect(result).toMatchObject({ newTaskId: 'test-uuid' })
  })

  it('returns STALE_ID for unknown task', async () => {
    mockGet.mockReturnValue(undefined)
    const result = await migrateTaskMcp(
      { taskId: 'nonexistent:99', targetDate: '2026-05-20' },
      VAULT
    )
    expect(result).toMatchObject({ error: 'STALE_ID' })
  })

  it('calls run twice: UPDATE source and INSERT new task', async () => {
    mockGet.mockReturnValue({
      id: 'task-1',
      text: 'Task',
      project: null,
      context: null,
      area: null,
      due_date: null,
    })
    await migrateTaskMcp({ taskId: 'task-1', targetDate: '2026-05-20' }, VAULT)
    expect(mockRun).toHaveBeenCalledTimes(2)
  })
})
