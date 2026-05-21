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

import { getTodayLog } from '../../../src/mcp/tools/today'

const VAULT = '/vault'

beforeEach(() => {
  vi.clearAllMocks()
  mockAll.mockReturnValue([])
  mockGet.mockReturnValue(undefined)
  mockRun.mockReturnValue({ changes: 1 })
  mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
})

const taskRow = {
  id: 'task-1',
  source: 'daily',
  source_ref: '2026-05-21',
  text: 'Do work',
  status: 'open',
  project: null,
  context: null,
  area: null,
  due_date: null,
  terminator_links: '[]',
  parent_id: null,
  sort_order: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  completed_date: null,
  migrated_to: null,
}

describe('getTodayLog', () => {
  it('returns today log with tasks array', async () => {
    mockAll.mockReturnValue([])
    const result = await getTodayLog(VAULT)
    expect('tasks' in result).toBe(true)
    if ('tasks' in result) {
      expect(Array.isArray(result.tasks)).toBe(true)
    }
  })

  it('returns date in YYYY-MM-DD format', async () => {
    mockAll.mockReturnValue([])
    const result = await getTodayLog(VAULT)
    expect('date' in result).toBe(true)
    if ('date' in result) {
      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('returns exists: false when no tasks, events or notes', async () => {
    mockAll.mockReturnValue([])
    const result = await getTodayLog(VAULT)
    if ('exists' in result) {
      expect(result.exists).toBe(false)
    }
  })

  it('maps task rows and returns exists: true', async () => {
    mockAll
      .mockReturnValueOnce([taskRow]) // tasks
      .mockReturnValueOnce([]) // subtasks for task-1
      .mockReturnValueOnce([]) // events
      .mockReturnValueOnce([]) // notes
    const result = await getTodayLog(VAULT)
    if ('tasks' in result) {
      expect(result.tasks).toHaveLength(1)
      expect(result.tasks[0].text).toBe('Do work')
      expect(result.exists).toBe(true)
    }
  })

  it('maps task with project and context tags', async () => {
    const taggedRow = {
      ...taskRow,
      project: 'alpha',
      context: 'work',
      area: 'finance',
      due_date: '2026-06-01',
    }
    mockAll
      .mockReturnValueOnce([taggedRow])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
    const result = await getTodayLog(VAULT)
    if ('tasks' in result) {
      expect(result.tasks[0].project).toBe('alpha')
      expect(result.tasks[0].context).toBe('work')
      expect(result.tasks[0].area).toBe('finance')
      expect(result.tasks[0].dueDate).toBe('2026-06-01')
    }
  })

  it('returns error when db throws', async () => {
    mockAll.mockImplementation(() => {
      throw new Error('DB error')
    })
    const result = await getTodayLog(VAULT)
    expect(result).toMatchObject({ error: expect.stringContaining('DB error') })
  })
})
