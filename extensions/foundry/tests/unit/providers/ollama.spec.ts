import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { OllamaAdapter } from '../../../src/providers/ollama.js'

const adapter = new OllamaAdapter('p4', 'llama3', 'http://localhost:11434')

const BASE_REQ = {
  mode: 'spec-to-code' as const,
  providerId: 'p4',
  model: 'llama3',
  prompt: 'test prompt',
  workspaceRoot: '/ws',
  agentsMdContent: '',
  iterationLimit: 3,
}

function makeStreamResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => {
        let i = 0
        return {
          read: async () => {
            if (i >= chunks.length) return { done: true, value: undefined }
            return { done: false, value: encoder.encode(chunks[i++]) }
          },
        }
      },
    },
  }
}

beforeEach(() => mockFetch.mockReset())

describe('OllamaAdapter', () => {
  it('supportsStreaming is false', () => {
    expect(adapter.supportsStreaming).toBe(false)
  })

  it('run() yields token events (no agentsMdContent)', async () => {
    const lines = [
      JSON.stringify({ response: 'Hello', done: false }) + '\n',
      JSON.stringify({ response: ' Ollama', done: false }) + '\n',
      JSON.stringify({ response: '', done: true, eval_count: 50, prompt_eval_count: 80 }) + '\n',
    ]
    mockFetch.mockResolvedValueOnce(makeStreamResponse(lines))
    const tokens: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) {
      if (ev.type === 'token') tokens.push(ev.token)
    }
    expect(tokens).toContain('Hello')
    expect(tokens).toContain(' Ollama')
  })

  it('run() prepends agentsMdContent when provided', async () => {
    let capturedBody = ''
    mockFetch.mockImplementationOnce(async (url: string, opts: { body: string }) => {
      capturedBody = opts.body
      return makeStreamResponse([JSON.stringify({ response: 'ok', done: true }) + '\n'])
    })
    for await (const _ of adapter.run({ ...BASE_REQ, agentsMdContent: '# System' })) {
      /* drain */
    }
    const parsed = JSON.parse(capturedBody) as { prompt: string }
    expect(parsed.prompt).toContain('# System')
    expect(parsed.prompt).toContain('test prompt')
  })

  it('run() skips malformed JSON lines gracefully', async () => {
    const lines = ['NOT_JSON\n', JSON.stringify({ response: 'valid', done: true }) + '\n']
    mockFetch.mockResolvedValueOnce(makeStreamResponse(lines))
    const events: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) events.push(ev.type)
    expect(events).toContain('done')
  })

  it('run() yields error when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, body: null })
    const events: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) events.push(ev.type)
    expect(events).toContain('error')
  })

  it('run() yields error on fetch exception', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const events: string[] = []
    for await (const ev of adapter.run(BASE_REQ)) events.push(ev.type)
    expect(events).toContain('error')
  })

  it('testConnection() returns ok when Ollama responds', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ models: [] }) })
    expect((await adapter.testConnection()).ok).toBe(true)
  })

  it('testConnection() returns false when status is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })
    expect((await adapter.testConnection()).ok).toBe(false)
  })

  it('testConnection() returns false on fetch exception', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    expect((await adapter.testConnection()).ok).toBe(false)
  })
})
