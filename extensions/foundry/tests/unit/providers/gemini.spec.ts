import { describe, it, expect, vi } from 'vitest'

const mockGenerateStream = vi.fn()

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel = vi.fn(() => ({
      generateContentStream: mockGenerateStream,
    }))
  },
}))

vi.mock('../../../src/core/keychain.js', () => ({
  retrieveKey: vi.fn(async () => 'gemini-key'),
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

function makeStream(...texts: string[]) {
  return async function* () {
    for (const text of texts) {
      yield { candidates: [{ content: { parts: [{ text }] } }] }
    }
  }
}

describe('GeminiAdapter', () => {
  it('supportsStreaming is true', () => {
    expect(adapter.supportsStreaming).toBe(true)
  })

  it('run() yields token events (no agentsMdContent)', async () => {
    mockGenerateStream.mockImplementation(makeStream('Hello', ' Gemini'))
    const tokens: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) {
      if (ev.type === 'token') tokens.push(ev.token)
    }
    expect(tokens).toContain('Hello')
    expect(tokens).toContain(' Gemini')
  })

  it('run() prepends agentsMdContent when provided', async () => {
    let receivedPrompt = ''
    mockGenerateStream.mockImplementation(async function* (p: string) {
      receivedPrompt = p
      yield { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }
    })
    await (adapter.run({ ...BASE_REQ, agentsMdContent: '# Guidelines' }) as AsyncIterable<unknown>)
      [Symbol.asyncIterator]()
      .next()
    for await (const _ of adapter.run({ ...BASE_REQ, agentsMdContent: '# Guidelines' })) {
      break
    }
    expect(receivedPrompt).toContain('# Guidelines')
    expect(receivedPrompt).toContain('test prompt')
  })

  it('run() yields done event', async () => {
    mockGenerateStream.mockImplementation(makeStream('Hi'))
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

  it('run() yields error when API throws', async () => {
    mockGenerateStream.mockImplementation(() => {
      throw new Error('Quota exceeded')
    })
    const events: Array<{ type: string; message?: string }> = []
    for await (const ev of adapter.run(BASE_REQ))
      events.push(ev as { type: string; message?: string })
    const err = events.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect(err?.message).toContain('Quota exceeded')
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
})
