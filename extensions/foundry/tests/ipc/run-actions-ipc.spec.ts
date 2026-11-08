/**
 * The channels behind the four things you do about a run: read it, redirect it,
 * end it, or throw it away.
 *
 * Driven through `activate` with a stubbed runner, because
 * the thing worth asserting is not that the runner interrupts — its own tests
 * cover that — but that the channel a surface calls reaches it. Every bug this
 * branch shipped was in exactly that gap.
 */
import { freshFoundryStorage, idleHome } from '../helpers/foundry-host.js'

// A real userData, created before any spec mocks `node:fs`: the supervision
// runtime writes its feed, mutes and per-session settings in Foundry's own
// folder under it.
const GLOBAL_STORAGE = freshFoundryStorage()

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { partialFake } from '../../../../packages/test-support/src/fakes'
import { activate, deactivate } from '../../src/index.ts'
import { dispatchChannel, type ChannelSpec, type ExtensionAPI } from '@terminator/extension-sdk'
import type { startSupervisionRuntime as startSupervisionRuntimeType } from '../../src/runtime/supervision-runtime.js'
import { theRunner } from '../helpers/supervision-mocks.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../../../packages/test-support/src/temp-dir'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))

vi.mock('../../src/runner/agent-runner.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    setPermissionSink: () => undefined,
  }
})

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
function startRun(sessionId = 'session-1', transcriptPath = '/t.jsonl'): void {
  supervision.runs.add({
    sessionId,
    featureDir: '/repo/specs/021-thing',
    phase: 'implement',
    worktreePath: '/repo/.worktrees/thing',
    branch: 'feat/thing',
    baseBranch: null,
    terminalSessionId: 'terminal-1',
    transcriptPath,
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
    home: idleHome(),
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
  // Awaited rather than slept on: activation starts the runtime in the
  // background, and without a handle every channel below would be testing the
  // "no runtime" branch and passing for the wrong reason.
  const started = await startSupervisionRuntime(api)
  if (started === null) throw new Error('the supervision runtime did not start')
  supervision = started
})

afterAll(async () => {
  await deactivate()
})

beforeEach(() => {
  vi.clearAllMocks()
  theRunner.stop.mockReturnValue(true)
  theRunner.send.mockReturnValue(true)
  theRunner.terminalFor.mockReturnValue({ terminalSessionId: 'terminal-1', projectId: 'project-1' })
  exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
})

// Discarding a run and deciding a phase went with the card model; what is left here is the supervised-run surface the Line still uses.
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
    const transcript = path.join(makeTempDir('fdry-transcript-'), 'run.jsonl')
    const said = { role: 'assistant', content: 'retrying the same edit' }
    fs.writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', message: said })}\n`)
    startRun('session-transcript', transcript)
    const result = (await call('foundry:run-transcript', {
      sessionId: 'session-transcript',
    })) as { lines: { text: string }[] }
    expect(result.lines.map((line) => line.text)).toEqual(['retrying the same edit'])
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
    const [interruptedAt] = theRunner.interrupt.mock.invocationCallOrder
    const [sentAt] = theRunner.send.mock.invocationCallOrder
    expect(interruptedAt).toBeLessThan(sentAt!)
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
