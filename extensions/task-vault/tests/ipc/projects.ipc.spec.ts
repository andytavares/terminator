import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
  }
})

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

vi.mock('gray-matter', () => ({
  default: Object.assign(
    vi.fn((content: string) => ({ content, data: { status: 'active' } })),
    {
      stringify: vi.fn(
        (content: string, data: Record<string, unknown>) =>
          `---\nstatus: ${data.status}\n---\n${content}`
      ),
    }
  ),
}))

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
    ],
    inboxCount: 0,
  },
}))

vi.mock('../../src/vault/indexer', () => ({
  buildIndex: vi.fn().mockResolvedValue(mockIndex),
  readIndex: vi.fn().mockResolvedValue(mockIndex),
  getTaskById: vi.fn().mockReturnValue(null),
}))

import {
  registerProjectsIpcHandlers,
  setVaultPath as setProjectsVaultPath,
} from '../../src/ipc/projects.ipc'

const VAULT = '/vault'

beforeEach(() => {
  vi.clearAllMocks()
  setProjectsVaultPath(VAULT)
})

describe('task-vault:projects:list IPC handler', () => {
  it('registers the projects list handler', () => {
    registerProjectsIpcHandlers()
    const channels = vi.mocked(mockHandle).mock.calls.map((c) => c[0])
    expect(channels).toContain('task-vault:projects:list')
  })

  it('returns only active projects by default', async () => {
    let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(mockHandle).mockImplementation((channel, fn) => {
      if (channel === 'task-vault:projects:list') handler = fn as typeof handler
    })
    registerProjectsIpcHandlers()
    const result = (await handler!({}, {})) as { projects: { status: string }[] }
    expect(result.projects.every((p) => p.status === 'active')).toBe(true)
  })

  it('filters by status', async () => {
    let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(mockHandle).mockImplementation((channel, fn) => {
      if (channel === 'task-vault:projects:list') handler = fn as typeof handler
    })
    registerProjectsIpcHandlers()
    const result = (await handler!({}, { status: 'someday' })) as { projects: unknown[] }
    expect(result.projects).toHaveLength(1)
  })
})

describe('task-vault:projects:weekly-review IPC handler', () => {
  function getWeeklyReviewHandler() {
    let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(mockHandle).mockImplementation((channel, fn) => {
      if (channel === 'task-vault:projects:weekly-review') handler = fn as typeof handler
    })
    registerProjectsIpcHandlers()
    if (!handler) throw new Error('weekly-review handler not registered')
    return handler
  }

  it('returns inbox items', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      '- [ ] Inbox item 1\n- [ ] Inbox item 2\n' as unknown as Buffer
    )
    vi.mocked(fs.readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
    const handler = getWeeklyReviewHandler()
    const result = (await handler({}, {})) as { inboxItems: unknown[] }
    expect(result.inboxItems.length).toBeGreaterThan(0)
  })

  it('returns active and stale projects', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('' as unknown as Buffer)
    vi.mocked(fs.readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
    const handler = getWeeklyReviewHandler()
    const result = (await handler({}, {})) as {
      activeProjects: unknown[]
      staleProjects: unknown[]
    }
    expect(Array.isArray(result.activeProjects)).toBe(true)
    expect(Array.isArray(result.staleProjects)).toBe(true)
  })

  it('returns someday projects', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('' as unknown as Buffer)
    vi.mocked(fs.readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
    const handler = getWeeklyReviewHandler()
    const result = (await handler({}, {})) as { somedayProjects: unknown[] }
    expect(Array.isArray(result.somedayProjects)).toBe(true)
    expect(result.somedayProjects).toHaveLength(1) // beta is someday in mockIndex
  })

  it('returns prior week completed tasks', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toISOString().slice(0, 10)
    vi.mocked(fs.readFile).mockResolvedValue(`- [x] Completed task\n` as unknown as Buffer)
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: `${dateStr}.md`, isFile: () => true },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
    const handler = getWeeklyReviewHandler()
    const result = (await handler({}, {})) as { completedLastWeek: unknown[] }
    expect(Array.isArray(result.completedLastWeek)).toBe(true)
  })

  it('returns null lastReviewDate when no review recorded', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('- [ ] Regular task\n' as unknown as Buffer)
    vi.mocked(fs.readdir).mockResolvedValue([
      { name: '2026-05-18.md', isFile: () => true },
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
    const handler = getWeeklyReviewHandler()
    const result = (await handler({}, {})) as { lastReviewDate: string | null }
    expect(result.lastReviewDate).toBeNull()
  })
})

describe('task-vault:vault:update-project-status IPC handler', () => {
  it('registers the update-project-status handler', () => {
    registerProjectsIpcHandlers()
    const channels = vi.mocked(mockHandle).mock.calls.map((c) => c[0])
    expect(channels).toContain('task-vault:vault:update-project-status')
  })

  it('writes updated frontmatter to project file', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('content' as unknown as Buffer)
    vi.mocked(fs.writeFile).mockResolvedValue()
    vi.mocked(fs.rename).mockResolvedValue()

    let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(mockHandle).mockImplementation((channel, fn) => {
      if (channel === 'task-vault:vault:update-project-status') handler = fn as typeof handler
    })
    registerProjectsIpcHandlers()

    await handler!({}, { projectFilePath: '/vault/projects/alpha.md', status: 'done' })
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalled()
  })
})
