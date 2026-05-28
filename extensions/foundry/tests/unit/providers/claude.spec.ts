import { describe, it, expect, vi } from 'vitest'

// Mock the file system so write_file/str_replace tests don't touch disk
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(async (p: string) => {
      if (String(p).endsWith('existing.ts')) return 'const x = 1;\nconsole.log(x);\n'
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }),
    writeFile: vi.fn(async () => {}),
    mkdir: vi.fn(async () => {}),
    access: vi.fn(async (p: string) => {
      if (String(p).endsWith('existing.ts')) return
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }),
    readdir: vi.fn(async () => []),
  }
})

vi.mock('../../../src/core/keychain.js', () => ({
  retrieveKey: vi.fn(async () => 'sk-test-key'),
}))

// Build a mock messages.create response
function makeResponse(
  content: Array<{ type: string; text?: string; name?: string; id?: string; input?: unknown }>,
  stopReason = 'end_turn'
) {
  return {
    content,
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate }
    models = { list: vi.fn(async () => ({ data: [{ id: 'claude-sonnet' }] })) }
  },
}))

import { ClaudeAdapter } from '../../../src/providers/claude.js'
import { retrieveKey as _rk } from '../../../src/core/keychain.js'
const mockRetrieveKey = vi.mocked(_rk)

const adapter = new ClaudeAdapter('provider-1', 'claude-sonnet-4-6', 'foundry.provider.p1.apikey')

const BASE_REQUEST = {
  mode: 'spec-to-code' as const,
  providerId: 'provider-1',
  model: 'claude-sonnet-4-6',
  prompt: 'Build auth middleware',
  workspaceRoot: '/workspace',
  agentsMdContent: '# Agents\nBe careful.',
  iterationLimit: 3,
}

async function collectEvents(gen: AsyncIterable<{ type: string; [k: string]: unknown }>) {
  const events: Array<{ type: string; [k: string]: unknown }> = []
  for await (const e of gen) events.push(e)
  return events
}

