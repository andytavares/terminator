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

// Mock tools so file I/O isn't triggered
vi.mock('../../../src/providers/tools.js', () => ({
  FILE_TOOLS_OPENAI: [],
  executeTool: vi.fn(async () => ({ output: 'ok' })),
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

// Helper: create a non-streaming chat completion response with no tool calls
function makeResponse(content: string, tokenIn = 10, tokenOut = 5) {
  return {
    choices: [{ message: { content, tool_calls: null }, finish_reason: 'stop' }],
    usage: { prompt_tokens: tokenIn, completion_tokens: tokenOut },
  }
}

beforeEach(() => mockCreate.mockReset())

describe('OpenAIAdapter', () => {
  it('supportsStreaming is true', () => expect(adapter.supportsStreaming).toBe(true))

  it('run() yields token events', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse('Hello world'))
    const tokens: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) {
      if (ev.type === 'token') tokens.push(ev.token)
    }
    expect(tokens.join('')).toContain('Hello world')
  })

  it('run() yields done event with token counts', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse('Hi', 80, 40))
    let done: { tokenCountIn: number; tokenCountOut: number } | undefined
    for await (const ev of adapter.run(BASE_REQ)) {
      if (ev.type === 'done') done = ev as typeof done
    }
    expect(done?.tokenCountIn).toBe(80)
    expect(done?.tokenCountOut).toBe(40)
  })

  it('run() uses agentsMdContent as system prompt', async () => {
    let capturedMessages: Array<{ role: string; content: string }> = []
    mockCreate.mockImplementation(async function (opts: {
      messages: Array<{ role: string; content: string }>
    }) {
      capturedMessages = opts?.messages ?? []
      return makeResponse('ok')
    })
    for await (const _ of adapter.run({ ...BASE_REQ, agentsMdContent: '# Guidelines' })) {
      /* drain */
    }
    const sys = capturedMessages.find((m) => m.role === 'system')?.content ?? ''
    expect(sys).toContain('# Guidelines')
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

  it('run() includes conversationHistory in messages', async () => {
    let capturedMessages: Array<{ role: string }> = []
    mockCreate.mockImplementation(async function (opts: { messages: Array<{ role: string }> }) {
      capturedMessages = opts?.messages ?? []
      return makeResponse('ok')
    })
    const history = [
      { id: '1', role: 'user' as const, content: 'prev message', timestamp: '' },
      { id: '2', role: 'agent' as const, content: 'prev reply', timestamp: '' },
    ]
    for await (const _ of adapter.run({ ...BASE_REQ, conversationHistory: history })) {
      /* drain */
    }
    const roles = capturedMessages.map((m) => m.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
  })

  it('run() executes tool calls and continues loop', async () => {
    const { executeTool } = await import('../../../src/providers/tools.js')
    vi.mocked(executeTool).mockResolvedValueOnce({ output: 'file contents' })

    // First call: returns a tool_call; second call: returns normal text (loop termination)
    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'call1', function: { name: 'read_file', arguments: '{"path":"foo.ts"}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      })
      .mockResolvedValueOnce(makeResponse('All done'))

    const tokens: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) {
      if (ev.type === 'token') tokens.push(ev.token)
    }
    expect(tokens.join('')).toContain('All done')
  })

  it('run() handles malformed tool call arguments gracefully', async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: 'NOT_JSON' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })
      .mockResolvedValueOnce(makeResponse('ok'))
    const events: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) events.push(ev.type)
    expect(events).toContain('done')
  })

  it('respects requestDelayMs before sending request', async () => {
    vi.useFakeTimers()
    const delayedAdapter = new OpenAIAdapter('p2', 'gpt-4o', 'foundry.p2.apikey', 3, 500)
    mockCreate.mockResolvedValue(makeResponse('hi'))

    const runPromise = (async () => {
      const events = []
      for await (const ev of delayedAdapter.run(BASE_REQ)) events.push(ev)
      return events
    })()

    await vi.advanceTimersByTimeAsync(600)
    vi.useRealTimers()

    const events = await runPromise
    expect(events.some((e) => e.type === 'done' || e.type === 'error')).toBe(true)
  })
})
