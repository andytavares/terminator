import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { FileChange } from '../types/foundry.types.js'
import type { RunEvent } from './adapter.js'

// ─── Anthropic tool definitions ───────────────────────────────────────────────

import type Anthropic from '@anthropic-ai/sdk'

export const FILE_TOOLS_ANTHROPIC: Anthropic.Tool[] = [
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

// ─── OpenAI function definitions ──────────────────────────────────────────────

export const FILE_TOOLS_OPENAI = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the full contents of a file in the workspace.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Path relative to workspace root' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: 'Create or completely overwrite a file with new content.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to workspace root' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'str_replace',
      description: 'Replace an exact literal string in a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to workspace root' },
          old_str: { type: 'string', description: 'Exact string to find and replace' },
          new_str: { type: 'string', description: 'Replacement string' },
        },
        required: ['path', 'old_str', 'new_str'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_files',
      description: 'List files in a directory.',
      parameters: {
        type: 'object',
        properties: {
          dir: {
            type: 'string',
            description: 'Directory relative to workspace root (default: ".")',
          },
        },
      },
    },
  },
]

// ─── Gemini function declarations ─────────────────────────────────────────────

export const FILE_TOOLS_GEMINI = {
  functionDeclarations: [
    {
      name: 'read_file',
      description: 'Read the full contents of a file in the workspace.',
      parameters: {
        type: 'OBJECT' as const,
        properties: { path: { type: 'STRING', description: 'Path relative to workspace root' } },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Create or completely overwrite a file with new content.',
      parameters: {
        type: 'OBJECT' as const,
        properties: {
          path: { type: 'STRING', description: 'Path relative to workspace root' },
          content: { type: 'STRING', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'str_replace',
      description: 'Replace an exact literal string in a file.',
      parameters: {
        type: 'OBJECT' as const,
        properties: {
          path: { type: 'STRING', description: 'Path relative to workspace root' },
          old_str: { type: 'STRING', description: 'Exact string to find and replace' },
          new_str: { type: 'STRING', description: 'Replacement string' },
        },
        required: ['path', 'old_str', 'new_str'],
      },
    },
    {
      name: 'list_files',
      description: 'List files in a directory.',
      parameters: {
        type: 'OBJECT' as const,
        properties: {
          dir: {
            type: 'STRING',
            description: 'Directory relative to workspace root (default: ".")',
          },
        },
      },
    },
  ],
}

// ─── Shared tool executor ─────────────────────────────────────────────────────

export interface ToolResult {
  output: string
  event?: RunEvent & { type: 'file-changed' }
}

/**
 * Resolve a tool-supplied path to an absolute path inside workspaceRoot.
 * If Claude provides an absolute path outside the workspace (e.g. the main
 * workspace path when actually running in a worktree), strip the common prefix
 * and re-anchor relative to workspaceRoot so files land in the correct location.
 */
function resolveWorkspacePath(workspaceRoot: string, inputPath: string): string {
  if (!path.isAbsolute(inputPath)) {
    return path.resolve(workspaceRoot, inputPath)
  }
  // Already inside the workspace — use directly
  if (inputPath === workspaceRoot || inputPath.startsWith(workspaceRoot + path.sep)) {
    return inputPath
  }
  // Absolute path outside workspace: find common directory prefix and use the
  // remainder relative to workspaceRoot (handles main-workspace vs worktree mismatch)
  const wsSegs = workspaceRoot.split(path.sep)
  const pathSegs = inputPath.split(path.sep)
  let commonLen = 0
  for (let i = 0; i < Math.min(wsSegs.length, pathSegs.length); i++) {
    if (wsSegs[i] === pathSegs[i]) commonLen = i + 1
    else break
  }
  const relative = pathSegs.slice(commonLen).join(path.sep)
  return path.resolve(workspaceRoot, relative || path.basename(inputPath))
}

export async function executeTool(
  name: string,
  input: Record<string, string>,
  workspaceRoot: string
): Promise<ToolResult> {
  switch (name) {
    case 'read_file': {
      try {
        const full = resolveWorkspacePath(workspaceRoot, input.path)
        const content = await fs.readFile(full, 'utf-8')
        return { output: content }
      } catch (err) {
        return { output: `Error reading file: ${String(err)}` }
      }
    }

    case 'write_file': {
      try {
        const full = resolveWorkspacePath(workspaceRoot, input.path)
        console.log(
          `[foundry:write_file] workspaceRoot=${workspaceRoot} input.path=${input.path} → ${full}`
        )
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
          linesRemoved: 0,
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
        const full = resolveWorkspacePath(workspaceRoot, input.path)
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
        const full = resolveWorkspacePath(workspaceRoot, dir)
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
      return { output: `Unknown tool: ${name}` }
  }
}
