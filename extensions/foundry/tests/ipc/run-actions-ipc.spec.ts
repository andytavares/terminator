/**
 * The channels behind the four things you do about a run: read it, redirect it,
 * end it, or throw it away.
 *
 * Driven through `activate` with a stubbed runner and control server, because
 * the thing worth asserting is not that the runner interrupts — its own tests
 * cover that — but that the channel a surface calls reaches it. Every bug this
 * branch shipped was in exactly that gap.
 */
import { freshGlobalStorage } from '../helpers/foundry-host.js'

// A real userData, created before any spec mocks `node:fs`: the supervision
// runtime writes its feed, mutes and per-session settings in Foundry's own
// folder under it.
const GLOBAL_STORAGE = freshGlobalStorage()

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { partialFake } from '../../../../tests/support/fakes'
import { activate } from '../../src/index.ts'
import { dispatchChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'
import type { startSupervisionRuntime as startSupervisionRuntimeType } from '../../src/runtime/supervision-runtime.js'
import { theRunner } from '../helpers/supervision-mocks.js'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/runtime/control-server.js', () => import('../helpers/supervision-mocks.js'))

vi.mock('../../src/runner/agent-runner.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    setPermissionSink: () => undefined,
  }
})

// Reading a transcript is a file read; the run's path is fabricated here.
vi.mock('../../src/runtime/transcript-excerpt.js', () => ({
  readTranscriptTail: vi
    .fn()
    .mockReturnValue([{ role: 'assistant', text: 'retrying the same edit', at: 1 }]),
}))

let getHandler: (channel: string) => ((payload: unknown) => Promise<unknown>) | undefined
let getCommand: (id: string) => (() => void) | undefined
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
    baseBranch: null,
    terminalSessionId: 'terminal-1',
    transcriptPath: '/t.jsonl',
    startedAt: 0,
  })
}

type Handlers = Map<string, (payload: unknown) => Promise<unknown>>

/** Commands registered into `commands` by id, so a spec can run one. */
function keptCommands(commands: Map<string, () => void>): ExtensionAPI['commands'] {
  return partialFake<ExtensionAPI['commands']>({
    register: vi.fn((command: { id: string }, handler: () => void) => {
      commands.set(command.id, handler)
      return { dispose: vi.fn(() => commands.delete(command.id)) }
    }),
  })
}

/** A host that keeps every channel and command registered, so a spec can call them. */
function actionsApi(handlers: Handlers, commands: Map<string, () => void>): ExtensionAPI {
  const disposable = () => ({ dispose: vi.fn() })
  return partialFake<ExtensionAPI>({
    ipc: partialFake<ExtensionAPI['ipc']>({
      registerHandler: vi.fn((spec: ChannelSpec) => {
        handlers.set(spec.channel, (payload) => dispatchChannel(spec, payload))
        return disposable()
      }),
    }),
    window: partialFake<ExtensionAPI['window']>({
      broadcast: vi.fn(),
      openAuxiliary: vi.fn(),
      focusSelf: vi.fn(),
      showSelf: vi.fn(),
    }),
    commands: keptCommands(commands),
    shell: partialFake<ExtensionAPI['shell']>({ exec }),
    notifications: partialFake<ExtensionAPI['notifications']>({ showToast, createNotification }),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    paths: { app: '', globalStorage: GLOBAL_STORAGE },
    settings: partialFake<ExtensionAPI['settings']>({
      register: vi.fn(disposable),
      get: vi.fn(),
      set: vi.fn(),
    }),
    workspace: partialFake<ExtensionAPI['workspace']>({ list: () => [], listProjects: () => [] }),
  })
}

beforeAll(async () => {
  const handlers: Handlers = new Map()
  const commands = new Map<string, () => void>()
  api = actionsApi(handlers, commands)
  const { startSupervisionRuntime } = await import('../../src/runtime/supervision-runtime.ts')
  activate(api)
  getHandler = (channel) => handlers.get(channel)
  getCommand = (id) => commands.get(id)
  // Awaited rather than slept on: activation starts the runtime in the
  // background, and without a handle every channel below would be testing the
  // "no runtime" branch and passing for the wrong reason.
  const started = await startSupervisionRuntime(api)
  if (started === null) throw new Error('the supervision runtime did not start')
  supervision = started
})

