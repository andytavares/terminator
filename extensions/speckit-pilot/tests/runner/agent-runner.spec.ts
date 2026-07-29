import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import type { PhaseId } from '../../src/types/speckit.types.js'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

function makeMockChild() {
  const stdoutHandlers: ((data: Buffer) => void)[] = []
  const stderrHandlers: ((data: Buffer) => void)[] = []
  const closeHandlers: ((code: number | null) => void)[] = []

  const child = {
    stdout: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') stdoutHandlers.push(cb)
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') stderrHandlers.push(cb)
      }),
    },
    on: vi.fn((event: string, cb: (code: number | null) => void) => {
      if (event === 'close') closeHandlers.push(cb)
    }),
    kill: vi.fn(),
  }

  return {
    child,
    emitStdout: (data: string) => stdoutHandlers.forEach((cb) => cb(Buffer.from(data))),
    emitStderr: (data: string) => stderrHandlers.forEach((cb) => cb(Buffer.from(data))),
    emitClose: (code: number) => closeHandlers.forEach((cb) => cb(code)),
  }
}

function makeApi(): ExtensionAPI {
  const window: ExtensionAPI['window'] = {
    broadcast: vi.fn(),
    openAuxiliary: vi.fn(),
    focusSelf: vi.fn(),
  }
  return { window } as unknown as ExtensionAPI
}

async function loadRunner() {
  const mod = await import('../../src/runner/agent-runner.js')
  // Self-review runs under a read-only policy installed here. Without a
  // directory to install it into the runner refuses to review at all, which is
  // its own test below.
  mod.setReadOnlyStateDir(readOnlyDir)
  return mod
}

let readOnlyDir: string

beforeEach(() => {
  readOnlyDir = mkdtempSync(join(tmpdir(), 'speckit-read-only-'))
})

afterEach(() => rmSync(readOnlyDir, { recursive: true, force: true, maxRetries: 5 }))

describe('createAgentRunner', () => {
  it('exports createAgentRunner factory', async () => {
    const mod = await loadRunner()
    expect(typeof mod.createAgentRunner).toBe('function')
  })

  it('returns an object with startPhaseRunner', async () => {
    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    expect(typeof runner.startPhaseRunner).toBe('function')
  })
})

