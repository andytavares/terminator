import { describe, it, expect, vi } from 'vitest'

const mockSendMessage = vi.fn()
const mockStartChat = vi.fn(() => ({ sendMessage: mockSendMessage }))
const mockGetGenerativeModel = vi.fn(() => ({
  startChat: mockStartChat,
}))

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = mockGetGenerativeModel
  },
}))

vi.mock('../../../src/core/keychain.js', () => ({
  retrieveKey: vi.fn(async () => 'gemini-key'),
}))

vi.mock('../../../src/providers/tools.js', () => ({
  FILE_TOOLS_GEMINI: { functionDeclarations: [] },
  executeTool: vi.fn(async () => ({ output: 'ok' })),
}))

import { GeminiAdapter } from '../../../src/providers/gemini.js'
import { retrieveKey as _rk } from '../../../src/core/keychain.js'
const mockRetrieveKey = vi.mocked(_rk)

const adapter = new GeminiAdapter('p3', 'gemini-1.5-pro', 'foundry.p3.apikey')

const BASE_REQ = {
  mode: 'spec-to-code' as const,
  providerId: 'p3',
  model: 'gemini-1.5-pro',
  prompt: 'test prompt',
  workspaceRoot: '/ws',
  agentsMdContent: '',
  iterationLimit: 3,
}

// Helper: response with text only (no function calls)
function makeTextResponse(text: string) {
  return {
    response: {
      candidates: [{ content: { parts: [{ text }] } }],
      text: () => text,
    },
  }
}

describe('GeminiAdapter', () => {
  it('supportsStreaming is true', () => {
    expect(adapter.supportsStreaming).toBe(true)
  })

  it('run() yields token events (no agentsMdContent)', async () => {
    mockSendMessage.mockResolvedValueOnce(makeTextResponse('Hello Gemini'))
    const tokens: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) {
      if (ev.type === 'token') tokens.push(ev.token)
    }
    expect(tokens.join('')).toContain('Hello Gemini')
  })

  it('run() passes agentsMdContent as systemInstruction', async () => {
    mockSendMessage.mockResolvedValueOnce(makeTextResponse('ok'))
    for await (const _ of adapter.run({ ...BASE_REQ, agentsMdContent: '# Guidelines' })) {
      /* drain */
    }
    // getGenerativeModel receives the systemInstruction option
    const callOpts = mockGetGenerativeModel.mock.calls.at(-1)?.[0] as { systemInstruction?: string }
    expect(callOpts?.systemInstruction).toContain('# Guidelines')
  })

  it('run() yields done event', async () => {
    mockSendMessage.mockResolvedValueOnce(makeTextResponse('Hi'))
    let hasDone = false
    for await (const ev of adapter.run(BASE_REQ)) {
      if (ev.type === 'done') hasDone = true
    }
    expect(hasDone).toBe(true)
  })

  it('run() yields error when API key is missing', async () => {
    mockRetrieveKey.mockResolvedValueOnce(null)
    const events: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) events.push(ev.type)
    expect(events).toContain('error')
  })

  it('run() retries on 429 and succeeds on second attempt', async () => {
    vi.useFakeTimers()
    // First call throws a 429; second call succeeds
    mockSendMessage
      .mockRejectedValueOnce(new Error('429 RESOURCE_EXHAUSTED'))
      .mockResolvedValueOnce(makeTextResponse('ok after retry'))

    const tokens: string[] = []
    const events: string[] = []

    const runIter = adapter.run(BASE_REQ)[Symbol.asyncIterator]()

    // Start consuming — will pause at the retry delay
    const firstP = runIter.next()
    // Advance clock past retry delay
    await vi.advanceTimersByTimeAsync(2000)
    vi.useRealTimers()

    // Collect all remaining events
    let result = await firstP
    while (!result.done) {
      const ev = result.value
      events.push(ev.type)
      if (ev.type === 'token') tokens.push(ev.token)
      result = await runIter.next()
    }

    expect(tokens.join('')).toContain('ok after retry')
  })

  it('run() yields error when API throws', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('Quota exceeded'))
    const events: Array<{ type: string; message?: string }> = []
    for await (const ev of adapter.run(BASE_REQ))
      events.push(ev as { type: string; message?: string })
    const err = events.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect(err?.message).toContain('Quota exceeded')
  })

  it('run() executes function calls and continues', async () => {
    const { executeTool } = await import('../../../src/providers/tools.js')
    vi.mocked(executeTool).mockResolvedValueOnce({ output: 'file contents' })

    // First sendMessage: has a functionCall part; second: plain text (after fnResponse)
    mockSendMessage
      .mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: 'read_file', args: { path: 'x.ts' } } }],
              },
            },
          ],
          text: () => '',
        },
      })
      .mockResolvedValueOnce({
        response: { text: () => 'Function result handled' },
      })

    const tokens: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) {
      if (ev.type === 'token') tokens.push(ev.token)
    }
    // The second call (fnResponse reply) text is emitted
    expect(tokens.join('')).toContain('Function result handled')
  })

  it('run() passes conversationHistory to chat', async () => {
    mockSendMessage.mockResolvedValueOnce(makeTextResponse('ok'))
    const history = [
      { id: '1', role: 'user' as const, content: 'hello', timestamp: '' },
      { id: '2', role: 'agent' as const, content: 'hi', timestamp: '' },
    ]
    for await (const _ of adapter.run({ ...BASE_REQ, conversationHistory: history })) {
      /* drain */
    }
    // startChat should have been called with a history array
    expect(mockStartChat).toHaveBeenCalledWith(
      expect.objectContaining({
        history: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
      })
    )
  })

  it('testConnection() returns ok', async () => {
    const result = await adapter.testConnection()
    expect(result.ok).toBe(true)
    expect(typeof result.latencyMs).toBe('number')
  })

  it('testConnection() returns false when key is missing', async () => {
    mockRetrieveKey.mockResolvedValueOnce(null)
    expect((await adapter.testConnection()).ok).toBe(false)
  })

  it('testConnection() returns false when getGenerativeModel throws', async () => {
    mockGetGenerativeModel.mockImplementationOnce(() => {
      throw new Error('invalid model')
    })
    const result = await adapter.testConnection()
    expect(result.ok).toBe(false)
  })
})
