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
vi.mock('../../../src/vault/indexer', () => ({
  buildIndex: vi.fn().mockResolvedValue({ tasks: [], projects: [], inboxCount: 0 }),
}))
vi.mock('../../../src/mcp/auto-execute', () => ({
  getAutoExecuteSetting: vi.fn().mockResolvedValue(true),
  makeSuggestion: vi.fn((tool: string, desc: string) => ({
    suggestion: desc,
    tool,
    description: desc,
  })),
}))

import { captureTask } from '../../../src/mcp/tools/capture'

const VAULT = '/vault'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fs.readFile).mockResolvedValue('- [ ] Existing\n' as unknown as Buffer)
  vi.mocked(fs.writeFile).mockResolvedValue()
  vi.mocked(fs.rename).mockResolvedValue()
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
  vi.mocked(fs.readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
  vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as unknown as Awaited<
    ReturnType<typeof fs.stat>
  >)
})

describe('captureTask', () => {
  it('captures valid text to inbox', async () => {
    const result = await captureTask({ text: 'Buy groceries' }, VAULT)
    expect('taskId' in result).toBe(true)
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalled()
  })

  it('returns error for empty text', async () => {
    const result = await captureTask({ text: '' }, VAULT)
    expect('error' in result).toBe(true)
  })

  it('includes hint tags in written content', async () => {
    await captureTask({ text: 'Buy groceries', hintProject: 'home', hintArea: 'errands' }, VAULT)
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    expect(written).toContain('+home')
    expect(written).toContain('#errands')
  })
})