beforeEach(() => {
  vi.clearAllMocks()
  theRunner.stop.mockReturnValue(true)
  theRunner.send.mockReturnValue(true)
  theRunner.terminalFor.mockReturnValue({ terminalSessionId: 'terminal-1', projectId: 'project-1' })
  exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
})

// Discarding a run and deciding a phase went with the card model; what is left here is the supervised-run surface the Line still uses.
describe('the runtime came up', () => {
  it('registered every run action, not just the read-only ones', () => {
    // A missing channel is the failure this whole file exists to catch.
    for (const channel of [
      'foundry:run-terminal',
      'foundry:run-transcript',
      'foundry:run-interrupt',
      'foundry:run-redirect',
      'foundry:run-stop',
    ]) {
      expect(getHandler(channel)).toBeDefined()
    }
  })
})

describe('going to a run', () => {
  it('takes you there through the core’s own navigation', async () => {
    // Not by handing an id back to the panel: that UI is a separate renderer
    // process, so a core store it imports is a second copy nothing renders.
    expect(await call('foundry:run-terminal', { sessionId: 'session-1' })).toEqual({ ok: true })
    const broadcasts = vi.mocked(api.window.broadcast).mock.calls
    expect(broadcasts).toContainEqual([
      'terminal:navigate-to-session',
      { sessionId: 'terminal-1', projectId: 'project-1' },
    ])
  })

  it('brings the window forward, or the jump happens behind another one', async () => {
    await call('foundry:run-terminal', { sessionId: 'session-1' })
    expect(api.window.focusSelf).toHaveBeenCalled()
  })

  it('says so rather than navigating nowhere once the run has ended', async () => {
    theRunner.terminalFor.mockReturnValue(null)
    expect(await call('foundry:run-terminal', { sessionId: 'gone' })).toEqual({ ok: false })
    expect(vi.mocked(api.window.broadcast).mock.calls).not.toContainEqual([
      'terminal:navigate-to-session',
      expect.anything(),
    ])
  })
})

describe('reading what it was doing', () => {
  it('returns the tail of the run it knows about', async () => {
    startRun('session-transcript')
    const result = (await call('foundry:run-transcript', {
      sessionId: 'session-transcript',
    })) as { lines: unknown[] }
    expect(result.lines).toHaveLength(1)
  })

  it('returns nothing for a run it does not have, rather than reading a guess', async () => {
    expect(await call('foundry:run-transcript', { sessionId: 'nobody' })).toEqual({ lines: [] })
  })
})

describe('interrupting and redirecting', () => {
  describe('interrupting', interruptingTests)
  describe('refusing and recording', refusingAndRecordingTests)
})

function interruptingTests() {
  it('interrupts the session', async () => {
    expect(await call('foundry:run-interrupt', { sessionId: 'session-1' })).toEqual({ ok: true })
    expect(theRunner.interrupt).toHaveBeenCalledWith('session-1')
  })

  it('ends the turn before sending, or the redirect queues behind it', async () => {
    await call('foundry:run-redirect', {
      sessionId: 'session-1',
      message: 'try the other approach',
    })
    expect(theRunner.interrupt).toHaveBeenCalledWith('session-1')
    expect(theRunner.send).toHaveBeenCalledWith('session-1', 'try the other approach')
  })
}

function refusingAndRecordingTests() {
  it('refuses a payload with no message at all, rather than throwing', async () => {
    // A handler that throws on a missing field takes the channel down for
    // everyone rather than refusing one call. Found by driving the real app.
    expect(await call('foundry:run-redirect', { sessionId: 'session-1' })).toEqual({ ok: false })
  })

  it('refuses an empty redirect rather than ending a turn for nothing', async () => {
    expect(await call('foundry:run-redirect', { sessionId: 'session-1', message: '   ' })).toEqual({
      ok: false,
    })
    expect(theRunner.interrupt).not.toHaveBeenCalled()
  })

  it('records the redirect, attributed to the pilot', async () => {
    // The agent did not say this, and a feed that blurs the two is one you stop
    // trusting.
    startRun('session-feed')
    await call('foundry:run-redirect', { sessionId: 'session-feed', message: 'stop that' })
    const { entries } = (await call('foundry:feed-list')) as {
      entries: Array<{ author: string; summary: string }>
    }
    expect(entries.some((e) => e.author === 'console' && e.summary.includes('stop that'))).toBe(
      true
    )
  })
}