describe('startPhaseRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('spawns the login shell with a claude --print command', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Write spec',
      phase: 'specify',
    })

    // Always spawns the user's login shell, not claude directly
    const executable = vi.mocked(spawn).mock.calls[0][0] as string
    expect(executable).toBeTruthy() // shell binary (e.g. /bin/zsh)
    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(spawnArgs.join(' ')).toContain('claude --print')
  })

  it('uses worktreePath as cwd', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    const worktreePath = '/project/.wt/my-feature'

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath,
      phaseCommand: 'Write plan',
      phase: 'plan',
    })

    const opts = vi.mocked(spawn).mock.calls[0][2] as { cwd?: string }
    expect(opts?.cwd).toBe(worktreePath)
  })

  // The native /speckit-* skills resolve their feature dir from these env vars,
  // so they operate on the pilot's dir regardless of the worktree's branch name.
  it('exports SPECIFY_FEATURE(_DIRECTORY) pointing at the feature dir', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    runner.startPhaseRunner({
      featureDir: '/repo/specs/017-tav-11',
      worktreePath: '/repo/.worktrees/tav-11',
      phaseCommand: '/speckit-specify x',
      phase: 'specify',
    })

    const opts = vi.mocked(spawn).mock.calls[0][2] as { env?: Record<string, string> }
    expect(opts.env?.SPECIFY_FEATURE).toBe('017-tav-11')
    expect(opts.env?.SPECIFY_FEATURE_DIRECTORY).toBe('specs/017-tav-11')
  })

  // A claude phase streams `--output-format stream-json`; the runner extracts
  // assistant text deltas and broadcasts them line by line as they arrive.
  const delta = (text: string) =>
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    }) + '\n'

  const toolUse = (name: string) =>
    JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', content_block: { type: 'tool_use', name } },
    }) + '\n'

  it('flushes pending text then surfaces a tool call as an activity note', async () => {
    const { child, emitStdout } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    createAgentRunner(api).startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: '/speckit-plan',
      phase: 'plan',
    })

    // Partial assistant text (no newline) then a tool call — the buffered text
    // is flushed before the note.
    emitStdout(delta('reading the spec'))
    emitStdout(toolUse('Read'))

    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ line: 'reading the spec' })
    )
    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ line: '🔧 Read' })
    )
  })

  it('broadcasts assistant text from stream-json output, one line at a time', async () => {
    const { child, emitStdout } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Write tasks',
      phase: 'tasks',
    })

    // A display line only completes once its trailing newline arrives.
    emitStdout(delta('line one\nline two\n'))

    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ featureDir: '/specs/feat', line: 'line one' })
    )
    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ featureDir: '/specs/feat', line: 'line two' })
    )
  })

  it('streams a line in real time: a line is emitted before the run completes', async () => {
    const { child, emitStdout } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Write spec',
      phase: 'specify',
    })

    // A completed line arrives across two deltas, no close() yet.
    emitStdout(delta('partial '))
    emitStdout(delta('rest of line\n'))

    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ line: 'partial rest of line' })
    )
  })

  it('reassembles a stream-json event split across stdout chunks', async () => {
    const { child, emitStdout } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Plan',
      phase: 'plan',
    })

    const evt = delta('hello\n')
    emitStdout(evt.slice(0, 20))
    emitStdout(evt.slice(20))

    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ line: 'hello' })
    )
  })

  it('ignores non-text stream-json events (system, result)', async () => {
    const { child, emitStdout } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Analyze',
      phase: 'analyze',
    })

    emitStdout(JSON.stringify({ type: 'system', subtype: 'init' }) + '\n')
    emitStdout(JSON.stringify({ type: 'result', subtype: 'success', result: 'done' }) + '\n')

    // System/result events contribute no assistant text. The start banner and
    // control lines (▶ · ⚠) are the only broadcasts, so exclude those.
    const outputCalls = vi
      .mocked(api.window.broadcast)
      .mock.calls.filter((c) => c[0] === 'speckit:run-output')
      .filter((c) => !/^[▶·⚠]/.test((c[1] as { line: string }).line))
    expect(outputCalls).toHaveLength(0)
  })

  it('broadcasts each output line with a ts timestamp', async () => {
    const { child, emitStdout } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Analyze',
      phase: 'analyze',
    })

    emitStdout(delta('output line\n'))

    const call = vi
      .mocked(api.window.broadcast)
      .mock.calls.find((c) => c[0] === 'speckit:run-output')!
    expect(call[1]).toMatchObject({ ts: expect.any(String) })
  })

  it('self-review streams its shell output as plain text (not stream-json)', async () => {
    const { child, emitStdout } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: '',
      phase: 'self-review',
    })

    emitStdout('> vitest run\n PASS tests\n')

    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ line: '> vitest run' })
    )
    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ line: ' PASS tests' })
    )
  })

  it('uses stream-json flags for claude phases', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Write spec',
      phase: 'specify',
    })

    const spawnArgs = (vi.mocked(spawn).mock.calls[0][1] as string[]).join(' ')
    expect(spawnArgs).toContain('--output-format stream-json')
    expect(spawnArgs).toContain('--include-partial-messages')
  })

  // A spawned `--print` process has no interactive channel to approve tool
  // calls, so without a bypass every Write/Edit/Bash stalls forever.
  it('bypasses permission prompts for claude phases', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Write spec',
      phase: 'specify',
    })

    const spawnArgs = (vi.mocked(spawn).mock.calls[0][1] as string[]).join(' ')
    expect(spawnArgs).toContain('--permission-mode bypassPermissions')
  })

  // MCP servers (context7, Linear, Gmail, …) hang the headless spawn on startup.
  it('disables MCP servers with --strict-mcp-config', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    createAgentRunner(api).startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: '/speckit-plan',
      phase: 'plan',
    })
    const spawnArgs = (vi.mocked(spawn).mock.calls[0][1] as string[]).join(' ')
    expect(spawnArgs).toContain('--strict-mcp-config')
  })

  it('kills a hung run after the timeout and reports it', async () => {
    vi.useFakeTimers()
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    createAgentRunner(api).startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: '/speckit-specify x',
      phase: 'specify',
      timeoutMs: 1000,
    })

    vi.advanceTimersByTime(1000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ line: expect.stringContaining('no response after') })
    )
    // A process that ignores SIGTERM is force-killed shortly after.
    vi.advanceTimersByTime(3000)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    vi.useRealTimers()
  })

  it('resumes the session when replying and captures the session id', async () => {
    const { child, emitStdout } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    const onSession = vi.fn()
    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'my answer',
      phase: 'clarify',
      resumeSessionId: 'sess-123',
      onSession,
    })

    const spawnArgs = (vi.mocked(spawn).mock.calls[0][1] as string[]).join(' ')
    expect(spawnArgs).toContain('--resume')
    expect(spawnArgs).toContain('sess-123')

    // session id surfaced from the stream
    emitStdout(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-999' }) + '\n')
    expect(onSession).toHaveBeenCalledWith('sess-999')
  })

  it('emits a start banner immediately so the console is never silent', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    createAgentRunner(api).startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: '/speckit-specify x',
      phase: 'specify',
    })

    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ line: '▶ specify: /speckit-specify x' })
    )
  })

  it('streams stderr to the console so failures are visible', async () => {
    const { child, emitStderr } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    createAgentRunner(api).startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: '/speckit-plan',
      phase: 'plan',
    })

    emitStderr('zsh: command not found: claude\n')
    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ line: '⚠ zsh: command not found: claude' })
    )
  })

  it('reviews under the read-only policy rather than bypassing permissions', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: '',
      phase: 'self-review',
    })

    const spawnArgs = (vi.mocked(spawn).mock.calls[0][1] as string[]).join(' ')
    // A review that bypasses permissions can rewrite the worktree it is
    // reviewing. It now decides from a fixed read-only policy in a hook —
    // deterministic, so no person is ever asked and the gate cannot hang.
    expect(spawnArgs).not.toContain('bypassPermissions')
    expect(spawnArgs).toContain('/google-review')
  })

  it('broadcasts speckit:run-phase-complete on exit', async () => {
    const { child, emitClose } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    const phase: PhaseId = 'implement'

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Implement',
      phase,
    })

    emitClose(0)

    expect(api.window.broadcast).toHaveBeenCalledWith('speckit:run-phase-complete', {
      featureDir: '/specs/feat',
      phase,
      exitCode: 0,
    })
  })

  it('RunnerHandle.stop() calls child.kill with SIGTERM', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    const handle = runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Specify',
      phase: 'specify',
    })

    handle.stop()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('includes feedbackNote in the shell command string', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Write spec',
      phase: 'specify',
      feedbackNote: 'Add acceptance criteria',
    })

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(spawnArgs.join(' ')).toContain('Add acceptance criteria')
  })

  it('uses claude --print in the shell command', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Write spec',
      phase: 'specify',
    })

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[]
    const cmd = spawnArgs.join(' ')
    expect(cmd).toContain('claude')
    expect(cmd).toContain('--print')
  })

  it('calls onStart callback when runner starts', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    const onStart = vi.fn()

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Specify',
      phase: 'specify',
      onStart,
    })

    await Promise.resolve()
    expect(onStart).toHaveBeenCalledOnce()
  })

  it('broadcasts error output and calls onComplete(1) when spawn fails', async () => {
    const errorHandlers: ((err: Error) => void)[] = []
    const errorChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: (err: Error) => void) => {
        if (event === 'error') errorHandlers.push(cb)
      }),
      kill: vi.fn(),
    }
    vi.mocked(spawn).mockReturnValue(errorChild as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    const onComplete = vi.fn()

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/nonexistent/path',
      phaseCommand: 'Specify',
      phase: 'specify',
      onComplete,
    })

    errorHandlers.forEach((cb) => cb(new Error('spawn /bin/zsh ENOENT')))

    await Promise.resolve()
    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ line: expect.stringContaining('runner error') })
    )
    expect(onComplete).toHaveBeenCalledWith(1)
    expect(api.window.broadcast).toHaveBeenCalledWith('speckit:run-phase-complete', {
      featureDir: '/specs/feat',
      phase: 'specify',
      exitCode: 1,
    })
  })

  it('calls onComplete with exit code when process closes', async () => {
    const { child, emitClose } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    const onComplete = vi.fn()

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Specify',
      phase: 'specify',
      onComplete,
    })

    emitClose(0)

    await Promise.resolve()
    expect(onComplete).toHaveBeenCalledWith(0)
  })

  it('uses exitCode 0 when child emits null exitCode', async () => {
    const closeHandlers: ((code: number | null) => void)[] = []
    const nullExitChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') closeHandlers.push(cb)
      }),
      kill: vi.fn(),
    }
    vi.mocked(spawn).mockReturnValue(nullExitChild as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)
    const onComplete = vi.fn()

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Specify',
      phase: 'specify',
      onComplete,
    })

    closeHandlers.forEach((cb) => cb(null))
    await Promise.resolve()
    expect(onComplete).toHaveBeenCalledWith(0)
  })

  it('broadcasts error output even when no onComplete is provided', async () => {
    const errorHandlers: ((err: Error) => void)[] = []
    const errorChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: (err: Error) => void) => {
        if (event === 'error') errorHandlers.push(cb)
      }),
      kill: vi.fn(),
    }
    vi.mocked(spawn).mockReturnValue(errorChild as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/nonexistent',
      phaseCommand: 'Specify',
      phase: 'specify',
      // no onComplete
    })

    errorHandlers.forEach((cb) => cb(new Error('ENOENT')))
    await Promise.resolve()
    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ line: expect.stringContaining('runner error') })
    )
  })

  it('buffers partial stderr (no newline) until a line completes', async () => {
    const stderrHandlers: ((data: Buffer | string) => void)[] = []
    const stderrChild = {
      stdout: { on: vi.fn() },
      stderr: {
        on: vi.fn((event: string, cb: (data: Buffer | string) => void) => {
          if (event === 'data') stderrHandlers.push(cb)
        }),
      },
      on: vi.fn(),
      kill: vi.fn(),
    }
    vi.mocked(spawn).mockReturnValue(stderrChild as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Specify',
      phase: 'specify',
    })

    // Neither chunk ends in a newline, so nothing should be surfaced yet.
    stderrHandlers.forEach((cb) => cb(Buffer.from('some stderr')))
    stderrHandlers.forEach((cb) => cb('stderr as string'))

    const stderrBroadcasts = vi
      .mocked(api.window.broadcast)
      .mock.calls.filter(([ch]) => ch === 'speckit:run-output')
      .filter(([, p]) => (p as { line: string }).line.startsWith('⚠'))
    expect(stderrBroadcasts).toHaveLength(0)

    // A newline flushes the buffered line, prefixed with ⚠.
    stderrHandlers.forEach((cb) => cb('!\n'))
    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ line: '⚠ some stderrstderr as string!' })
    )
  })
})

