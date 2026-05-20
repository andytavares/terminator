import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() }
})

vi.mock('gray-matter', () => ({
  default: vi.fn((content: string) => ({ content, data: {} })),
}))

import { getTodayLog } from '../../../src/mcp/tools/today'

const VAULT = '/vault'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fs.writeFile).mockResolvedValue()
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
})

describe('getTodayLog', () => {
  it('returns today log when file exists', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('- [ ] Task\n' as unknown as Buffer)
    const result = await getTodayLog(VAULT)
    expect(result).toMatchObject({ exists: true })
    expect('tasks' in result).toBe(true)
  })

  it('auto-creates file when missing and returns exists: false', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'))
    const result = await getTodayLog(VAULT)
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalled()
    expect(result).toMatchObject({ exists: false })
  })

  it('returns date in YYYY-MM-DD format', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('' as unknown as Buffer)
    const result = (await getTodayLog(VAULT)) as { date: string }
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
