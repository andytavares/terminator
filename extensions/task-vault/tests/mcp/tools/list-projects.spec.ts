import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGet, mockAll, mockPrepare } = vi.hoisted(() => {
  const mockRun = vi.fn().mockReturnValue({ changes: 1 })
  const mockGet = vi.fn()
  const mockAll = vi.fn().mockReturnValue([])
  const mockPrepare = vi.fn().mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
  return { mockGet, mockAll, mockPrepare }
})

vi.mock('../../../src/vault/db', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare })),
  randomUUID: vi.fn(() => 'test-uuid'),
}))

import { listProjectsMcp } from '../../../src/mcp/tools/list-projects'

const VAULT = '/vault'

const projectRow = {
  id: 'proj-1',
  name: 'Alpha',
  status: 'active',
  area: null,
  deadline: null,
  outcome: null,
  terminator_links: '[]',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

beforeEach(() => vi.clearAllMocks())

describe('listProjectsMcp', () => {
  it('returns active projects by default', async () => {
    mockAll.mockReturnValue([projectRow])
    mockGet.mockReturnValue({ c: 2 })
    const result = (await listProjectsMcp({}, VAULT)) as { projects: { status: string }[] }
    expect(result.projects.length >= 1).toBe(true)
    expect(result.projects.every((p) => p.status === 'active')).toBe(true)
  })

  it('filters by status', async () => {
    mockAll.mockReturnValue([{ ...projectRow, status: 'someday' }])
    mockGet.mockReturnValue({ c: 0 })
    const result = (await listProjectsMcp({ status: 'someday' }, VAULT)) as {
      projects: unknown[]
    }
    expect(result.projects).toHaveLength(1)
  })

  it('staleness flag matches nextActionCount=0', async () => {
    mockAll.mockReturnValue([projectRow])
    mockGet.mockReturnValue({ c: 0 })
    const result = (await listProjectsMcp({ status: 'active' }, VAULT)) as {
      projects: { isStale: boolean }[]
    }
    expect(result.projects[0].isStale).toBe(true)
  })

  it('next action count is correct', async () => {
    mockAll.mockReturnValue([projectRow])
    mockGet.mockReturnValue({ c: 3 })
    const result = (await listProjectsMcp({ status: 'active' }, VAULT)) as {
      projects: { nextActionCount: number }[]
    }
    expect(result.projects[0].nextActionCount).toBe(3)
  })
})
