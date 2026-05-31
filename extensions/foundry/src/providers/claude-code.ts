/* v8 ignore file */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProviderAdapter, RunRequest, RunEvent } from './adapter.js'
import type { FileChange } from '../types/foundry.types.js'

const execFileAsync = promisify(execFile)

// ── PATH augmentation ─────────────────────────────────────────────────────────
// Electron's main process inherits a minimal PATH that excludes /usr/local/bin,
// Homebrew, and user-local installs. Augment it so child process spawns work.

const EXTRA_DIRS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  path.join(process.env.HOME ?? '', '.local', 'bin'),
  path.join(process.env.HOME ?? '', '.claude', 'local'),
  path.join(process.env.HOME ?? '', 'bin'),
]

export const augmentedEnv: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: [...EXTRA_DIRS, process.env.PATH ?? ''].filter(Boolean).join(':'),
}

// ── Find claude binary ─────────────────────────────────────────────────────────

async function findClaudeBin(): Promise<string | null> {
  // Check well-known absolute paths first (no PATH lookup needed)
  const knownPaths = [
    path.join(process.env.HOME ?? '', '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    path.join(process.env.HOME ?? '', '.local', 'bin', 'claude'),
    path.join(process.env.HOME ?? '', 'bin', 'claude'),
  ]
  for (const p of knownPaths) {
    try {
      await fs.access(p, fs.constants.X_OK)
      return p
    } catch {
      continue
    }
  }

  // Fall back to `which` with augmented PATH
  try {
    const { stdout } = await execFileAsync('which', ['claude'], { env: augmentedEnv })
    const p = stdout.trim()
    if (p) return p
  } catch {
    /* not found */
  }

  return null
}

// ── Git-based file change detection ───────────────────────────────────────────

async function detectFileChanges(cwd: string): Promise<FileChange[]> {
  try {
    const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd,
      env: augmentedEnv,
    })
    const changes: FileChange[] = []

    for (const line of statusOut.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const code = line.slice(0, 2).trim()
      const relPath = line
        .slice(3)
        .trim()
        .replace(/^"(.*)"$/, '$1') // strip git quoting
      const absPath = path.join(cwd, relPath)

      const status: FileChange['status'] =
        code === '?' || code === 'A' ? 'new' : code === 'D' ? 'deleted' : 'modified'

      let unifiedDiff = ''
      let linesAdded = 0
      let linesRemoved = 0

      try {
        if (status === 'new') {
          // Untracked or new — diff against /dev/null
          const { stdout } = await execFileAsync(
            'git',
            ['diff', '--no-index', '--', '/dev/null', absPath],
            { cwd, env: augmentedEnv }
          ).catch((e: { stdout: string }) => ({ stdout: e.stdout ?? '' }))
          unifiedDiff = stdout
          linesAdded = unifiedDiff.split('\n').filter((l) => l.startsWith('+')).length
        } else if (status !== 'deleted') {
          const { stdout } = await execFileAsync('git', ['diff', 'HEAD', '--', relPath], {
            cwd,
            env: augmentedEnv,
          })
          unifiedDiff = stdout
          linesAdded = unifiedDiff
            .split('\n')
            .filter((l) => l.startsWith('+') && !l.startsWith('+++')).length
          linesRemoved = unifiedDiff
            .split('\n')
            .filter((l) => l.startsWith('-') && !l.startsWith('---')).length
        }
      } catch {
        /* diff may fail for binary files */
      }

      changes.push({ filePath: absPath, status, linesAdded, linesRemoved, unifiedDiff })
    }

    return changes
  } catch {
    return []
  }
}

// ── Stream-json parsing ────────────────────────────────────────────────────────

interface AssistantBlock {
  type: string
  text?: string
  name?: string
  input?: Record<string, unknown>
}

interface StreamMessage {
  type: string
  subtype?: string
  message?: {
    content?: AssistantBlock[]
    usage?: { input_tokens: number; output_tokens: number }
  }
  result?: string
  is_error?: boolean
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly supportsStreaming = true

  constructor(
    private readonly providerId: string,
    private readonly model: string = ''
  ) {}

  async testConnection(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now()
    const bin = await findClaudeBin()
    if (!bin) return { ok: false, latencyMs: Date.now() - start }
    return new Promise((resolve) => {
      const proc = spawn(bin, ['--version'], { env: augmentedEnv })
      proc.on('close', (code) => resolve({ ok: code === 0, latencyMs: Date.now() - start }))
      proc.on('error', () => resolve({ ok: false, latencyMs: Date.now() - start }))
    })
  }

