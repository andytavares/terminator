import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } }
    models = { list: vi.fn(async () => ({ data: [] })) }
  },
}))

vi.mock('../../../src/core/keychain.js', () => ({
  retrieveKey: vi.fn(async () => 'sk-openai-key'),
}))

import { OpenAIAdapter } from '../../../src/providers/openai.js'
import { retrieveKey as _rk } from '../../../src/core/keychain.js'
const mockRetrieveKey = vi.mocked(_rk)

const adapter = new OpenAIAdapter('p2', 'gpt-4o', 'foundry.p2.apikey')

const BASE_REQ = {
  mode: 'spec-to-code' as const,
  providerId: 'p2',
  model: 'gpt-4o',
  prompt: 'test prompt',
  workspaceRoot: '/ws',
  agentsMdContent: '',
  iterationLimit: 3,
}

function makeStream(
  chunks: Array<{
    content?: string
    finish?: string
    usage?: { prompt_tokens: number; completion_tokens: number }
  }>
) {
  return async function* () {
    for (const c of chunks) {
      yield {
        choices: [{ delta: { content: c.content ?? null }, finish_reason: c.finish ?? null }],
        usage: c.usage ?? null,
      }
    }
  }
}

beforeEach(() => mockCreate.mockReset())

describe('OpenAIAdapter', () => {
  it('supportsStreaming is true', () => expect(adapter.supportsStreaming).toBe(true))

  it('run() yields token events', async () => {
    mockCreate.mockImplementation(
      makeStream([
        { content: 'Hello' },
        { content: ' world', finish: 'stop', usage: { prompt_tokens: 80, completion_tokens: 40 } },
      ])
    )
    const tokens: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) {
      if (ev.type === 'token') tokens.push(ev.token)
    }
    expect(tokens).toContain('Hello')
  })

  it('run() yields done event with token counts from usage chunk', async () => {
    mockCreate.mockImplementation(
      makeStream([
        { content: 'Hi' },
        { usage: { prompt_tokens: 10, completion_tokens: 5 } },
        { finish: 'stop' },
      ])
    )
    let done: { tokenCountIn: number; tokenCountOut: number } | undefined
    for await (const ev of adapter.run(BASE_REQ)) {
      if (ev.type === 'done') done = ev as typeof done
    }
    expect(done?.tokenCountIn).toBe(10)
    expect(done?.tokenCountOut).toBe(5)
  })

  it('run() uses agentsMdContent as system prompt', async () => {
    let capturedMessages: unknown[] = []
    mockCreate.mockImplementation(async function* (opts: { messages: unknown[] }) {
      capturedMessages = opts.messages
      yield { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }], usage: null }
    })
    for await (const _ of adapter.run({ ...BASE_REQ, agentsMdContent: '# Guidelines' })) {
      /* drain */
    }
    const sys = (capturedMessages[0] as { content: string }).content
    expect(sys).toBe('# Guidelines')
  })

  it('run() yields error when API key is missing', async () => {
    mockRetrieveKey.mockResolvedValueOnce(null)
    const events: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) events.push(ev.type)
    expect(events).toContain('error')
  })

  it('run() yields error when API throws', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Rate limit'))
    const events: Array<{ type: string; message?: string }> = []
    for await (const ev of adapter.run(BASE_REQ))
      events.push(ev as { type: string; message?: string })
    expect(events.find((e) => e.type === 'error')?.message).toContain('Rate limit')
  })

  it('testConnection() returns ok', async () => {
    expect((await adapter.testConnection()).ok).toBe(true)
  })

  it('testConnection() returns false when key is missing', async () => {
    mockRetrieveKey.mockResolvedValueOnce(null)
    expect((await adapter.testConnection()).ok).toBe(false)
  })
})
