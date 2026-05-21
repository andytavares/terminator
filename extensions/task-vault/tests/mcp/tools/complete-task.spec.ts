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

import { completeTaskMcp } from '../../../src/mcp/tools/complete-task'

const VAULT = '/vault'

beforeEach(() => {
  vi.clearAllMocks()
  mockAll.mockReturnValue([])
  mockGet.mockReturnValue(undefined)
  mockRun.mockReturnValue({ changes: 1 })
  mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
})

describe('completeTaskMcp', () => {
  it('completes a valid task', async () => {
    mockGet.mockReturnValue({ id: 'task-1', text: 'Task' })
    const result = await completeTaskMcp({ taskId: 'task-1' }, VAULT)
    expect(result).toMatchObject({ success: true })
  })

  it('returns STALE_ID for invalid task', async () => {
    mockGet.mockReturnValue(undefined)
    const result = await completeTaskMcp({ taskId: 'nonexistent:99' }, VAULT)
    expect(result).toMatchObject({ error: 'STALE_ID' })
  })

  it('calls UPDATE on db after finding task', async () => {
    mockGet.mockReturnValue({ id: 'task-1', text: 'Task' })
    await completeTaskMcp({ taskId: 'task-1' }, VAULT)
    expect(mockRun).toHaveBeenCalled()
  })
})