  async *run(request: RunRequest): AsyncIterable<RunEvent> {
    const bin = await findClaudeBin()
    if (!bin) {
      yield {
        type: 'error',
        message:
          'claude CLI not found. Install Claude Code (https://claude.ai/code) and make sure it is in your PATH.',
      }
      return
    }

    // Build prompt — prepend AGENTS.md + workspace listing as system context
    const contextParts: string[] = []
    if (request.agentsMdContent) contextParts.push(request.agentsMdContent)
    if (request.workspaceListing) {
      contextParts.push(
        `Current workspace file tree:\n\`\`\`\n${request.workspaceListing}\n\`\`\`\nWrite files at the correct path relative to this structure.`
      )
    }
    const fullPrompt =
      contextParts.length > 0
        ? `${contextParts.join('\n\n')}\n\n---\n\n${request.prompt}`
        : request.prompt

    const args = [
      '-p',
      fullPrompt,
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions', // bypass all permission prompts, allow all tools
    ]
    if (this.model) args.push('--model', this.model)

    // Async queue: producer (process events) → consumer (generator yields)
    const queue: RunEvent[] = []
    let procDone = false
    let resolveWaiter: (() => void) | null = null
    let processError: string | null = null

    function push(event: RunEvent) {
      queue.push(event)
      if (resolveWaiter) {
        resolveWaiter()
        resolveWaiter = null
      }
    }

    let tokenIn = 0
    let tokenOut = 0

    function parseLine(line: string) {
      if (!line.trim()) return
      let msg: StreamMessage
      try {
        msg = JSON.parse(line) as StreamMessage
      } catch {
        return // non-JSON (progress/status lines) — skip
      }

      if (msg.type === 'assistant' && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text?.trim()) {
            for (const ln of block.text.split('\n')) {
              if (ln.trim()) push({ type: 'token', token: ln })
            }
          }
          if (block.type === 'tool_use' && block.name) {
            const inp = block.input ?? {}
            const fp =
              (inp.file_path as string) ??
              (inp.path as string) ??
              (inp.command as string) ??
              (Object.values(inp)[0] as string) ??
              ''
            push({ type: 'token', token: `→ ${block.name}(${String(fp).slice(0, 80)})` })
          }
        }
        if (msg.message.usage) {
          tokenIn += msg.message.usage.input_tokens
          tokenOut += msg.message.usage.output_tokens
        }
      }

      if (msg.type === 'result') {
        if (msg.is_error) processError = msg.result ?? 'claude CLI returned an error'
      }
    }

    const proc = spawn(bin, args, {
      cwd: request.workspaceRoot,
      env: augmentedEnv,
      // Close stdin so the CLI never blocks waiting for interactive input
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
    const timeout = setTimeout(() => {
      if (!procDone) {
        proc.kill('SIGTERM')
        processError = 'claude CLI timed out after 10 minutes'
        procDone = true
        if (resolveWaiter) {
          resolveWaiter()
          resolveWaiter = null
        }
      }
    }, TIMEOUT_MS)

    let buf = ''
    let stderrBuf = ''

    proc.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) parseLine(line)
    })

    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString()
    })

    proc.on('close', (code) => {
      clearTimeout(timeout)
      if (buf.trim()) parseLine(buf)
      if (code !== 0 && code !== null && !processError) {
        const detail = stderrBuf.trim() ? stderrBuf.trim().slice(0, 300) : `exit code ${code}`
        processError = `claude exited with error: ${detail}`
      }
      procDone = true
      if (resolveWaiter) {
        resolveWaiter()
        resolveWaiter = null
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      processError = `Failed to spawn claude: ${err.message}`
      procDone = true
      if (resolveWaiter) {
        resolveWaiter()
        resolveWaiter = null
      }
    })

    // Drain the queue until process exits and queue is empty
    while (!procDone || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          resolveWaiter = resolve
        })
      }
      while (queue.length > 0) yield queue.shift()!
    }

    if (processError) {
      const detail = stderrBuf ? `\n${stderrBuf.slice(0, 300)}` : ''
      yield { type: 'error', message: processError + detail }
      return
    }

    // Detect file changes via git status — more reliable than parsing tool events
    const changes = await detectFileChanges(request.workspaceRoot)
    for (const change of changes) {
      yield { type: 'file-changed', filePath: change.filePath, change }
    }

    yield { type: 'done', tokenCountIn: tokenIn, tokenCountOut: tokenOut }
  }
}
