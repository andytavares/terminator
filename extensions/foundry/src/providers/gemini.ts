import { GoogleGenerativeAI } from '@google/generative-ai'
import { retrieveKey } from '../core/keychain.js'
import type { ProviderAdapter, RunRequest, RunEvent } from './adapter.js'

export class GeminiAdapter implements ProviderAdapter {
  readonly supportsStreaming = true

  constructor(
    private readonly providerId: string,
    private readonly model: string,
    private readonly keychainKey: string,
    private readonly maxRetries: number = 3,
    private readonly requestDelayMs: number = 0
  ) {}

  async *run(request: RunRequest): AsyncIterable<RunEvent> {
    const apiKey = await retrieveKey(this.keychainKey)
    if (!apiKey) {
      yield { type: 'error', message: 'API key not found in keychain' }
      return
    }

    if (this.requestDelayMs > 0) await new Promise((r) => setTimeout(r, this.requestDelayMs))

    // Gemini SDK has no built-in retry — implement simple exponential backoff for 429s
    let attempt = 0
    while (true) {
      try {
        yield* this._stream(request, apiKey)
        return
      } catch (err) {
        const is429 = String(err).includes('429') || String(err).includes('RESOURCE_EXHAUSTED')
        if (!is429 || attempt >= this.maxRetries) throw err
        const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 30_000)
        await new Promise((r) => setTimeout(r, delay))
        attempt++
      }
    }
  }

  async *_stream(request: RunRequest, apiKey: string): AsyncIterable<RunEvent> {
    try {
      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({ model: request.model || this.model })
      const prompt = request.agentsMdContent
        ? `${request.agentsMdContent}\n\n${request.prompt}`
        : request.prompt

      const stream = model.generateContentStream(prompt)
      for await (const chunk of stream) {
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) yield { type: 'token', token: text }
      }

      yield { type: 'done', tokenCountIn: 0, tokenCountOut: 0 }
    } catch (err) {
      yield { type: 'error', message: String(err) }
    }
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number }> {
    const apiKey = await retrieveKey(this.keychainKey)
    if (!apiKey) return { ok: false, latencyMs: 0 }
    const start = Date.now()
    try {
      const genAI = new GoogleGenerativeAI(apiKey)
      genAI.getGenerativeModel({ model: this.model })
      return { ok: true, latencyMs: Date.now() - start }
    } catch /* v8 ignore next */ {
      return { ok: false, latencyMs: Date.now() - start }
    }
  }
}
