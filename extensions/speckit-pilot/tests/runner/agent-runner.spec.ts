import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import type { PhaseId } from '../../src/types/speckit.types.js'

// Build a minimal mock ExtensionAPI with only pty and window
function makeApi(overrides?: Partial<Pick<ExtensionAPI, 'pty' | 'window'>>) {
  const pty: ExtensionAPI['pty'] = {
    spawn: vi.fn().mockReturnValue('session-abc'),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    listSessions: vi.fn().mockReturnValue([]),
    attachOnData: vi.fn().mockReturnValue(null),
    attachOnExit: vi.fn().mockReturnValue(null),
  }
  const window: ExtensionAPI['window'] = {
    broadcast: vi.fn(),
    openAuxiliary: vi.fn(),
    focusSelf: vi.fn(),
  }
  return { pty, window, ...overrides } as unknown as ExtensionAPI
}

// Lazy import to allow module to evolve from stub → implementation
async function loadRunner() {
  const mod = await import('../../src/runner/agent-runner.js')
  return mod
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
    vi.resetModules()
  })

  it('calls api.pty.spawn with type "agent"', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Write spec',
      phase: 'specify',
    })

    expect(api.pty.spawn).toHaveBeenCalledWith(
      expect.any(String), // sessionId
      '/repo/.wt/feat', // cwd = worktreePath
      expect.any(String), // shell command
      'agent', // type must be 'agent'
      expect.any(Function), // onData
      expect.any(Function) // onExit
    )
  })

  it('uses worktreePath as cwd', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)
    const worktreePath = '/project/.wt/my-feature'

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath,
      phaseCommand: 'Write plan',
      phase: 'plan',
    })

    const callArgs = vi.mocked(api.pty.spawn).mock.calls[0]
    expect(callArgs[1]).toBe(worktreePath)
  })

  it('broadcasts each line of onData output via api.window.broadcast', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Write tasks',
      phase: 'tasks',
    })

    // Extract the onData callback passed to pty.spawn
    const onData = vi.mocked(api.pty.spawn).mock.calls[0][4]
    onData('line one\nline two\n')

    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({
        featureDir: '/specs/feat',
        line: 'line one',
      })
    )
    expect(api.window.broadcast).toHaveBeenCalledWith(
      'speckit:run-output',
      expect.objectContaining({
        featureDir: '/specs/feat',
        line: 'line two',
      })
    )
  })

  it('broadcasts each output line with a ts timestamp', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Analyze',
      phase: 'analyze',
    })

    const onData = vi.mocked(api.pty.spawn).mock.calls[0][4]
    onData('output line')

    const call = vi.mocked(api.window.broadcast).mock.calls[0]
    expect(call[1]).toMatchObject({ ts: expect.any(String) })
  })

  it('broadcasts speckit:run-phase-complete on exit', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)
    const phase: PhaseId = 'implement'

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Implement',
      phase,
    })

    const onExit = vi.mocked(api.pty.spawn).mock.calls[0][5]
    onExit(0)

    expect(api.window.broadcast).toHaveBeenCalledWith('speckit:run-phase-complete', {
      featureDir: '/specs/feat',
      phase,
      exitCode: 0,
    })
  })

  it('RunnerHandle.stop() calls api.pty.kill with the session ID', async () => {
    const spawnedSessionId = 'session-xyz'
    const api = makeApi()
    vi.mocked(api.pty.spawn).mockReturnValue(spawnedSessionId)

    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    const handle = runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Specify',
      phase: 'specify',
    })

    handle.stop()
    expect(api.pty.kill).toHaveBeenCalledWith(spawnedSessionId)
  })

  it('includes feedbackNote in the shell command when provided', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Write spec',
      phase: 'specify',
      feedbackNote: 'Add acceptance criteria',
    })

    const shellCmd = vi.mocked(api.pty.spawn).mock.calls[0][2]
    expect(shellCmd).toContain('Add acceptance criteria')
  })

  it('uses claude --headless --print in the shell command', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Write spec',
      phase: 'specify',
    })

    const shellCmd = vi.mocked(api.pty.spawn).mock.calls[0][2]
    expect(shellCmd).toContain('claude')
    expect(shellCmd).toContain('--headless')
  })
})

