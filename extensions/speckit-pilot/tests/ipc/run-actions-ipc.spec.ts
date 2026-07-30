/**
 * The channels behind the four things you do about a run: read it, redirect it,
 * end it, or throw it away.
 *
 * Driven through `activate` with a stubbed runner and control server, because
 * the thing worth asserting is not that the runner interrupts — its own tests
 * cover that — but that the channel a surface calls reaches it. Every bug this
 * branch shipped was in exactly that gap.
 */
import { tmpdir as tmpdirForUserData } from 'node:os'

// A real directory. The supervision runtime writes its feed, mutes and
// per-session settings under userData, and a path that does not exist fails at
// mkdir. `node:fs` is mocked in some of these specs, so nothing is created
// here — the OS temp directory is already there.
const USER_DATA = tmpdirForUserData()

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import type { startSupervisionRuntime as startSupervisionRuntimeType } from '../../src/index.js'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  // A real directory: the supervision runtime writes its feed, mutes and
  // per-session settings under userData, and a path that does not exist fails
  // at mkdir.
  app: { getPath: vi.fn().mockReturnValue(USER_DATA) },
}))

const runner = {
  start: vi.fn(),
  resolve: vi.fn(),
  handBackToTerminal: vi.fn(),
  interrupt: vi.fn(),
  stop: vi.fn().mockReturnValue(true),
  send: vi.fn().mockReturnValue(true),
  terminalFor: vi.fn().mockReturnValue({ terminalSessionId: 'terminal-1', projectId: 'project-1' }),
  watchable: vi.fn().mockReturnValue([]),
  dispose: vi.fn(),
}

vi.mock('../../src/runtime/supervised-runner.js', () => ({
  createSupervisedRunner: () => runner,
}))

// Captured so a test can raise a held tool call the way the runner does.
let permissionSink: {
  onPending: (ask: Record<string, unknown>) => void
  onResolved: (requestId: string) => void
} | null = null

vi.mock('../../src/runner/agent-runner.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    setPermissionSink: (sink: typeof permissionSink) => {
      permissionSink = sink
    },
  }
})

vi.mock('../../src/runtime/control-server.js', () => ({
  createControlServer: vi.fn().mockResolvedValue({
    url: 'http://127.0.0.1:1/pretooluse',
    eventUrl: 'http://127.0.0.1:1/event',
    token: 'token',
    register: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  }),
}))

// Reading a transcript is a file read; the run's path is fabricated here.
vi.mock('../../src/runtime/transcript-excerpt.js', () => ({
  readTranscriptTail: vi
    .fn()
    .mockReturnValue([{ role: 'assistant', text: 'retrying the same edit', at: 1 }]),
}))

let getHandler: (channel: string) => ((payload: unknown) => Promise<unknown>) | undefined
let api: ExtensionAPI
// The layer the channels read. Held here so a test can put a run on the
// register, which is the state every one of them keys on.
let supervision: NonNullable<Awaited<ReturnType<typeof startSupervisionRuntimeType>>>
const exec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
const createNotification = vi.fn().mockReturnValue({ dispose: vi.fn() })
const showToast = vi.fn()

function call(channel: string, payload: unknown = {}): Promise<unknown> {
  const handler = getHandler(channel)
  if (handler === undefined) throw new Error(`${channel} is not registered`)
  return handler(payload)
}

/** Puts a run on the register, which is what every channel below keys on. */
function startRun(sessionId = 'session-1'): void {
  supervision.runs.add({
    sessionId,
    featureDir: '/repo/specs/021-thing',
    phase: 'implement',
    worktreePath: '/repo/.worktrees/thing',
    branch: 'feat/thing',
    terminalSessionId: 'terminal-1',
    transcriptPath: '/t.jsonl',
    startedAt: 0,
  })
}