// T057 — Batch mode for implement phase
describe('startPhaseRunner — batch mode (implement)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('emits speckit:checkin-ready via broadcast when batchIndex is provided', async () => {
    const { child, emitClose } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Implement batch 0',
      phase: 'implement',
      batchIndex: 0,
    })

    emitClose(0)

    const checkinBroadcast = vi
      .mocked(api.window.broadcast)
      .mock.calls.find(([ch]) => ch === 'speckit:checkin-ready')
    expect(checkinBroadcast).toBeDefined()
    expect(checkinBroadcast![1]).toMatchObject({ featureDir: '/specs/feat', batchIndex: 0 })
  })

  it('does NOT emit speckit:checkin-ready when batchIndex is not provided', async () => {
    const { child, emitClose } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Implement',
      phase: 'implement',
    })

    emitClose(0)

    const checkinBroadcast = vi
      .mocked(api.window.broadcast)
      .mock.calls.find(([ch]) => ch === 'speckit:checkin-ready')
    expect(checkinBroadcast).toBeUndefined()
  })

  it('includes diffSummary field in checkin-ready payload', async () => {
    const { child, emitClose } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Implement batch 1',
      phase: 'implement',
      batchIndex: 1,
    })

    emitClose(0)

    const checkinBroadcast = vi
      .mocked(api.window.broadcast)
      .mock.calls.find(([ch]) => ch === 'speckit:checkin-ready')
    expect(checkinBroadcast![1]).toHaveProperty('diffSummary')
  })
})

