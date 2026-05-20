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
vi.mock('../../../src/mcp/auto-execute', () => ({
  getAutoExecuteSetting: vi.fn().mockResolvedValue(true),
  makeSuggestion: vi.fn((tool: string, desc: string) => ({
    suggestion: desc,
    tool,
    description: desc,
  })),
}))
vi.mock('../../../src/vault/indexer', () => ({
  buildIndex: vi.fn().mockResolvedValue({ tasks: [], projects: [], inboxCount: 0 }),
  readIndex: vi.fn().mockResolvedValue({
    version: 1,
    builtAt: '',
    vaultPath: '/vault',
    tasks: [
      {
        id: '/vault/daily/2026-05-19.md:1',
        filePath: '/vault/daily/2026-05-19.md',
        line: 1,
        status: 'open',
        text: 'Task',
        terminatorLinks: [],
      },
    ],
    projects: [],
    inboxCount: 0,
  }),
  getTaskById: vi
    .fn()
    .mockReturnValue({
      id: '/vault/daily/2026-05-19.md:1',
      filePath: '/vault/daily/2026-05-19.md',
      line: 1,
      status: 'open',
      text: 'Task',
      terminatorLinks: [],
    }),
}))

import { migrateTaskMcp } from '../../../src/mcp/tools/migrate-task'

const VAULT = '/vault'

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(fs.readFile)
    .mockResolvedValueOnce('- [ ] Task\n' as unknown as Buffer) // source (migrateTask → readLines)
    .mockResolvedValueOnce('' as unknown as Buffer) // target day (migrateTask → write target)
    .mockResolvedValue('- [ ] Task\n' as unknown as Buffer) // target re-read for new task ID
  vi.mocked(fs.writeFile).mockResolvedValue()
  vi.mocked(fs.rename).mockResolvedValue()
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
  vi.mocked(fs.readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
  vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as unknown as Awaited<
    ReturnType<typeof fs.stat>
  >)
  // Reset getTaskById in case a previous test changed it
  const { getTaskById } = await import('../../../src/vault/indexer')
  vi.mocked(getTaskById).mockReturnValue({
    id: '/vault/daily/2026-05-19.md:1',
    filePath: '/vault/daily/2026-05-19.md',
    line: 1,
    status: 'open',
    text: 'Task',
    terminatorLinks: [],
  })
})

describe('migrateTaskMcp', () => {
  it('migrates a valid task', async () => {
    const result = await migrateTaskMcp(
      { taskId: '/vault/daily/2026-05-19.md:1', targetDate: '2026-05-20' },
      VAULT
    )
    expect('newTaskId' in result).toBe(true)
  })

  it('returns STALE_ID for unknown task', async () => {
    const { getTaskById } = await import('../../../src/vault/indexer')
    vi.mocked(getTaskById).mockReturnValue(null)
    const result = await migrateTaskMcp(
      { taskId: 'nonexistent:99', targetDate: '2026-05-20' },
      VAULT
    )
    expect(result).toMatchObject({ error: 'STALE_ID' })
  })

  it('writes [>] to source file and creates target day file', async () => {
    await migrateTaskMcp(
      { taskId: '/vault/daily/2026-05-19.md:1', targetDate: '2026-05-20' },
      VAULT
    )
    const writeCalls = vi.mocked(fs.writeFile).mock.calls
    const sourceWrite = writeCalls.find((c) => {
      const content = c[1] as string
      return content.includes('[>]')
    })
    expect(sourceWrite).toBeDefined()
  })
})
