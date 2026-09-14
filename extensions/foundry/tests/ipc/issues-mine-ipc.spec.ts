/**
 * The ticket picker's channel. Driven through `activate` with a stubbed
 * `api.issues`, because the host hands back every issue regardless of state and
 * the channel is the only place Forge's list is narrowed.
 */
import { tmpdir as tmpdirForUserData } from 'node:os'

const USER_DATA = tmpdirForUserData()

import { describe, it, expect, vi, beforeAll } from 'vitest'
import type {
  ExtensionAPI,
  IssueSummary,
  IssueStateType,
} from '../../../../src/main/extensions/api.js'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn().mockReturnValue([]) },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  app: { getPath: vi.fn().mockReturnValue(USER_DATA) },
}))

vi.mock('../../src/runtime/supervised-runner.js', () => ({
  createSupervisedRunner: () => ({
    start: vi.fn(),
    resolve: vi.fn(),
    handBackToTerminal: vi.fn(),
    interrupt: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(),
    terminalFor: vi.fn(),
    watchable: vi.fn().mockReturnValue([]),
    dispose: vi.fn(),
  }),
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

function issue(key: string, type: IssueStateType): IssueSummary {
  return {
    tracker: 'linear',
    id: `id-${key}`,
    key,
    title: `${key} title`,
    url: `https://linear.app/t/${key}`,
    state: { name: `${type} name`, type },
    assignee: null,
    branchName: null,
  }
}

const MIXED: IssueSummary[] = [
  issue('T-1', 'backlog'),
  issue('T-2', 'completed'),
  issue('T-3', 'unstarted'),
  issue('T-4', 'canceled'),
  issue('T-5', 'started'),
]

const listMine = vi.fn().mockResolvedValue({ issues: MIXED, failures: [] })
const search = vi.fn().mockResolvedValue({ issues: MIXED, failures: [] })

let getHandler: (channel: string) => ((payload: unknown) => Promise<unknown>) | undefined

beforeAll(async () => {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
  const api = {
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
      resolveWorktreeBaseDir: vi.fn().mockReturnValue('/tmp/foundry-issues-mine'),
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
    issues: {
      connections: vi.fn().mockResolvedValue([{ tracker: 'linear', account: 'me@example.com' }]),
      listMine,
      search,
    },
    app: { version: '0.0.0-test' },
  } as unknown as ExtensionAPI

  const { activate } = await import('../../src/index.ts')
  activate(api)
  getHandler = (channel) => handlers.get(channel)
})

async function keys(payload: unknown): Promise<string[]> {
  const handler = getHandler('foundry:issues.mine')
  if (handler === undefined) throw new Error('foundry:issues.mine is not registered')
  const reply = (await handler(payload)) as { issues: { key: string }[] }
  return reply.issues.map((i) => i.key)
}

describe('foundry:issues.mine', () => {
  it('lists your tickets without the completed or canceled ones', async () => {
    expect(await keys({ term: '' })).toEqual(['T-1', 'T-3', 'T-5'])
    expect(listMine).toHaveBeenCalledWith({ limit: 50 })
    expect(search).not.toHaveBeenCalled()
  })

  it('searches without the completed or canceled ones', async () => {
    expect(await keys({ term: 'clipping' })).toEqual(['T-1', 'T-3', 'T-5'])
    expect(search).toHaveBeenCalledWith('clipping', { limit: 50 })
  })
})
