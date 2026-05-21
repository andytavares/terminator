import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGet, mockAll, mockPrepare } = vi.hoisted(() => {
  const mockGet = vi.fn()
  const mockAll = vi.fn()
  const mockPrepare = vi.fn(() => ({ run: vi.fn(), get: mockGet, all: mockAll }))
  return { mockGet, mockAll, mockPrepare }
})

vi.mock('../../../src/vault/indexer', () => ({
  readIndex: vi.fn(),
}))

vi.mock('../../../src/vault/db', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare })),
  randomUUID: vi.fn(() => 'test-uuid'),
}))

import { weeklyReviewMcp } from '../../../src/mcp/tools/weekly-review'

const VAULT = '/vault'

const inboxTaskRow = {
  id: 'task-1',
  source: 'inbox',
  source_ref: null,
  status: 'open',
  text: 'Inbox item',
  project: null,
  context: null,
  area: null,
  due_date: null,
  terminator_links: '[]',
}

const activeProjectRow = {
  id: 'proj-1',
  name: 'alpha',
  status: 'active',
  area: null,
  deadline: null,
  updated_at: new Date().toISOString(),
  terminator_links: '[]',
}

const staleProjectRow = {
  id: 'proj-2',
  name: 'stale',
  status: 'active',
  area: null,
  deadline: null,
  updated_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
  terminator_links: '[]',
}

const somedayProjectRow = {
  id: 'proj-3',
  name: 'someday',
  status: 'someday',
  area: null,
  deadline: null,
  updated_at: new Date().toISOString(),
  terminator_links: '[]',
}

const completedTaskRow = {
  id: 'task-2',
  source: '/vault/daily',
  source_ref: 'yesterday.md',
  status: 'done',
  text: 'Done task',
  project: null,
  context: null,
  area: null,
  due_date: null,
  terminator_links: '[]',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAll.mockReturnValue([])
  mockGet.mockReturnValue({ c: 0 })
})

describe('weeklyReviewMcp', () => {
  it('returns inbox items', async () => {
    // all() order: inbox, activeProjects, someday, completed
    mockAll
      .mockReturnValueOnce([inboxTaskRow])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
    const result = (await weeklyReviewMcp(VAULT)) as { inboxItems: unknown[] }
    expect(result.inboxItems).toHaveLength(1)
  })

  it('returns active projects', async () => {
    mockAll
      .mockReturnValueOnce([])
      .mockReturnValueOnce([activeProjectRow])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
    mockGet.mockReturnValue({ c: 2 })
    const result = (await weeklyReviewMcp(VAULT)) as { activeProjects: unknown[] }
    expect(result.activeProjects.length).toBeGreaterThanOrEqual(1)
  })

  it('returns stale projects', async () => {
    // staleProject has nextActionCount=0 → isStale=true
    mockAll
      .mockReturnValueOnce([])
      .mockReturnValueOnce([staleProjectRow])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
    mockGet.mockReturnValue({ c: 0 })
    const result = (await weeklyReviewMcp(VAULT)) as { staleProjects: unknown[] }
    expect(result.staleProjects).toHaveLength(1)
  })

  it('returns someday projects', async () => {
    mockAll
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([somedayProjectRow])
      .mockReturnValueOnce([])
    const result = (await weeklyReviewMcp(VAULT)) as { someDayProjects: unknown[] }
    expect(result.someDayProjects).toHaveLength(1)
  })

  it('returns completed tasks from last week', async () => {
    mockAll
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([completedTaskRow])
    const result = (await weeklyReviewMcp(VAULT)) as { completedLastWeek: unknown[] }
    expect(result.completedLastWeek).toHaveLength(1)
  })
})
