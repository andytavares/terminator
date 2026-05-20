import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetSetting = vi.fn()
vi.mock('../../../src/mcp/auto-execute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/mcp/auto-execute')>()
  return {
    ...actual,
    getAutoExecuteSetting: (...args: unknown[]) => mockGetSetting(...args),
  }
})

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
  getTaskById: vi.fn().mockReturnValue({
    id: '/vault/daily/2026-05-19.md:1',
    filePath: '/vault/daily/2026-05-19.md',
    line: 1,
    status: 'open',
    text: 'Task',
    terminatorLinks: [],
  }),
}))

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

import { captureTask } from '../../../src/mcp/tools/capture'
import { completeTaskMcp } from '../../../src/mcp/tools/complete-task'
import { migrateTaskMcp } from '../../../src/mcp/tools/migrate-task'
import { makeSuggestion } from '../../../src/mcp/auto-execute'

const VAULT = '/vault'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fs.readFile).mockResolvedValue('- [ ] Task\n' as unknown as Buffer)
  vi.mocked(fs.writeFile).mockResolvedValue()
  vi.mocked(fs.rename).mockResolvedValue()
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
  vi.mocked(fs.readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
  vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as unknown as Awaited<
    ReturnType<typeof fs.stat>
  >)
})

describe('auto-execute gate', () => {
  it('returns suggestion when toggle is off for capture', async () => {
    mockGetSetting.mockResolvedValue(false)
    const result = await captureTask({ text: 'Test task' }, VAULT)
    expect('suggestion' in result).toBe(true)
    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled()
  })

  it('writes immediately when toggle is on', async () => {
    mockGetSetting.mockResolvedValue(true)
    const result = await captureTask({ text: 'Test task' }, VAULT)
    expect('taskId' in result).toBe(true)
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalled()
  })

  it('bypasses toggle when confirmed=true', async () => {
    mockGetSetting.mockResolvedValue(false)
    const result = await captureTask({ text: 'Test task', confirmed: true }, VAULT)
    expect('taskId' in result).toBe(true)
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalled()
  })

  it('complete-task returns suggestion when toggle off', async () => {
    mockGetSetting.mockResolvedValue(false)
    const result = await completeTaskMcp({ taskId: '/vault/daily/2026-05-19.md:1' }, VAULT)
    expect('suggestion' in result).toBe(true)
  })

  it('migrate-task returns suggestion when toggle off', async () => {
    mockGetSetting.mockResolvedValue(false)
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce('- [ ] Task\n' as unknown as Buffer)
      .mockResolvedValueOnce('' as unknown as Buffer)
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
