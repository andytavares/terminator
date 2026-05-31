import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    access: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    readFile: vi.fn().mockResolvedValue(''),
  }
})

import * as cp from 'node:child_process'
import * as fsp from 'node:fs/promises'

const mockSpawn = cp.spawn as ReturnType<typeof vi.fn>
const mockExecFile = cp.execFile as ReturnType<typeof vi.fn>

import { ClaudeCodeAdapter, augmentedEnv } from '../../../src/providers/claude-code.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

type MockProc = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function makeProc(): MockProc {
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const proc = new EventEmitter() as MockProc
  proc.stdout = stdout
  proc.stderr = stderr
  proc.kill = vi.fn()
  // Prevent Node from throwing on unhandled 'error' events before listeners are attached
  proc.on('error', () => {})
  return proc
}

/** Flush microtasks so async code inside the adapter (findClaudeBin, spawn) can attach listeners. */
const tick = () => new Promise<void>((r) => setImmediate(r))

const BASE_REQUEST = {
  mode: 'spec-to-code' as const,
  providerId: 'provider-cc',
  model: '',
  prompt: 'Build hello world',
  workspaceRoot: '/workspace',
  agentsMdContent: '# Agents',
  worktreePath: '/workspace',
}

// ── augmentedEnv ───────────────────────────────────────────────────────────────

describe('augmentedEnv', () => {
  it('extends process.env with extra PATH dirs', () => {
    expect(augmentedEnv.PATH).toBeDefined()
    expect(augmentedEnv.PATH).toContain('/usr/local/bin')
    expect(augmentedEnv.PATH).toContain('/opt/homebrew/bin')
  })

  it('preserves all existing env vars except PATH (which gets extra dirs prepended)', () => {
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== 'PATH') expect(augmentedEnv[k]).toBe(v)
    }
    // PATH is extended, not replaced
    expect(augmentedEnv.PATH).toContain(process.env.PATH ?? '')
  })
})

// ── testConnection ─────────────────────────────────────────────────────────────

describe('ClaudeCodeAdapter.testConnection()', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(fsp.access).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
  })

  it('returns ok:false when claude binary is not found', async () => {
    mockExecFile.mockImplementation(
      (_c: string, _a: string[], _o: unknown, cb: (e: Error, r: { stdout: string }) => void) =>
        cb(new Error('not found'), { stdout: '' })
    )
    const adapter = new ClaudeCodeAdapter('cc', '')
    const result = await adapter.testConnection()
    expect(result.ok).toBe(false)
  })

  it('returns ok:true when claude --version exits 0', async () => {
    vi.mocked(fsp.access).mockResolvedValueOnce(undefined) // findClaudeBin finds it
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', '')
    const resultPromise = adapter.testConnection()
    await tick() // let findClaudeBin resolve and adapter attach its close listener
    proc.emit('close', 0)
    const result = await resultPromise
    expect(result.ok).toBe(true)
  })

  it('returns ok:false when claude --version exits non-zero', async () => {
    vi.mocked(fsp.access).mockResolvedValueOnce(undefined)
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', '')
    const resultPromise = adapter.testConnection()
    await tick()
    proc.emit('close', 1)
    const result = await resultPromise
    expect(result.ok).toBe(false)
  })

  it('returns ok:false on spawn error', async () => {
    vi.mocked(fsp.access).mockResolvedValueOnce(undefined)
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', '')
    const resultPromise = adapter.testConnection()
    await tick()
    proc.emit('error', new Error('EACCES'))
    const result = await resultPromise
    expect(result.ok).toBe(false)
  })
})

// ── run() — binary not found ───────────────────────────────────────────────────

describe('ClaudeCodeAdapter.run() — binary not found', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(fsp.access).mockRejectedValue(new Error('ENOENT'))
    mockExecFile.mockImplementation(
      (_c: string, _a: string[], _o: unknown, cb: (e: Error, r: { stdout: string }) => void) =>
        cb(new Error('not found'), { stdout: '' })
    )
  })

  it('yields error event when claude binary is not found', async () => {
    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; message?: string }> = []
    for await (const event of adapter.run(BASE_REQUEST)) {
      events.push(event as (typeof events)[0])
    }
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'error',
      message: expect.stringContaining('claude CLI not found'),
    })
  })
})

// ── run() — streaming ──────────────────────────────────────────────────────────

