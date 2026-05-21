import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn() }
})

import { getAutoExecuteSetting, makeSuggestion } from '../../src/mcp/auto-execute'

const VAULT = '/vault'

beforeEach(() => vi.clearAllMocks())

describe('getAutoExecuteSetting', () => {
  it('returns false when settings file missing', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'))
    const result = await getAutoExecuteSetting('capture', VAULT)
    expect(result).toBe(false)
  })

  it('returns true when setting enabled', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ mcpAutoExecute: { capture: true } }) as unknown as Buffer
    )
    const result = await getAutoExecuteSetting('capture', VAULT)
    expect(result).toBe(true)
  })

  it('returns false when tool not in settings', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ mcpAutoExecute: {} }) as unknown as Buffer
    )
    const result = await getAutoExecuteSetting('capture', VAULT)
    expect(result).toBe(false)
  })

  it('returns false when mcpAutoExecute missing', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}) as unknown as Buffer)
    const result = await getAutoExecuteSetting('capture', VAULT)
    expect(result).toBe(false)
  })
})

describe('makeSuggestion', () => {
  it('returns suggestion object with tool and description', () => {
    const result = makeSuggestion('capture', 'Capture a task')
    expect(result).toMatchObject({ tool: 'capture', description: 'Capture a task' })
    expect(result.suggestion).toContain('confirmed: true')
  })
})