// T048 — Self-Review mode
describe('startPhaseRunner — self-review mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('spawns the login shell with the self-review command pipeline', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Self-review',
      phase: 'self-review',
    })

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[]
    const cmd = spawnArgs.join(' ')
    // Not `npm run format`: that writes. See formatCheckStep.
    expect(cmd).toContain('npm run lint')
    expect(cmd).toContain('vitest')
    expect(cmd).toContain('coverage')
    expect(cmd).toContain('google-review')
  })

  it('never runs the formatter itself, which would rewrite the code under review', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Self-review',
      phase: 'self-review',
    })

    const cmd = (vi.mocked(spawn).mock.calls[0][1] as string[]).join(' ')
    expect(cmd).not.toMatch(/npm run format(?!:check)/)
  })

  it('shell command contains npm run lint when phase is self-review', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Self-review',
      phase: 'self-review',
    })

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(spawnArgs.join(' ')).toContain('npm run lint')
  })

  it('shell command contains vitest coverage check when phase is self-review', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Self-review',
      phase: 'self-review',
    })

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[]
    const cmd = spawnArgs.join(' ')
    expect(cmd).toContain('vitest')
    expect(cmd).toContain('coverage')
  })

  it('shell command contains google-review check when phase is self-review', async () => {
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Self-review',
      phase: 'self-review',
    })

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[]
    expect(spawnArgs.join(' ')).toContain('google-review')
  })

  it('broadcasts speckit:run-phase-complete with self-review result on exit', async () => {
    const { child, emitStdout, emitClose } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)

    const api = makeApi()
    const { createAgentRunner } = await loadRunner()
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Self-review',
      phase: 'self-review',
    })

    emitStdout('format: ok\nlint: 0 errors\ncoverage: 92%\ngoogle-review: 0 blockers\n')
    emitClose(0)

    const completeBroadcast = vi
      .mocked(api.window.broadcast)
      .mock.calls.find(([ch]) => ch === 'speckit:run-phase-complete')
    expect(completeBroadcast).toBeDefined()
    expect(completeBroadcast![1]).toMatchObject({ phase: 'self-review', featureDir: '/specs/feat' })
  })
})