describe('ClaudeAdapter', () => {
  it('supportsStreaming is true', () => {
    expect(adapter.supportsStreaming).toBe(true)
  })

  it('yields error event when API key is missing', async () => {
    mockRetrieveKey.mockResolvedValueOnce(null)
    const events = await collectEvents(adapter.run(BASE_REQUEST))
    expect(events.some((e) => e.type === 'error')).toBe(true)
  })

  it('yields token events for text blocks', async () => {
    mockCreate.mockResolvedValueOnce(
      makeResponse([{ type: 'text', text: 'I will implement the auth middleware.\nStarting now.' }])
    )
    const events = await collectEvents(adapter.run(BASE_REQUEST))
    const tokens = events.filter((e) => e.type === 'token').map((e) => e.token)
    expect(tokens.some((t) => String(t).includes('auth middleware'))).toBe(true)
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('yields done event with aggregated token counts', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse([{ type: 'text', text: 'Done.' }]))
    const events = await collectEvents(adapter.run(BASE_REQUEST))
    const done = events.find((e) => e.type === 'done') as
      | { tokenCountIn: number; tokenCountOut: number }
      | undefined
    expect(done).toBeDefined()
    expect(done?.tokenCountIn).toBe(100)
    expect(done?.tokenCountOut).toBe(50)
  })

  it('executes write_file tool and yields file-changed event', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeResponse(
          [
            {
              type: 'tool_use',
              id: 't1',
              name: 'write_file',
              input: { path: 'src/new.ts', content: 'export const x = 1;\n' },
            },
          ],
          'tool_use'
        )
      )
      .mockResolvedValueOnce(makeResponse([{ type: 'text', text: 'Done.' }]))

    const events = await collectEvents(adapter.run(BASE_REQUEST))
    const fileChange = events.find((e) => e.type === 'file-changed') as
      | { filePath: string }
      | undefined
    expect(fileChange).toBeDefined()
    expect(String(fileChange?.filePath)).toContain('new.ts')
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('executes str_replace tool on existing file', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeResponse(
          [
            {
              type: 'tool_use',
              id: 't2',
              name: 'str_replace',
              input: { path: 'existing.ts', old_str: 'const x = 1;', new_str: 'const x = 42;' },
            },
          ],
          'tool_use'
        )
      )
      .mockResolvedValueOnce(makeResponse([{ type: 'text', text: 'Done.' }]))

    const events = await collectEvents(adapter.run(BASE_REQUEST))
    const fileChange = events.find((e) => e.type === 'file-changed') as
      | { filePath: string }
      | undefined
    expect(fileChange).toBeDefined()
    expect(String(fileChange?.filePath)).toContain('existing.ts')
  })

  it('str_replace returns error output when old_str not found', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeResponse(
          [
            {
              type: 'tool_use',
              id: 't3',
              name: 'str_replace',
              input: { path: 'existing.ts', old_str: 'NOT_IN_FILE', new_str: 'replacement' },
            },
          ],
          'tool_use'
        )
      )
      .mockResolvedValueOnce(makeResponse([{ type: 'text', text: 'Done.' }]))

    // Should NOT yield file-changed since old_str not found
    const events = await collectEvents(adapter.run(BASE_REQUEST))
    expect(events.some((e) => e.type === 'file-changed')).toBe(false)
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('executes read_file tool', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeResponse(
          [{ type: 'tool_use', id: 't4', name: 'read_file', input: { path: 'existing.ts' } }],
          'tool_use'
        )
      )
      .mockResolvedValueOnce(makeResponse([{ type: 'text', text: 'Done.' }]))

    const events = await collectEvents(adapter.run(BASE_REQUEST))
    expect(events.some((e) => e.type === 'done')).toBe(true)
    // No file-changed event for read-only operation
    expect(events.some((e) => e.type === 'file-changed')).toBe(false)
  })

  it('executes list_files tool', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeResponse(
          [{ type: 'tool_use', id: 't5', name: 'list_files', input: { dir: '.' } }],
          'tool_use'
        )
      )
      .mockResolvedValueOnce(makeResponse([{ type: 'text', text: 'Listed.' }]))

    const events = await collectEvents(adapter.run(BASE_REQUEST))
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('read_file returns error output when file does not exist', async () => {
    const { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    )
    mockCreate
      .mockResolvedValueOnce(
        makeResponse(
          [{ type: 'tool_use', id: 'r1', name: 'read_file', input: { path: 'missing.ts' } }],
          'tool_use'
        )
      )
      .mockResolvedValueOnce(makeResponse([{ type: 'text', text: 'Done.' }]))
    const events = await collectEvents(adapter.run(BASE_REQUEST))
    // Tool continues — error is returned as tool_result content, not as a RunEvent error
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('write_file with existing file yields modified status', async () => {
    const { access } = await import('node:fs/promises')
    vi.mocked(access).mockResolvedValueOnce(undefined) // file exists
    mockCreate
      .mockResolvedValueOnce(
        makeResponse(
          [
            {
              type: 'tool_use',
              id: 'w1',
              name: 'write_file',
              input: { path: 'existing.ts', content: 'updated' },
            },
          ],
          'tool_use'
        )
      )
      .mockResolvedValueOnce(makeResponse([{ type: 'text', text: 'Done.' }]))
    const events = await collectEvents(adapter.run(BASE_REQUEST))
    const fc = events.find((e) => e.type === 'file-changed') as
      | { change?: { status: string } }
      | undefined
    expect(fc?.change?.status).toBe('modified')
  })

  it('list_files returns empty directory message', async () => {
    const { readdir } = await import('node:fs/promises')
    vi.mocked(readdir).mockResolvedValueOnce([])
    mockCreate
      .mockResolvedValueOnce(
        makeResponse(
          [{ type: 'tool_use', id: 'l1', name: 'list_files', input: { dir: 'empty-dir' } }],
          'tool_use'
        )
      )
      .mockResolvedValueOnce(makeResponse([{ type: 'text', text: 'Done.' }]))
    const events = await collectEvents(adapter.run(BASE_REQUEST))
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('handles unknown tool gracefully', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeResponse([{ type: 'tool_use', id: 't6', name: 'unknown_tool', input: {} }], 'tool_use')
      )
      .mockResolvedValueOnce(makeResponse([{ type: 'text', text: 'OK.' }]))

    const events = await collectEvents(adapter.run(BASE_REQUEST))
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('yields error event when API throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Network error'))
    const events = await collectEvents(adapter.run(BASE_REQUEST))
    const err = events.find((e) => e.type === 'error') as { message: string } | undefined
    expect(err).toBeDefined()
    expect(err?.message).toContain('Network error')
  })

  it('testConnection() returns ok=true when API is reachable', async () => {
    const result = await adapter.testConnection()
    expect(result.ok).toBe(true)
    expect(typeof result.latencyMs).toBe('number')
  })

  it('testConnection() returns ok=false when key is missing', async () => {
    mockRetrieveKey.mockResolvedValueOnce(null)
    const result = await adapter.testConnection()
    expect(result.ok).toBe(false)
  })
})