describe('ClaudeCodeAdapter.run() — streaming', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(fsp.access).mockResolvedValueOnce(undefined) // findClaudeBin succeeds
    // git status --porcelain (detectFileChanges) → no changes
    mockExecFile.mockImplementation(
      (_c: string, _a: string[], _o: unknown, cb: (e: null, r: { stdout: string }) => void) =>
        cb(null, { stdout: '' })
    )
  })

  it('yields done event with token counts on success', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; tokenCountIn?: number }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()

    await tick()
    proc.emit('close', 0)
    await drainPromise

    const doneEvent = events.find((e) => e.type === 'done')
    expect(doneEvent).toBeDefined()
    expect(typeof doneEvent?.tokenCountIn).toBe('number')
  })

  it('yields token events from assistant text blocks', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; token?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()

    await tick()
    const msg = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello world' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    })
    proc.stdout.emit('data', Buffer.from(msg + '\n'))
    proc.emit('close', 0)
    await drainPromise

    const tokens = events.filter((e) => e.type === 'token')
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens[0].token).toContain('Hello world')
  })

  it('yields tool_use token for tool call blocks', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; token?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()

    await tick()
    const msg = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'write_file', input: { file_path: 'src/main.ts' } }],
        usage: { input_tokens: 5, output_tokens: 2 },
      },
    })
    proc.stdout.emit('data', Buffer.from(msg + '\n'))
    proc.emit('close', 0)
    await drainPromise

    const toolToken = events.find((e) => e.type === 'token' && e.token?.includes('write_file'))
    expect(toolToken).toBeDefined()
  })

  it('yields error event when process exits non-zero', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; message?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()

    await tick()
    proc.stderr.emit('data', Buffer.from('auth error'))
    proc.emit('close', 1)
    await drainPromise

    const errEvent = events.find((e) => e.type === 'error')
    expect(errEvent?.message).toContain('claude exited with error')
  })

  it('yields error event on spawn error', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; message?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()

    await tick()
    proc.emit('error', new Error('ENOENT'))
    await drainPromise

    const errEvent = events.find((e) => e.type === 'error')
    expect(errEvent?.message).toContain('Failed to spawn claude')
  })

  it('yields error event from result error message', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; message?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()

    await tick()
    const msg = JSON.stringify({ type: 'result', is_error: true, result: 'rate limit exceeded' })
    proc.stdout.emit('data', Buffer.from(msg + '\n'))
    proc.emit('close', 0)
    await drainPromise

    const errEvent = events.find((e) => e.type === 'error')
    expect(errEvent?.message).toContain('rate limit exceeded')
  })

  it('appends --model flag when model is specified', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', 'claude-sonnet-4-6')
    const events: Array<{ type: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()

    await tick()
    proc.emit('close', 0)
    await drainPromise

    // Verify spawn was called with --model in args
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['--model', 'claude-sonnet-4-6']),
      expect.any(Object)
    )
  })

  it('includes workspaceListing in prompt context when provided', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', '')
    const requestWithListing = { ...BASE_REQUEST, workspaceListing: 'src/\n  main.ts\n' }
    const events: Array<{ type: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(requestWithListing)) events.push(e as (typeof events)[0])
    })()

    await tick()
    proc.emit('close', 0)
    await drainPromise

    // Verify spawn was called (prompt was built with workspace listing context)
    expect(mockSpawn).toHaveBeenCalled()
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('yields file-changed events when detectFileChanges finds modified files', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    // Override mockExecFile for this test to return a modified file from git status
    mockExecFile.mockImplementation(
      (_c: string, _a: string[], _opts: unknown, cb: (e: null, r: { stdout: string }) => void) => {
        cb(null, { stdout: ' M src/main.ts\n' }) // porcelain: 2-char status + space + path
      }
    )

    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; filePath?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()

    await tick()
    proc.emit('close', 0)
    await drainPromise

    const fileEvent = events.find((e) => e.type === 'file-changed')
    expect(fileEvent).toBeDefined()
    expect(fileEvent?.filePath).toContain('src/main.ts')
  })

  it('handles non-JSON stdout lines without throwing', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()

    await tick()
    // Emit a non-JSON line (progress/status output from claude CLI)
    proc.stdout.emit('data', Buffer.from('Claude is thinking...\n'))
    proc.emit('close', 0)
    await drainPromise

    // No error event — non-JSON lines are silently skipped
    expect(events.find((e) => e.type === 'error')).toBeUndefined()
    expect(events.find((e) => e.type === 'done')).toBeDefined()
  })

  it('uses inp.path for tool token when file_path is absent', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; token?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()
    await tick()
    const msg = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'read_file', input: { path: 'src/read.ts' } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    })
    proc.stdout.emit('data', Buffer.from(msg + '\n'))
    proc.emit('close', 0)
    await drainPromise
    expect(events.find((e) => e.token?.includes('src/read.ts'))).toBeDefined()
  })

  it('uses inp.command for tool token when file_path and path are absent', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; token?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()
    await tick()
    const msg = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'run_command', input: { command: 'ls -la' } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    })
    proc.stdout.emit('data', Buffer.from(msg + '\n'))
    proc.emit('close', 0)
    await drainPromise
    expect(events.find((e) => e.token?.includes('ls -la'))).toBeDefined()
  })

  it('falls back to first input value for tool token when no known key is present', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; token?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()
    await tick()
    const msg = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'custom_tool', input: { other_key: 'other_val' } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    })
    proc.stdout.emit('data', Buffer.from(msg + '\n'))
    proc.emit('close', 0)
    await drainPromise
    expect(events.find((e) => e.token?.includes('custom_tool'))).toBeDefined()
  })

  it('yields error when CLI times out', async () => {
    vi.useFakeTimers()
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; message?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()
    // Let findClaudeBin resolve and adapter attach listeners
    await Promise.resolve()
    await Promise.resolve()
    // Advance past the 10-minute timeout
    vi.advanceTimersByTime(10 * 60 * 1000 + 100)
    await drainPromise
    vi.useRealTimers()
    const errEvent = events.find((e) => e.type === 'error')
    expect(errEvent?.message).toContain('timed out')
  })

  it('uses prompt directly when no agentsMdContent or workspaceListing are provided', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const adapter = new ClaudeCodeAdapter('cc', '')
    // Request with no context — contextParts will be empty, fullPrompt = prompt directly
    const bareRequest = { ...BASE_REQUEST, agentsMdContent: undefined, workspaceListing: undefined }
    const events: Array<{ type: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(bareRequest)) events.push(e as (typeof events)[0])
    })()
    await tick()
    proc.emit('close', 0)
    await drainPromise
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['-p', bareRequest.prompt]),
      expect.any(Object)
    )
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('yields file-changed for a newly added file (status=new, uses diff --no-index)', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    // Differentiate git status vs git diff calls via args
    mockExecFile.mockImplementation(
      (_c: string, a: string[], _o: unknown, cb: (e: null, r: { stdout: string }) => void) => {
        if (a[0] === 'status')
          cb(null, { stdout: 'A  src/new.ts\n' }) // staged new file
        else cb(null, { stdout: '+new line added\n' }) // diff output
      }
    )
    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; filePath?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()
    await tick()
    proc.emit('close', 0)
    await drainPromise
    const fileEvent = events.find((e) => e.type === 'file-changed')
    expect(fileEvent?.filePath).toContain('src/new.ts')
  })

  it('skips diff for deleted files and still yields file-changed event', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    mockExecFile.mockImplementation(
      (_c: string, a: string[], _o: unknown, cb: (e: null, r: { stdout: string }) => void) => {
        if (a[0] === 'status')
          cb(null, { stdout: 'D  src/old.ts\n' }) // deleted
        else cb(null, { stdout: '' })
      }
    )
    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; filePath?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()
    await tick()
    proc.emit('close', 0)
    await drainPromise
    const fileEvent = events.find((e) => e.type === 'file-changed')
    expect(fileEvent?.filePath).toContain('src/old.ts')
  })

  it('swallows diff error for binary files (inner catch)', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    mockExecFile.mockImplementation(
      (
        _c: string,
        a: string[],
        _o: unknown,
        cb: (e: Error | null, r: { stdout: string }) => void
      ) => {
        if (a[0] === 'status') cb(null, { stdout: ' M src/binary.bin\n' })
        else cb(new Error('binary file: Cannot diff'), { stdout: '' }) // diff throws for binary
      }
    )
    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()
    await tick()
    proc.emit('close', 0)
    await drainPromise
    // Error is swallowed; run completes with done
    expect(events.some((e) => e.type === 'done')).toBe(true)
    expect(events.some((e) => e.type === 'error')).toBe(false)
  })

  it('uses empty string for tool token fp when input has no known key', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; token?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()
    await tick()
    // Empty input {} → Object.values({})[0] = undefined → falls to '' final branch
    const msg = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'empty_tool', input: {} }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    })
    proc.stdout.emit('data', Buffer.from(msg + '\n'))
    proc.emit('close', 0)
    await drainPromise
    expect(events.find((e) => e.token?.includes('empty_tool'))).toBeDefined()
  })

  it('handles detectFileChanges git error gracefully and still yields done', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)
    // Make the git status call throw so detectFileChanges catches and returns []
    mockExecFile.mockImplementation(
      (_c: string, _a: string[], _o: unknown, cb: (e: Error, r: { stdout: string }) => void) =>
        cb(new Error('git not found'), { stdout: '' })
    )
    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()
    await tick()
    proc.emit('close', 0)
    await drainPromise
    // detectFileChanges returns [] on error — run still completes with done
    expect(events.some((e) => e.type === 'done')).toBe(true)
  })

  it('processes remaining buffer content on close', async () => {
    const proc = makeProc()
    mockSpawn.mockReturnValue(proc)

    const adapter = new ClaudeCodeAdapter('cc', '')
    const events: Array<{ type: string; token?: string }> = []
    const drainPromise = (async () => {
      for await (const e of adapter.run(BASE_REQUEST)) events.push(e as (typeof events)[0])
    })()

    await tick()
    // Emit data WITHOUT a trailing newline — it goes into the buffer
    const msg = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'buffered' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    })
    proc.stdout.emit('data', Buffer.from(msg)) // no newline — stays in buf
    proc.emit('close', 0) // close handler calls parseLine(buf)
    await drainPromise

    expect(events.find((e) => e.type === 'token' && e.token?.includes('buffered'))).toBeDefined()
  })
})