describe('pruneOldLogs', () => {
  it('deletes logs older than the retention window and keeps recent ones', async () => {
    const fsp = await import('node:fs/promises')
    const os = await import('node:os')
    const nodePath = await import('node:path')
    const { pruneOldLogs } = await import('../../src/runner/agent-runner.js')

    const dir = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'sk-logs-'))
    const logsDir = nodePath.join(dir, '.pilot', 'logs')
    await fsp.mkdir(logsDir, { recursive: true })
    const oldLog = nodePath.join(logsDir, 'specify.log')
    const newLog = nodePath.join(logsDir, 'plan.log')
    await fsp.writeFile(oldLog, 'old')
    await fsp.writeFile(newLog, 'new')
    // Backdate the old log 40 days
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    await fsp.utimes(oldLog, old, old)

    const removed = await pruneOldLogs(dir, 30)
    expect(removed).toBe(1)
    await expect(fsp.access(oldLog)).rejects.toBeTruthy()
    await expect(fsp.access(newLog)).resolves.toBeUndefined()

    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('returns 0 when there is no logs directory', async () => {
    const { pruneOldLogs } = await import('../../src/runner/agent-runner.js')
    expect(await pruneOldLogs('/no/such/dir/xyz', 30)).toBe(0)
  })
})

describe('self-review when the read-only policy cannot be installed', () => {
  it('refuses to review rather than falling back to bypassing permissions', async () => {
    // A gate that did not run must not pass, and the way this was wrong before
    // was exactly a silent fallback to approving everything.
    const { child } = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const mod = await import('../../src/runner/agent-runner.js')
    mod.setReadOnlyStateDir(null)

    mod.createAgentRunner(makeApi()).startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: '',
      phase: 'self-review',
    })

    // The last call, not the first: spawn's mock accumulates across the suite.
    const calls = vi.mocked(spawn).mock.calls
    const cmd = (calls[calls.length - 1][1] as string[]).join(' ')
    expect(cmd).not.toContain('bypassPermissions')
    expect(cmd).not.toContain('/google-review')
    expect(cmd).toContain('self-review skipped')
    // The deterministic checks still run and the chain still fails, so the
    // card cannot advance on a review that never happened.
    expect(cmd).toContain('npm run lint')
    expect(cmd).toContain('false')
  })
})

describe('checking formatting without doing it', () => {
  // `format` is `prettier --write` in every repository that has both, so
  // running it here would mean the phase whose premise is "a review may only
  // read" begins by reformatting the code under review.

  let dir: string

  beforeEach(async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    dir = mkdtempSync(join(tmpdir(), 'fmt-'))
  })

  it('uses the checking script when the repository has one', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        scripts: { format: 'prettier --write .', 'format:check': 'prettier --check .' },
      })
    )
    const { formatCheckStep } = await loadRunner()
    expect(formatCheckStep(dir)).toBe('npm run format:check')
  })

  it('says so rather than running the writing one when there is no checking script', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { format: 'prettier --write .' } })
    )
    const { formatCheckStep } = await loadRunner()
    const step = formatCheckStep(dir)
    expect(step).not.toContain('npm run format')
    expect(step).toContain('not checked')
  })

  it('says so when there is no package.json at all', async () => {
    // "Formatting was not checked" and "formatting is fine" must not look the
    // same on the gate.
    const { formatCheckStep } = await loadRunner()
    expect(formatCheckStep(dir)).toContain('not checked')
  })
})