beforeAll(async () => {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
  api = {
    ipc: {
      registerHandler: vi.fn((channel: string, handler: (payload: unknown) => Promise<unknown>) => {
        handlers.set(channel, handler)
        return { dispose: vi.fn() }
      }),
      invokeChannel: vi.fn(),
      sendChannel: vi.fn(),
      onWindowEvent: vi.fn().mockReturnValue(() => {}),
      isRemoteAccessible: vi.fn().mockReturnValue(false),
    },
    window: { broadcast: vi.fn(), openAuxiliary: vi.fn(), focusSelf: vi.fn() },
    shell: { exec },
    notifications: { showToast, createNotification },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: {
      register: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      get: vi.fn(),
      set: vi.fn(),
      resolveWorktreeBaseDir: vi.fn().mockReturnValue('/tmp/speckit-run-actions'),
    },
    terminal: {
      onSessionCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onSessionClose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    workspace: {
      list: vi.fn().mockReturnValue([]),
      listProjects: vi.fn().mockReturnValue([]),
      createProject: vi.fn(),
      deleteProject: vi.fn(),
      onDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onProjectDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    pty: {
      spawn: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      listSessions: vi.fn().mockReturnValue([]),
      attachOnData: vi.fn().mockReturnValue(null),
      attachOnExit: vi.fn().mockReturnValue(null),
      openTerminalTab: vi.fn(),
    },
    app: { version: '0.0.0-test' },
  } as unknown as ExtensionAPI

  const { activate, startSupervisionRuntime } = await import('../../src/index.ts')
  activate(api)
  getHandler = (channel) => handlers.get(channel)
  // Awaited rather than slept on: activation starts the runtime in the
  // background, and without a handle every channel below would be testing the
  // "no runtime" branch and passing for the wrong reason.
  const started = await startSupervisionRuntime(api)
  if (started === null) throw new Error('the supervision runtime did not start')
  supervision = started
})

beforeEach(() => {
  vi.clearAllMocks()
  runner.stop.mockReturnValue(true)
  runner.send.mockReturnValue(true)
  runner.terminalFor.mockReturnValue({ terminalSessionId: 'terminal-1', projectId: 'project-1' })
  exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
})

describe('the runtime came up', () => {
  it('registered every run action, not just the read-only ones', () => {
    // A missing channel is the failure this whole file exists to catch.
    for (const channel of [
      'speckit:run-terminal',
      'speckit:run-transcript',
      'speckit:run-interrupt',
      'speckit:run-redirect',
      'speckit:run-stop',
      'speckit:run-discard',
    ]) {
      expect(getHandler(channel)).toBeDefined()
    }
  })
})

describe('going to a run', () => {
  it('takes you there through the core’s own navigation', async () => {
    // Not by handing an id back to the panel: that UI is a separate renderer
    // process, so a core store it imports is a second copy nothing renders.
    expect(await call('speckit:run-terminal', { sessionId: 'session-1' })).toEqual({ ok: true })
    const broadcasts = vi.mocked(api.window.broadcast).mock.calls
    expect(broadcasts).toContainEqual([
      'terminal:navigate-to-session',
      { sessionId: 'terminal-1', projectId: 'project-1' },
    ])
  })

  it('brings the window forward, or the jump happens behind another one', async () => {
    await call('speckit:run-terminal', { sessionId: 'session-1' })
    expect(api.window.focusSelf).toHaveBeenCalled()
  })

  it('says so rather than navigating nowhere once the run has ended', async () => {
    runner.terminalFor.mockReturnValue(null)
    expect(await call('speckit:run-terminal', { sessionId: 'gone' })).toEqual({ ok: false })
    expect(vi.mocked(api.window.broadcast).mock.calls).not.toContainEqual([
      'terminal:navigate-to-session',
      expect.anything(),
    ])
  })
})

describe('reading what it was doing', () => {
  it('returns the tail of the run it knows about', async () => {
    startRun('session-transcript')
    const result = (await call('speckit:run-transcript', {
      sessionId: 'session-transcript',
    })) as { lines: unknown[] }
    expect(result.lines).toHaveLength(1)
  })

  it('returns nothing for a run it does not have, rather than reading a guess', async () => {
    expect(await call('speckit:run-transcript', { sessionId: 'nobody' })).toEqual({ lines: [] })
  })
})

describe('interrupting and redirecting', () => {
  it('interrupts the session', async () => {
    expect(await call('speckit:run-interrupt', { sessionId: 'session-1' })).toEqual({ ok: true })
    expect(runner.interrupt).toHaveBeenCalledWith('session-1')
  })

  it('ends the turn before sending, or the redirect queues behind it', async () => {
    await call('speckit:run-redirect', {
      sessionId: 'session-1',
      message: 'try the other approach',
    })
    expect(runner.interrupt).toHaveBeenCalledWith('session-1')
    expect(runner.send).toHaveBeenCalledWith('session-1', 'try the other approach')
  })

  it('refuses a payload with no message at all, rather than throwing', async () => {
    // A handler that throws on a missing field takes the channel down for
    // everyone rather than refusing one call. Found by driving the real app.
    expect(await call('speckit:run-redirect', { sessionId: 'session-1' })).toEqual({ ok: false })
  })

  it('refuses an empty redirect rather than ending a turn for nothing', async () => {
    expect(await call('speckit:run-redirect', { sessionId: 'session-1', message: '   ' })).toEqual({
      ok: false,
    })
    expect(runner.interrupt).not.toHaveBeenCalled()
  })

  it('records the redirect, attributed to the pilot', async () => {
    // The agent did not say this, and a feed that blurs the two is one you stop
    // trusting.
    startRun('session-feed')
    await call('speckit:run-redirect', { sessionId: 'session-feed', message: 'stop that' })
    const { entries } = (await call('speckit:feed-list')) as {
      entries: Array<{ author: string; summary: string }>
    }
    expect(entries.some((e) => e.author === 'console' && e.summary.includes('stop that'))).toBe(
      true
    )
  })
})

describe('ending a run', () => {
  it('stops it with the reason, so the agent record carries it', async () => {
    await call('speckit:run-stop', { sessionId: 'session-1', reason: 'wrong branch' })
    expect(runner.stop).toHaveBeenCalledWith('session-1', 'wrong branch')
  })

  it('reports a stop that did not land', async () => {
    runner.stop.mockReturnValue(false)
    expect(await call('speckit:run-stop', { sessionId: 'gone' })).toEqual({ ok: false })
  })
})

describe('discarding a run', () => {
  it('removes the worktree and the branch, not just the worktree', async () => {
    // A removed worktree whose branch survives leaves a branch nobody will
    // check out and makes recreating the card fail on "already exists".
    startRun('session-discard')
    await call('speckit:run-discard', {
      sessionId: 'session-discard',
      workspacePath: '/repo',
    })
    const commands = exec.mock.calls.map((c) => (c[0] as { args: string[] }).args)
    expect(commands).toContainEqual(['worktree', 'remove', '/repo/.worktrees/thing', '--force'])
    expect(commands).toContainEqual(['branch', '-D', 'feat/thing'])
  })

  it('takes it off the review queue, so the gate is not held by a dead diff', async () => {
    startRun('session-slot')
    await call('speckit:run-discard', { sessionId: 'session-slot', workspacePath: '/repo' })
    const snapshot = (await call('speckit:supervision-snapshot')) as {
      runs: Array<{ sessionId: string }>
      review: Array<{ sessionId: string }>
    }
    expect(snapshot.runs.some((r) => r.sessionId === 'session-slot')).toBe(false)
    expect(snapshot.review.some((r) => r.sessionId === 'session-slot')).toBe(false)
  })

  it('does not throw when no repository was named', async () => {
    startRun('session-nowhere')
    expect(await call('speckit:run-discard', { sessionId: 'session-nowhere' })).toEqual({
      ok: true,
    })
  })

  it('says so rather than pretending, when there is no such run', async () => {
    expect(
      await call('speckit:run-discard', { sessionId: 'nobody', workspacePath: '/repo' })
    ).toEqual({ ok: false })
  })
})

describe('what is allowed to interrupt you', () => {
  // Automation complacency is the documented failure mode of supervisory
  // control. The rule is fixed rather than per-call: only a blocking request
  // may interrupt, and a request nobody sees is a twelve-hour hang.
  const ask = {
    sessionId: 'session-1',
    requestId: 'req-1',
    featureDir: '/repo/specs/021-thing',
    toolName: 'Bash',
    summary: 'redis-cli -h prod-cache-01',
    detail: null,
    at: 1,
  }

  it('raises a held tool call rather than waiting to be looked at', () => {
    permissionSink?.onPending(ask)
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('redis-cli -h prod-cache-01') })
    )
  })

  it('carries the answer with it, so it can be answered from there', () => {
    permissionSink?.onPending(ask)
    const actions = createNotification.mock.calls[0][0].actions as Array<{
      id: string
      handler: () => void
    }>
    expect(actions.map((a) => a.id)).toEqual(['allow', 'deny', 'open'])

    actions.find((a) => a.id === 'allow')?.handler()
    expect(runner.resolve).toHaveBeenCalledWith('session-1', 'req-1', { allow: true })
  })

  it('takes it away once answered', () => {
    // One left behind after the thing it was about is answered teaches you to
    // dismiss without reading.
    const dispose = vi.fn()
    createNotification.mockReturnValueOnce({ dispose })
    permissionSink?.onPending(ask)
    permissionSink?.onResolved('req-1')
    expect(dispose).toHaveBeenCalled()
  })

  it('does not interrupt for a request that is no longer held', () => {
    permissionSink?.onResolved('never-raised')
    expect(createNotification).not.toHaveBeenCalled()
  })
})
