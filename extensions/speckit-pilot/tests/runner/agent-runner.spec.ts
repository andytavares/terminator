import { describe, it, expect, vi, beforeEach } from 'vitest'
import { spawn } from 'node:child_process'
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
  return import('../../src/runner/agent-runner.js')
}

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

  it('broadcasts each line of stdout output via api.window.broadcast', async () => {
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

    emitStdout('line one\nline two\n')

    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ featureDir: '/specs/feat', line: 'line one' })
    )
    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({ featureDir: '/specs/feat', line: 'line two' })
    )
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

    emitStdout('output line')

    const call = vi.mocked(api.window.broadcast).mock.calls[0]
    expect(call[1]).toMatchObject({ ts: expect.any(String) })
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

  it('collects stderr output without broadcasting per-line', async () => {
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

    stderrHandlers.forEach((cb) => cb(Buffer.from('some stderr')))
    stderrHandlers.forEach((cb) => cb('stderr as string'))

    const outputBroadcasts = vi
      .mocked(api.window.broadcast)
      .mock.calls.filter(([ch]) => ch === 'speckit:run-output')
    expect(outputBroadcasts).toHaveLength(0)
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
    expect(cmd).toContain('npm run format')
    expect(cmd).toContain('npm run lint')
    expect(cmd).toContain('vitest')
    expect(cmd).toContain('coverage')
    expect(cmd).toContain('google-review')
  })

  it('shell command contains npm run format when phase is self-review', async () => {
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
    expect(spawnArgs.join(' ')).toContain('npm run format')
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
