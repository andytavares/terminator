import OpenAI from 'openai'
import { retrieveKey } from '../core/keychain.js'
import type { ProviderAdapter, RunRequest, RunEvent } from './adapter.js'

export class OpenAIAdapter implements ProviderAdapter {
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
    const client = new OpenAI({ apiKey, maxRetries: this.maxRetries })
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: request.agentsMdContent || 'You are an expert software engineer.',
      },
      ...(request.conversationHistory ?? []).map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      })),
      { role: 'user', content: request.prompt },
    ]

    try {
      let tokenIn = 0
      let tokenOut = 0
      const stream = await client.chat.completions.create({
        model: request.model || this.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      })

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content
        if (delta) yield { type: 'token', token: delta }
        if (chunk.usage) {
          tokenIn = chunk.usage.prompt_tokens
          tokenOut = chunk.usage.completion_tokens
        }
        if (chunk.choices[0]?.finish_reason === 'stop') {
          yield { type: 'done', tokenCountIn: tokenIn, tokenCountOut: tokenOut }
        }
      }
    } catch (err) {
      yield { type: 'error', message: String(err) }
    }
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number }> {
    const apiKey = await retrieveKey(this.keychainKey)
    if (!apiKey) return { ok: false, latencyMs: 0 }
    const start = Date.now()
    try {
      const client = new OpenAI({ apiKey })
      await client.models.list()
      return { ok: true, latencyMs: Date.now() - start }
    } catch /* v8 ignore next */ {
      return { ok: false, latencyMs: Date.now() - start }
    }
  }
}
