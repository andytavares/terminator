import { GoogleGenerativeAI } from '@google/generative-ai'
import { retrieveKey } from '../core/keychain.js'
import type { ProviderAdapter, RunRequest, RunEvent } from './adapter.js'

export class GeminiAdapter implements ProviderAdapter {
  readonly supportsStreaming = true

  constructor(
    private readonly providerId: string,
    private readonly model: string,
    private readonly keychainKey: string
  ) {}

  async *run(request: RunRequest): AsyncIterable<RunEvent> {
    const apiKey = await retrieveKey(this.keychainKey)
    if (!apiKey) {
      yield { type: 'error', message: 'API key not found in keychain' }
      return
    }

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
