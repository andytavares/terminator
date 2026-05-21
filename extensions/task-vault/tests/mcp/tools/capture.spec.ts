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

import { captureTask } from '../../../src/mcp/tools/capture'

const VAULT = '/vault'

beforeEach(() => {
  vi.clearAllMocks()
  mockAll.mockReturnValue([])
  mockGet.mockReturnValue(undefined)
  mockRun.mockReturnValue({ changes: 1 })
  mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
})

describe('captureTask', () => {
  it('captures valid text to inbox', async () => {
    const result = await captureTask({ text: 'Buy groceries' }, VAULT)
    expect(result).toEqual({ taskId: 'test-uuid' })
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO tasks'))
    expect(mockRun).toHaveBeenCalled()
  })

  it('returns error for empty text', async () => {
    const result = await captureTask({ text: '' }, VAULT)
    expect('error' in result).toBe(true)
  })

  it('includes hint tags in INSERT params', async () => {
    await captureTask({ text: 'Buy groceries', hintProject: 'home', hintArea: 'errands' }, VAULT)
    expect(mockRun).toHaveBeenCalled()
    const runArgs = mockRun.mock.calls[0] as unknown[]
    const joined = runArgs.join(' ')
    expect(joined).toContain('home')
    expect(joined).toContain('errands')
  })
})
