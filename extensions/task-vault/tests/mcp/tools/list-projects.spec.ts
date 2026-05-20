import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockIndex } = vi.hoisted(() => ({
  mockIndex: {
    version: 1,
    builtAt: '',
    vaultPath: '/vault',
    tasks: [],
    projects: [
      {
        id: '/vault/projects/alpha.md',
        filePath: '/vault/projects/alpha.md',
        name: 'alpha',
        status: 'active',
        isStale: false,
        nextActionCount: 2,
        lastModified: new Date().toISOString(),
        terminatorLinks: [],
      },
      {
        id: '/vault/projects/beta.md',
        filePath: '/vault/projects/beta.md',
        name: 'beta',
        status: 'someday',
        isStale: true,
        nextActionCount: 0,
        lastModified: new Date().toISOString(),
        terminatorLinks: [],
      },
      {
        id: '/vault/projects/gamma.md',
        filePath: '/vault/projects/gamma.md',
        name: 'gamma',
        status: 'done',
        isStale: false,
        nextActionCount: 0,
        lastModified: new Date().toISOString(),
        terminatorLinks: [],
      },
    ],
    inboxCount: 0,
  },
}))

vi.mock('../../../src/vault/indexer', () => ({
  readIndex: vi.fn().mockResolvedValue(mockIndex),
}))

import { listProjectsMcp } from '../../../src/mcp/tools/list-projects'

const VAULT = '/vault'

beforeEach(() => vi.clearAllMocks())

describe('listProjectsMcp', () => {
  it('returns active projects by default', async () => {
    const result = (await listProjectsMcp({}, VAULT)) as { projects: { status: string }[] }
    expect(result.projects.every((p) => p.status === 'active')).toBe(true)
  })

  it('filters by status', async () => {
    const result = (await listProjectsMcp({ status: 'someday' }, VAULT)) as { projects: unknown[] }
    expect(result.projects).toHaveLength(1)
  })

  it('staleness flag matches index data', async () => {
    const result = (await listProjectsMcp({ status: 'active' }, VAULT)) as {
      projects: { isStale: boolean }[]
    }
    expect(result.projects[0].isStale).toBe(false)
  })

  it('next action count is correct', async () => {
    const result = (await listProjectsMcp({ status: 'active' }, VAULT)) as {
      projects: { nextActionCount: number }[]
    }
    expect(result.projects[0].nextActionCount).toBe(2)
  })
})
