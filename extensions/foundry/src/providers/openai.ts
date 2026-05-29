import OpenAI from 'openai'
import { retrieveKey } from '../core/keychain.js'
import type { ProviderAdapter, RunRequest, RunEvent } from './adapter.js'
import { FILE_TOOLS_OPENAI, executeTool } from './tools.js'

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

    const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
      role: 'system',
      content: [
        "You are an expert software engineer working inside a developer's codebase.",
        request.agentsMdContent
          ? `Follow these project-specific guidelines:\n\n${request.agentsMdContent}`
          : '',
        'Use the provided file tools to read existing code before making changes.',
        'After completing your work, write a short summary of what you changed and why.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      systemMessage,
      ...(request.conversationHistory ?? []).map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      })),
      { role: 'user', content: request.prompt },
    ]

    let tokenIn = 0
    let tokenOut = 0

    try {
      // Agentic tool-use loop
      while (true) {
        const response = await client.chat.completions.create({
          model: request.model || this.model,
          messages,
          tools: FILE_TOOLS_OPENAI,
          tool_choice: 'auto',
        })

        const choice = response.choices[0]
        if (!choice) break

        tokenIn += response.usage?.prompt_tokens ?? 0
        tokenOut += response.usage?.completion_tokens ?? 0

        const msg = choice.message

        if (msg.content?.trim()) {
          for (const line of msg.content.split('\n')) {
            if (line.trim()) yield { type: 'token', token: line }
          }
        }

        const toolCalls = msg.tool_calls
        if (!toolCalls || toolCalls.length === 0) break

        // Execute tool calls and collect results
        const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = []
        for (const call of toolCalls) {
          let input: Record<string, string> = {}
          try {
            input = JSON.parse(call.function.arguments) as Record<string, string>
          } catch {
            // malformed args — proceed with empty input
          }

          yield {
            type: 'token',
            token: `→ ${call.function.name}(${call.function.arguments.slice(0, 80)})`,
          }

          const result = await executeTool(call.function.name, input, request.workspaceRoot)
          if (result.event) yield result.event

          toolResults.push({
            role: 'tool',
            tool_call_id: call.id,
            content: result.output,
          })
        }

        messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: toolCalls })
        messages.push(...toolResults)
      }

      yield { type: 'done', tokenCountIn: tokenIn, tokenCountOut: tokenOut }
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
