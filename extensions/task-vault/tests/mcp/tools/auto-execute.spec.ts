import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetSetting = vi.fn()
vi.mock('../../../src/mcp/auto-execute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/mcp/auto-execute')>()
  return {
    ...actual,
    getAutoExecuteSetting: (...args: unknown[]) => mockGetSetting(...args),
  }
})

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

import { captureTask } from '../../../src/mcp/tools/capture'
import { completeTaskMcp } from '../../../src/mcp/tools/complete-task'
import { migrateTaskMcp } from '../../../src/mcp/tools/migrate-task'
import { makeSuggestion } from '../../../src/mcp/auto-execute'

const VAULT = '/vault'

const taskRow = {
  id: '/vault/daily/2026-05-19.md:1',
  text: 'Task',
  status: 'open',
  project: null,
  context: null,
  area: null,
  due_date: null,
  source: 'daily',
  source_ref: '2026-05-19',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGet.mockReturnValue(taskRow)
  mockRun.mockReturnValue({ changes: 1 })
  mockAll.mockReturnValue([])
})

describe('auto-execute gate', () => {
  it('returns suggestion when toggle is off for capture', async () => {
    mockGetSetting.mockResolvedValue(false)
    const result = await captureTask({ text: 'Test task' }, VAULT)
    expect('suggestion' in result).toBe(true)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('writes immediately when toggle is on', async () => {
    mockGetSetting.mockResolvedValue(true)
    const result = await captureTask({ text: 'Test task' }, VAULT)
    expect('taskId' in result).toBe(true)
    expect(mockRun).toHaveBeenCalled()
  })

  it('bypasses toggle when confirmed=true', async () => {
    mockGetSetting.mockResolvedValue(false)
    const result = await captureTask({ text: 'Test task', confirmed: true }, VAULT)
    expect('taskId' in result).toBe(true)
    expect(mockRun).toHaveBeenCalled()
  })

  it('complete-task returns suggestion when toggle off', async () => {
    mockGetSetting.mockResolvedValue(false)
    const result = await completeTaskMcp({ taskId: '/vault/daily/2026-05-19.md:1' }, VAULT)
    expect('suggestion' in result).toBe(true)
  })

  it('migrate-task returns suggestion when toggle off', async () => {
    mockGetSetting.mockResolvedValue(false)
    const result = await migrateTaskMcp(
      { taskId: '/vault/daily/2026-05-19.md:1', targetDate: '2026-05-20' },
      VAULT
    )
    expect('suggestion' in result).toBe(true)
  })
})

describe('makeSuggestion', () => {
  it('returns structured suggestion object', () => {
    const s = makeSuggestion('capture', 'Would capture: Buy groceries to inbox.md')
    expect(s).toMatchObject({
      suggestion: expect.any(String),
      tool: 'capture',
      description: expect.any(String),
    })
  })
})
