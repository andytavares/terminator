import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockIndex } = vi.hoisted(() => {
  const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return {
    mockIndex: {
      version: 1,
      builtAt: '',
      vaultPath: '/vault',
      tasks: [
        {
          id: '/vault/inbox.md:1',
          filePath: '/vault/inbox.md',
          line: 1,
          status: 'open',
          text: 'Inbox item',
          terminatorLinks: [],
        },
        {
          id: '/vault/daily/yesterday.md:1',
          filePath: `/vault/daily/${yesterday}.md`,
          line: 1,
          status: 'done',
          text: 'Done task',
          terminatorLinks: [],
        },
      ],
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
          id: '/vault/projects/stale.md',
          filePath: '/vault/projects/stale.md',
          name: 'stale',
          status: 'active',
          isStale: true,
          nextActionCount: 0,
          lastModified: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
          terminatorLinks: [],
        },
        {
          id: '/vault/projects/someday.md',
          filePath: '/vault/projects/someday.md',
          name: 'someday',
          status: 'someday',
          isStale: false,
          nextActionCount: 0,
          lastModified: new Date().toISOString(),
          terminatorLinks: [],
        },
      ],
      inboxCount: 1,
    },
  }
})

vi.mock('../../../src/vault/indexer', () => ({
  readIndex: vi.fn().mockResolvedValue(mockIndex),
}))

import { weeklyReviewMcp } from '../../../src/mcp/tools/weekly-review'

const VAULT = '/vault'

beforeEach(() => vi.clearAllMocks())

describe('weeklyReviewMcp', () => {
  it('returns inbox items', async () => {
    const result = (await weeklyReviewMcp(VAULT)) as { inboxItems: unknown[] }
    expect(result.inboxItems).toHaveLength(1)
  })

  it('returns active projects', async () => {
    const result = (await weeklyReviewMcp(VAULT)) as { activeProjects: unknown[] }
    expect(result.activeProjects.length).toBeGreaterThanOrEqual(1)
  })

  it('returns stale projects', async () => {
    const result = (await weeklyReviewMcp(VAULT)) as { staleProjects: unknown[] }
    expect(result.staleProjects).toHaveLength(1)
  })

  it('returns someday projects', async () => {
    const result = (await weeklyReviewMcp(VAULT)) as { someDayProjects: unknown[] }
    expect(result.someDayProjects).toHaveLength(1)
  })

  it('returns completed tasks from last week', async () => {
    const result = (await weeklyReviewMcp(VAULT)) as { completedLastWeek: unknown[] }
    expect(result.completedLastWeek).toHaveLength(1)
  })
})
