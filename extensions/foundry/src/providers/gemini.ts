import { GoogleGenerativeAI } from '@google/generative-ai'
import { retrieveKey } from '../core/keychain.js'
import type { ProviderAdapter, RunRequest, RunEvent } from './adapter.js'
import { FILE_TOOLS_GEMINI, executeTool } from './tools.js'

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

    let attempt = 0
    while (true) {
      try {
        yield* this._run(request, apiKey)
        return
      } catch (err) {
        const is429 = String(err).includes('429') || String(err).includes('RESOURCE_EXHAUSTED')
        if (!is429 || attempt >= this.maxRetries) {
          yield { type: 'error', message: String(err) }
          return
        }
        const delay = Math.min(1000 * 2 ** attempt + Math.random() * 500, 30_000)
        await new Promise((r) => setTimeout(r, delay))
        attempt++
      }
    }
  }

  // _run does NOT catch errors — let them propagate to run() so retry logic works
  async *_run(request: RunRequest, apiKey: string): AsyncIterable<RunEvent> {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: request.model || this.model,
      tools: [FILE_TOOLS_GEMINI],
      systemInstruction: [
        "You are an expert software engineer working inside a developer's codebase.",
        request.agentsMdContent
          ? `Follow these project-specific guidelines:\n\n${request.agentsMdContent}`
          : '',
        request.workspaceListing
          ? `Current workspace file tree:\n\`\`\`\n${request.workspaceListing}\n\`\`\`\nWrite files at the correct location relative to this structure. Do not create unnecessary top-level subdirectories — place files where they belong given the existing layout.`
          : '',
        'Use the provided file tools to read existing code before making changes.',
        'After completing your work, write a short summary of what you changed and why.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    })

    const history = (request.conversationHistory ?? []).map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('model' as const),
      parts: [{ text: m.content }],
    }))

    const chat = model.startChat({ history })

    // Agentic tool-use loop
    while (true) {
      const result = await chat.sendMessage(request.prompt)
      const response = result.response

      const parts = response.candidates?.[0]?.content?.parts ?? []
      const textParts = parts.filter((p) => p.text)
      const fnParts = parts.filter((p) => p.functionCall)

      for (const p of textParts) {
        if (p.text?.trim()) {
          for (const line of p.text.split('\n')) {
            if (line.trim()) yield { type: 'token', token: line }
          }
        }
      }

      if (fnParts.length === 0) break

      // Execute function calls and send results back
      const fnResponses = []
      for (const p of fnParts) {
        const fn = p.functionCall!
        const input = (fn.args ?? {}) as Record<string, string>
        yield {
          type: 'token',
          token: `→ ${fn.name}(${JSON.stringify(input).slice(0, 80)})`,
        }
        const toolResult = await executeTool(fn.name, input, request.workspaceRoot)
        if (toolResult.event) yield toolResult.event
        fnResponses.push({
          functionResponse: { name: fn.name, response: { output: toolResult.output } },
        })
      }

      // Send function responses back — Gemini expects a message with function response parts
      const fnResult = await chat.sendMessage(fnResponses)
      const fnText = fnResult.response.text()
      if (fnText?.trim()) {
        for (const line of fnText.split('\n')) {
          if (line.trim()) yield { type: 'token', token: line }
        }
      }

      // After function response, no more function calls expected in this turn
      break
    }

    yield { type: 'done', tokenCountIn: 0, tokenCountOut: 0 }
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