// T057 — Batch mode for implement phase
describe('startPhaseRunner — batch mode (implement)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('emits speckit:checkin-ready via broadcast when batchIndex is provided', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Implement batch 0',
      phase: 'implement',
      batchIndex: 0,
    })

    // Simulate the exit completing a batch (not the final one)
    const onExit = vi.mocked(api.pty.spawn).mock.calls[0][5]
    onExit(0)

    // speckit:checkin-ready should be broadcast when batchIndex is set
    const checkinBroadcast = vi
      .mocked(api.window.broadcast)
      .mock.calls.find(([ch]) => ch === 'speckit:checkin-ready')
    expect(checkinBroadcast).toBeDefined()
    expect(checkinBroadcast![1]).toMatchObject({ featureDir: '/specs/feat', batchIndex: 0 })
  })

  it('does NOT emit speckit:checkin-ready when batchIndex is not provided', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Implement',
      phase: 'implement',
    })

    const onExit = vi.mocked(api.pty.spawn).mock.calls[0][5]
    onExit(0)

    const checkinBroadcast = vi
      .mocked(api.window.broadcast)
      .mock.calls.find(([ch]) => ch === 'speckit:checkin-ready')
    expect(checkinBroadcast).toBeUndefined()
  })

  it('includes diffSummary field in checkin-ready payload', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Implement batch 1',
      phase: 'implement',
      batchIndex: 1,
    })

    const onExit = vi.mocked(api.pty.spawn).mock.calls[0][5]
    onExit(0)

    const checkinBroadcast = vi
      .mocked(api.window.broadcast)
      .mock.calls.find(([ch]) => ch === 'speckit:checkin-ready')
    expect(checkinBroadcast![1]).toHaveProperty('diffSummary')
  })
})

// T048 — Self-Review mode
describe('startPhaseRunner — self-review mode', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('shell command contains npm run format when phase is self-review', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Self-review',
      phase: 'self-review',
    })

    const shellCmd = vi.mocked(api.pty.spawn).mock.calls[0][2]
    expect(shellCmd).toContain('npm run format')
  })

  it('shell command contains npm run lint when phase is self-review', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Self-review',
      phase: 'self-review',
    })

    const shellCmd = vi.mocked(api.pty.spawn).mock.calls[0][2]
    expect(shellCmd).toContain('npm run lint')
  })

  it('shell command contains vitest coverage check when phase is self-review', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Self-review',
      phase: 'self-review',
    })

    const shellCmd = vi.mocked(api.pty.spawn).mock.calls[0][2]
    expect(shellCmd).toContain('vitest')
    expect(shellCmd).toContain('coverage')
  })

  it('shell command contains google-review check when phase is self-review', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Self-review',
      phase: 'self-review',
    })

    const shellCmd = vi.mocked(api.pty.spawn).mock.calls[0][2]
    expect(shellCmd).toContain('google-review')
  })

  it('broadcasts speckit:run-phase-complete with self-review result on exit', async () => {
    const api = makeApi()
    const { createAgentRunner } = await import('../../src/runner/agent-runner.js')
    const runner = createAgentRunner(api)

    runner.startPhaseRunner({
      featureDir: '/specs/feat',
      worktreePath: '/repo/.wt/feat',
      phaseCommand: 'Self-review',
      phase: 'self-review',
    })

    const onData = vi.mocked(api.pty.spawn).mock.calls[0][4]
    const onExit = vi.mocked(api.pty.spawn).mock.calls[0][5]
    onData('format: ok\nlint: 0 errors\ncoverage: 92%\ngoogle-review: 0 blockers\n')
    onExit(0)

    const completeBroadcast = vi
      .mocked(api.window.broadcast)
      .mock.calls.find(([ch]) => ch === 'speckit:run-phase-complete')
    expect(completeBroadcast).toBeDefined()
    expect(completeBroadcast![1]).toMatchObject({ phase: 'self-review', featureDir: '/specs/feat' })
  })
})
