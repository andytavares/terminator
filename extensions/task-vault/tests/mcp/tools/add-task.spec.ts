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

import { addTaskMcp } from '../../../src/mcp/tools/add-task'

const VAULT = '/vault'

beforeEach(() => {
  vi.clearAllMocks()
  mockAll.mockReturnValue([])
  mockGet.mockReturnValue(undefined)
  mockRun.mockReturnValue({ changes: 1 })
  mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
})

describe('addTaskMcp', () => {
  it('adds a task and returns taskId', async () => {
    const result = await addTaskMcp(
      { filePath: '/vault/daily/2026-05-20.md', text: 'New task' },
      VAULT
    )
    expect(result).toEqual({ taskId: 'test-uuid' })
  })

  it('calls db.prepare with INSERT when adding a task', async () => {
    await addTaskMcp(
      {
        filePath: '/vault/daily/2026-05-20.md',
        text: 'Task',
        tags: { project: 'alpha', context: 'work', area: 'dev' },
      },
      VAULT
    )
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO tasks'))
    expect(mockRun).toHaveBeenCalled()
  })

  it('returns suggestion when auto-execute is off', async () => {
    const { getAutoExecuteSetting } = await import('../../../src/mcp/auto-execute')
    vi.mocked(getAutoExecuteSetting).mockResolvedValue(false)
    const result = await addTaskMcp({ filePath: '/vault/daily.md', text: 'Task' }, VAULT)
    expect('suggestion' in result).toBe(true)
  })

  it('confirmed: true bypasses auto-execute gate', async () => {
    const { getAutoExecuteSetting } = await import('../../../src/mcp/auto-execute')
    vi.mocked(getAutoExecuteSetting).mockResolvedValue(false)
    const result = await addTaskMcp(
      { filePath: '/vault/daily/2026-05-20.md', text: 'Task', confirmed: true },
      VAULT
    )
    expect(result).toEqual({ taskId: 'test-uuid' })
  })
})