describe('ending a run', () => {
  it('stops it with the reason, so the agent record carries it', async () => {
    await call('foundry:run-stop', { sessionId: 'session-1', reason: 'wrong branch' })
    expect(theRunner.stop).toHaveBeenCalledWith('session-1', 'wrong branch')
  })

  it('reports a stop that did not land', async () => {
    theRunner.stop.mockReturnValue(false)
    expect(await call('foundry:run-stop', { sessionId: 'gone' })).toEqual({ ok: false })
  })
})

describe('the Forge view preference', () => {
  it('defaults to list when nothing is set', async () => {
    ;(api.settings.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined)
    expect(await call('foundry:ui.view', {})).toEqual({ view: 'list' })
  })

  it('reads back a persisted factory preference', async () => {
    ;(api.settings.get as ReturnType<typeof vi.fn>).mockReturnValue('factory')
    expect(await call('foundry:ui.view', {})).toEqual({ view: 'factory' })
  })

  it('treats anything other than factory as list', async () => {
    ;(api.settings.get as ReturnType<typeof vi.fn>).mockReturnValue('nonsense')
    expect(await call('foundry:ui.view', {})).toEqual({ view: 'list' })
  })

  it('writes the setting and broadcasts the change', async () => {
    expect(await call('foundry:ui.set-view', { view: 'factory' })).toEqual({ view: 'factory' })
    expect(api.settings.set).toHaveBeenCalledWith('terminator.foundry.view', 'factory')
    expect(api.window.broadcast).toHaveBeenCalledWith('foundry:ui.view-changed', {
      view: 'factory',
    })
  })

  it('rejects a value that is not a known view', async () => {
    expect(await call('foundry:ui.set-view', { view: 'grid' })).toEqual({
      error: 'Malformed request.',
    })
    expect(api.settings.set).not.toHaveBeenCalled()
  })
})

describe('toggling the Forge view', () => {
  function toggleHandler(): () => void {
    const handler = getCommand('toggle-view')
    if (handler === undefined) throw new Error('toggle-view is not registered')
    return handler
  }

  it('flips list to factory, brings Foundry forward and broadcasts', () => {
    ;(api.settings.get as ReturnType<typeof vi.fn>).mockReturnValue('list')
    toggleHandler()()
    expect(api.settings.set).toHaveBeenCalledWith('terminator.foundry.view', 'factory')
    expect(api.window.showSelf).toHaveBeenCalledWith('main')
    expect(api.window.broadcast).toHaveBeenCalledWith('foundry:ui.view-changed', {
      view: 'factory',
    })
  })

  it('flips factory back to list', () => {
    ;(api.settings.get as ReturnType<typeof vi.fn>).mockReturnValue('factory')
    toggleHandler()()
    expect(api.settings.set).toHaveBeenCalledWith('terminator.foundry.view', 'list')
    expect(api.window.broadcast).toHaveBeenCalledWith('foundry:ui.view-changed', { view: 'list' })
  })
})

describe('the model that answers asks', () => {
  function handler(channel: string): (payload: unknown) => Promise<unknown> {
    const h = getHandler(channel)
    if (h === undefined) throw new Error(`${channel} is not registered`)
    return h
  }

  it('is Sonnet until the operator chooses otherwise', async () => {
    ;(api.settings.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined)
    expect(await handler('foundry:ask-model')({})).toEqual({ selected: 'sonnet' })
  })

  it('saves Opus when the operator overrides it', async () => {
    expect(await handler('foundry:ask-model-set')({ model: 'opus' })).toEqual({
      ok: true,
      selected: 'opus',
    })
    expect(api.settings.set).toHaveBeenCalledWith('terminator.foundry.askModel', 'opus')
  })

  it('refuses a model that is not Sonnet or Opus', async () => {
    expect(await handler('foundry:ask-model-set')({ model: 'haiku' })).toEqual({
      error: 'model must be one of sonnet, opus',
    })
    expect(api.settings.set).not.toHaveBeenCalled()
  })
})
