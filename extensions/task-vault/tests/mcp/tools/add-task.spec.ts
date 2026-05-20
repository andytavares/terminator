import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn(), mkdir: vi.fn() }
})

vi.mock('gray-matter', () => ({
  default: vi.fn((content: string) => ({ content, data: {} })),
}))

vi.mock('../../../src/mcp/auto-execute', () => ({
  getAutoExecuteSetting: vi.fn().mockResolvedValue(true),
  makeSuggestion: vi.fn((tool: string, desc: string) => ({
    suggestion: desc,
    tool,
    description: desc,
  })),
}))

vi.mock('../../../src/vault/indexer', () => ({
  buildIndex: vi.fn().mockResolvedValue({}),
}))

import { addTaskMcp } from '../../../src/mcp/tools/add-task'

const VAULT = '/vault'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fs.readFile).mockResolvedValue('- [ ] New task +proj\n' as unknown as Buffer)
  vi.mocked(fs.writeFile).mockResolvedValue()
  vi.mocked(fs.rename).mockResolvedValue()
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
})

describe('addTaskMcp', () => {
  it('adds a task and returns taskId', async () => {
    const result = await addTaskMcp(
      { filePath: '/vault/daily/2026-05-20.md', text: 'New task' },
      VAULT
    )
    expect('taskId' in result).toBe(true)
  })

  it('appends tags to task text', async () => {
    await addTaskMcp(
      {
        filePath: '/vault/daily/2026-05-20.md',
        text: 'Task',
        tags: { project: 'alpha', context: 'work', area: 'dev' },
      },
      VAULT
    )
    const written = (vi.mocked(fs.writeFile).mock.calls[0]?.[1] as string) ?? ''
    expect(written).toContain('+alpha')
  })

  it('returns suggestion when auto-execute is off', async () => {
    const { getAutoExecuteSetting } = await import('../../../src/mcp/auto-execute')
    vi.mocked(getAutoExecuteSetting).mockResolvedValue(false)
    const result = await addTaskMcp({ filePath: '/vault/daily.md', text: 'Task' }, VAULT)
    expect('suggestion' in result).toBe(true)
  })

  it('confirmed: true bypasses auto-execute gate', async () => {
    const { getAutoExecuteSetting } = await import('../../../src/mcp/auto-execute')
    vi.mocked(getAutoExecuteSetting).mockResolvedValue(false)
    const result = await addTaskMcp(
      { filePath: '/vault/daily/2026-05-20.md', text: 'Task', confirmed: true },
      VAULT
    )
    expect('taskId' in result).toBe(true)
  })
})
