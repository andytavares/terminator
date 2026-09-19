/**
 * The Foundry quick-actions group: the dynamic "go to <card>" entries and the
 * one static "New work order…" command.
 *
 * Driven through `activate`, because the thing worth asserting is not that
 * `paletteEntries` orders runs correctly — its own spec covers that — but
 * that what reaches `api.commands.register` carries the group's category and
 * mnemonic rule, and that the static command actually brings Foundry forward.
 */
import { tmpdir as tmpdirForUserData } from 'node:os'

const USER_DATA = tmpdirForUserData()

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import type { ExtensionAPI, CommandContribution } from '../../../../src/main/extensions/api.js'
import type { startSupervisionRuntime as startSupervisionRuntimeType } from '../../src/index.js'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  app: { getPath: vi.fn().mockReturnValue(USER_DATA) },
}))

const runner = {
  start: vi.fn(),
  resolve: vi.fn(),
  handBackToTerminal: vi.fn(),
  interrupt: vi.fn(),
  stop: vi.fn().mockReturnValue(true),
  send: vi.fn().mockReturnValue(true),
  terminalFor: vi.fn().mockReturnValue(null),
  watchable: vi.fn().mockReturnValue([]),
  dispose: vi.fn(),
}

vi.mock('../../src/runtime/supervised-runner.js', () => ({
  createSupervisedRunner: () => runner,
}))

vi.mock('../../src/runner/agent-runner.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    setPermissionSink: () => {},
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

vi.mock('../../src/runtime/transcript-excerpt.js', () => ({
  readTranscriptTail: vi.fn().mockReturnValue([]),
}))

let api: ExtensionAPI
let supervision: NonNullable<Awaited<ReturnType<typeof startSupervisionRuntimeType>>>
const registered = new Map<string, { command: CommandContribution; handler: () => void }>()

/** The dynamic "go to <card>" entries only — `new-order` shares their category but is not one of them. */
function goToRunEntries(): CommandContribution[] {
  return [...registered.values()]
    .map((r) => r.command)
    .filter((c) => c.id.startsWith('run.') || c.id.startsWith('review.'))
}

/** Adds a run — always 'working' at first, per the registry — then lets the 5s palette timer pick it up. */
async function addRunAndWaitForPalette(
  over: Record<string, unknown> & { state?: 'working' | 'waiting' | 'stalled' }
): Promise<void> {
  const { state, ...rest } = over
  const run = supervision.runs.add({
    sessionId: 'session-1',
    featureDir: '/repo/specs/021-thing',
    phase: 'implement',
    worktreePath: '/repo/.worktrees/thing',
    branch: 'feat/thing',
    terminalSessionId: 'terminal-1',
    transcriptPath: '/t.jsonl',
    startedAt: 0,
    ...rest,
  } as never)
  if (state !== undefined && state !== 'working') {
    supervision.runs.setState(run.sessionId, state, Date.now())
  }
  await vi.advanceTimersByTimeAsync(5100)
}

beforeAll(async () => {
  vi.useFakeTimers()
  api = {
    ipc: {
      registerHandler: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      invokeChannel: vi.fn(),
      sendChannel: vi.fn(),
      onWindowEvent: vi.fn().mockReturnValue(() => {}),
      isRemoteAccessible: vi.fn().mockReturnValue(false),
    },
    window: {
      broadcast: vi.fn(),
      openAuxiliary: vi.fn(),
      focusSelf: vi.fn(),
      showSelf: vi.fn(),
    },
    commands: {
      register: vi.fn((command: CommandContribution, handler: () => void) => {
        registered.set(command.id, { command, handler })
        return { dispose: vi.fn(() => registered.delete(command.id)) }
      }),
      setEnabled: vi.fn(),
    },
    shell: {
      exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    },
    notifications: {
      showToast: vi.fn(),
      createNotification: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: {
      register: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      get: vi.fn(),
      set: vi.fn(),
      resolveWorktreeBaseDir: vi.fn().mockReturnValue('/tmp/speckit-quick-actions'),
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
  const started = await startSupervisionRuntime(api)
  if (started === null) throw new Error('the supervision runtime did not start')
  supervision = started
  // The initial synchronous refresh runs with no runs on the register yet.
  await vi.advanceTimersByTimeAsync(0)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('the go-to-run entries', () => {
  it('register under the Foundry category', async () => {
    await addRunAndWaitForPalette({ sessionId: 'a', branch: 'feat/a', state: 'working' })
    expect(goToRunEntries().some((c) => c.id === 'run.a')).toBe(true)
  })

  it('gives only the first entry a mnemonic', async () => {
    await addRunAndWaitForPalette({})
    supervision.runs.add({
      sessionId: 'b',
      featureDir: '/repo/specs/022-thing',
      phase: 'implement',
      worktreePath: '/repo/.worktrees/other',
      branch: 'feat/b',
      terminalSessionId: 'terminal-2',
      transcriptPath: '/t2.jsonl',
      startedAt: 0,
      state: 'working',
    } as never)
    await vi.advanceTimersByTimeAsync(5100)
    const entries = goToRunEntries()
    const withMnemonic = entries.filter((c) => c.mnemonic !== undefined)
    expect(withMnemonic).toHaveLength(1)
    expect(withMnemonic[0].mnemonic).toBe('w')
  })

  it('labels the most urgent entry as the run waiting on you, when it is waiting', async () => {
    await addRunAndWaitForPalette({ sessionId: 'a', branch: 'feat/a', state: 'waiting' })
    const entry = registered.get('run.a')!.command
    expect(entry.label).toBe('Go to the run waiting on you')
    expect(entry.mnemonic).toBe('w')
  })

  it('labels the most urgent entry the same way when it is stalled', async () => {
    await addRunAndWaitForPalette({ sessionId: 'a', branch: 'feat/a', state: 'stalled' })
    expect(registered.get('run.a')!.command.label).toBe('Go to the run waiting on you')
  })

  it('keeps today’s label when the most urgent entry is only working, but still gives it the mnemonic', async () => {
    await addRunAndWaitForPalette({ sessionId: 'a', branch: 'feat/a', state: 'working' })
    const entry = registered.get('run.a')!.command
    expect(entry.label).toBe('Go to 021-thing')
    expect(entry.mnemonic).toBe('w')
  })

  it('keeps ids stable across a refresh', async () => {
    await addRunAndWaitForPalette({ sessionId: 'a', branch: 'feat/a', state: 'working' })
    expect(registered.has('run.a')).toBe(true)
    supervision.runs.setState('a', 'stalled', Date.now())
    await vi.advanceTimersByTimeAsync(5100)
    expect(registered.has('run.a')).toBe(true)
  })
})

describe('the new work order command', () => {
  it('is registered under Foundry with mnemonic n', () => {
    const command = [...registered.values()].map((r) => r.command).find((c) => c.id === 'new-order')
    expect(command).toMatchObject({ category: 'Foundry', mnemonic: 'n', label: 'New work order…' })
  })

  it('brings Foundry forward and asks its view to open the new-order intake', () => {
    const entry = registered.get('new-order')!
    entry.handler()
    expect(api.window.showSelf).toHaveBeenCalledWith('main')
    expect(api.window.broadcast).toHaveBeenCalledWith('foundry:ui.open-new-order', {})
  })
})
