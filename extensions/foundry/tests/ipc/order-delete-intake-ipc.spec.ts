/**
 * Deleting an order while its intake is still running, end to end.
 *
 * `converge` answers as soon as the scout's session exists, and the scout's
 * end is what starts the architect. Delete removes the project, which ends the
 * scout's terminal, so the scout "finishing" arrived after the order was gone:
 * the architect then cut the lane checkout again and opened a new project for
 * an order nobody had any more. On CI the sidebar row came back for good
 * (run 36342472487, foundry-intake.spec.ts:216).
 */
import { tmpdir } from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'

const USER_DATA = tmpdir()

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { vi } from 'vitest'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'

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

vi.mock('../../src/runtime/control-server.js', () => ({
  createControlServer: vi.fn().mockResolvedValue({
    url: 'http://127.0.0.1:1/pretooluse',
    eventUrl: 'http://127.0.0.1:1/event',
    token: 'token',
    register: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  }),
}))

let getHandler: (channel: string) => ((payload: unknown) => Promise<unknown>) | undefined
let api: ExtensionAPI
let dataDir = ''
const settingsGet = vi.fn((key: string) =>
  key === 'terminator.foundry.dataDir' ? dataDir : undefined
)

function call(channel: string, payload: unknown = {}): Promise<unknown> {
  const handler = getHandler(channel)
  if (handler === undefined) throw new Error(`${channel} is not registered`)
  return handler(payload)
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Make the thing work',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { ...base, status: 'draft', recipe: 'direct', ...over }
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
    window: { broadcast: vi.fn(), openAuxiliary: vi.fn(), focusSelf: vi.fn(), showSelf: vi.fn() },
    commands: { register: vi.fn().mockReturnValue({ dispose: vi.fn() }), setEnabled: vi.fn() },
    shell: { exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }) },
    notifications: { showToast: vi.fn(), createNotification: vi.fn() },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: {
      register: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      get: settingsGet,
      set: vi.fn(),
      resolveWorktreeBaseDir: vi.fn().mockReturnValue(path.join(tmpdir(), 'fdry-worktrees')),
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
  if ((await startSupervisionRuntime(api)) === null) {
    throw new Error('the supervision runtime did not start')
  }
})

type Started = {
  phase: string
  onRegistered?: (run: { sessionId: string }) => void
  onEnd?: (exitCode: number | null) => void
}

beforeEach(() => {
  runner.start.mockReset()
  runner.start.mockImplementation(async (input: Started) => {
    const sessionId = `session-${runner.start.mock.calls.length}`
    input.onRegistered?.({ sessionId })
    return { sessionId }
  })
})

describe('deleting an order while its scout is still reading', () => {
  it('starts nothing more for it once the scout ends, and leaves nothing on disk', async () => {
    dataDir = fs.mkdtempSync(path.join(tmpdir(), 'fdry-delete-intake-'))
    await createOrderStore(dataDir).save(order())

    await call('foundry:order.converge', { id: 'WO-1' })
    expect(runner.start).toHaveBeenCalledTimes(1)
    const scout = runner.start.mock.calls[0][0] as Started

    await call('foundry:order.delete', { id: 'WO-1' })
    // Deleting the project closes the scout's terminal.
    scout.onEnd?.(0)
    // What would follow is a chain of file reads and writes; let it run out.
    await new Promise((settle) => setTimeout(settle, 200))

    expect(runner.start).toHaveBeenCalledTimes(1)
    expect(fs.existsSync(path.join(dataDir, 'orders', 'WO-1'))).toBe(false)
  })
})
