import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { retrieveKey } from '../core/keychain.js'
import type { ProviderAdapter, RunRequest, RunEvent } from './adapter.js'
import type { FileChange } from '../types/foundry.types.js'

// ─── File tools given to the agent ───────────────────────────────────────────

const FILE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read the full contents of a file in the workspace.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Path relative to workspace root' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or completely overwrite a file with new content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path relative to workspace root' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'str_replace',
    description:
      'Replace an exact literal string in a file. The old_str must match exactly (including whitespace).',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path relative to workspace root' },
        old_str: { type: 'string', description: 'Exact string to find and replace' },
        new_str: { type: 'string', description: 'Replacement string' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  {
    name: 'list_files',
    description: 'List files in a directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dir: { type: 'string', description: 'Directory relative to workspace root (default: ".")' },
      },
    },
  },
]

// ─── Tool executor ────────────────────────────────────────────────────────────

interface ToolResult {
  output: string
  event?: RunEvent & { type: 'file-changed' }
}

async function executeTool(
  block: Anthropic.ToolUseBlock,
  workspaceRoot: string
): Promise<ToolResult> {
  const input = block.input as Record<string, string>

  switch (block.name) {
    case 'read_file': {
      try {
        const full = path.resolve(workspaceRoot, input.path)
        const content = await fs.readFile(full, 'utf-8')
        return { output: content }
      } catch (err) {
        return { output: `Error reading file: ${String(err)}` }
      }
    }

    case 'write_file': {
      try {
        const full = path.resolve(workspaceRoot, input.path)
        const existed = await fs
          .access(full)
          .then(() => true)
          .catch(() => false)
        await fs.mkdir(path.dirname(full), { recursive: true })
        await fs.writeFile(full, input.content, 'utf-8')
        const linesAdded = input.content.split('\n').length
        const change: FileChange = {
          filePath: full,
          status: existed ? 'modified' : 'new',
          linesAdded,
          linesRemoved: existed ? 0 : 0,
          unifiedDiff: '',
        }
        return {
          output: `Wrote ${linesAdded} lines to ${input.path}`,
          event: { type: 'file-changed', filePath: full, change },
        }
      } catch (err) {
        return { output: `Error writing file: ${String(err)}` }
      }
    }

    case 'str_replace': {
      try {
        const full = path.resolve(workspaceRoot, input.path)
        const content = await fs.readFile(full, 'utf-8')
        if (!content.includes(input.old_str)) {
          return {
            output: `Error: old_str not found verbatim in ${input.path}. Check whitespace and exact characters.`,
          }
        }
        const newContent = content.replace(input.old_str, input.new_str)
        await fs.writeFile(full, newContent, 'utf-8')
        const linesAdded = input.new_str.split('\n').length
        const linesRemoved = input.old_str.split('\n').length
        const change: FileChange = {
          filePath: full,
          status: 'modified',
          linesAdded,
          linesRemoved,
          unifiedDiff: '',
        }
        return {
          output: `Replaced ${linesRemoved} line(s) → ${linesAdded} line(s) in ${input.path}`,
          event: { type: 'file-changed', filePath: full, change },
        }
      } catch (err) {
        return { output: `Error in str_replace: ${String(err)}` }
      }
    }

    case 'list_files': {
      try {
        const dir = input.dir ?? '.'
        const full = path.resolve(workspaceRoot, dir)
        const entries = await fs.readdir(full, { withFileTypes: true })
        const lines = entries.map((e) =>
          e.isDirectory() ? `[dir]  ${e.name}` : `[file] ${e.name}`
        )
        return { output: lines.join('\n') || '(empty directory)' }
      } catch (err) {
        return { output: `Error listing files: ${String(err)}` }
      }
    }

    default:
      return { output: `Unknown tool: ${block.name}` }
  }
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class ClaudeAdapter implements ProviderAdapter {
  readonly supportsStreaming = true

  constructor(
    private readonly providerId: string,
    private readonly model: string,
    private readonly keychainKey: string
  ) {}

  async *run(request: RunRequest): AsyncIterable<RunEvent> {
    const apiKey = await retrieveKey(this.keychainKey)
    if (!apiKey) {
      yield { type: 'error', message: 'API key not found in keychain. Add it in Harness Settings.' }
      return
    }

    const client = new Anthropic({ apiKey })

    const systemPrompt = [
      "You are an expert software engineer working inside a developer's codebase.",
      request.agentsMdContent
        ? `Follow these project-specific guidelines:\n\n${request.agentsMdContent}`
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
          tools: FILE_TOOLS,
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

            const result = await executeTool(block, request.workspaceRoot)

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
