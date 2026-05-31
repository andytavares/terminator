import Anthropic from '@anthropic-ai/sdk'
import { retrieveKey } from '../core/keychain.js'
import type { ProviderAdapter, RunRequest, RunEvent } from './adapter.js'
import { FILE_TOOLS_ANTHROPIC, executeTool } from './tools.js'

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class ClaudeAdapter implements ProviderAdapter {
  readonly supportsStreaming = true

  constructor(
    private readonly providerId: string,
    private readonly model: string,
    private readonly keychainKey: string,
    private readonly maxRetries: number = 4,
    private readonly requestDelayMs: number = 0
  ) {}

  async *run(request: RunRequest): AsyncIterable<RunEvent> {
    const apiKey = await retrieveKey(this.keychainKey)
    if (!apiKey) {
      yield { type: 'error', message: 'API key not found in keychain. Add it in Harness Settings.' }
      return
    }

    if (this.requestDelayMs > 0) await new Promise((r) => setTimeout(r, this.requestDelayMs))
    // maxRetries: SDK automatically retries 429 / 529 with exponential backoff
    const client = new Anthropic({ apiKey, maxRetries: this.maxRetries, timeout: 120_000 })

    const systemPrompt = [
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
      .join('\n\n')

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: request.prompt }]

    let totalIn = 0
    let totalOut = 0

    try {
      // Agentic tool-use loop: keep running until Claude stops calling tools
      while (true) {
        const response = await client.messages.create({
          model: request.model || this.model,
          max_tokens: 8096,
          system: systemPrompt,
          tools: FILE_TOOLS_ANTHROPIC,
          messages,
        })

        totalIn += response.usage.input_tokens
        totalOut += response.usage.output_tokens

        const assistantContent: Anthropic.ContentBlock[] = []
        const toolResults: Anthropic.ToolResultBlockParam[] = []

        for (const block of response.content) {
          assistantContent.push(block)

          if (block.type === 'text' && block.text.trim()) {
            // Yield text line by line so the log updates incrementally
            for (const line of block.text.split('\n')) {
              if (line.trim()) yield { type: 'token', token: line }
            }
          }

          if (block.type === 'tool_use') {
            const toolInput = block.input as Record<string, string>
            // Show what the agent is doing before executing
            yield {
              type: 'token',
              token: `→ ${block.name}(${JSON.stringify(toolInput).slice(0, 80)})`,
            }

            const result = await executeTool(
              block.name,
              block.input as Record<string, string>,
              request.workspaceRoot
            )

            if (result.event) {
              yield result.event
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result.output,
            })
          }
        }

        // If there are tool calls, continue the conversation with their results
        if (response.stop_reason === 'tool_use') {
          messages.push({ role: 'assistant', content: assistantContent })
          messages.push({ role: 'user', content: toolResults })
          continue
        }

        // End turn: done
        break
      }

      yield { type: 'done', tokenCountIn: totalIn, tokenCountOut: totalOut }
    } catch (err) {
      yield { type: 'error', message: String(err) }
    }
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number }> {
    const apiKey = await retrieveKey(this.keychainKey)
    if (!apiKey) return { ok: false, latencyMs: 0 }
    const start = Date.now()
    try {
      const client = new Anthropic({ apiKey })
      await client.models.list()
      return { ok: true, latencyMs: Date.now() - start }
    } catch /* v8 ignore next */ {
      return { ok: false, latencyMs: Date.now() - start }
    }
  }
}
