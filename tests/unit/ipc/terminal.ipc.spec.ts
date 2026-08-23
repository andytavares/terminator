import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, mockOn } = vi.hoisted(() => ({ mockHandle: vi.fn(), mockOn: vi.fn() }))

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, on: mockOn, removeHandler: vi.fn() },
}))

vi.mock('../../../src/main/storage/settings-store.js', () => ({
  getGlobalSettings: vi.fn(() => ({ terminal: { defaultShell: '/bin/zsh' } })),
}))

const issues = vi.hoisted(() => ({
  link: null as unknown,
  context: null as unknown,
  create: vi.fn(),
  sent: [] as Array<{ channel: string; data: unknown }>,
}))

vi.mock('../../../src/main/integrations/issue-link-store.js', () => ({
  getLink: () => issues.link,
}))
vi.mock('../../../src/main/integrations/agent-context.js', () => ({
  readContextFile: async () => issues.context,
}))
vi.mock('../../../src/main/notifications/notification-manager.js', () => ({
  notificationManager: { create: issues.create },
}))
vi.mock('../../../src/main/safe-send.js', () => ({
  sendToWindow: (_w: unknown, channel: string, data: unknown) => {
    issues.sent.push({ channel, data })
  },
  sendToView: () => {},
}))

import { registerTerminalHandlers } from '../../../src/main/ipc/terminal.ipc.js'
import type { SessionInfo } from '../../../src/main/terminal/pty-manager.js'

function invokeHandler(channel: string) {
  return mockHandle.mock.calls.find(([ch]) => ch === channel)![1] as (
    event: unknown,
    payload?: unknown
  ) => unknown
}

function sendHandler(channel: string) {
  return mockOn.mock.calls.find(([ch]) => ch === channel)![1] as (
    event: unknown,
    payload?: unknown
  ) => void
}

function makeFakePtyManager() {
  const sessions = new Map<string, SessionInfo>()
  const dataListeners = new Map<string, Set<(data: string) => void>>()
  const exitListeners = new Map<string, Set<(code: number) => void>>()
  return {
    sessions,
    emitData(id: string, data: string) {
      dataListeners.get(id)?.forEach((l) => l(data))
    },
    emitExit(id: string, code: number) {
      sessions.delete(id)
      exitListeners.get(id)?.forEach((l) => l(code))
    },
    spawnSession: vi.fn((opts: Record<string, unknown>) => {
      const info = { ...opts, createdAt: 't', pid: 1 } as unknown as SessionInfo
      sessions.set(opts.sessionId as string, info)
      return { ...info }
    }),
    onData: vi.fn((id: string, l: (data: string) => void) => {
      if (!dataListeners.has(id)) dataListeners.set(id, new Set())
      dataListeners.get(id)!.add(l)
      return () => {}
    }),
    onExit: vi.fn((id: string, l: (code: number) => void) => {
      if (!exitListeners.has(id)) exitListeners.set(id, new Set())
      exitListeners.get(id)!.add(l)
      return () => {}
    }),
    listSessions: vi.fn(() => [...sessions.values()].map((s) => ({ ...s }))),
    kill: vi.fn((id: string) => sessions.delete(id)),
    releaseOutput: vi.fn((id: string) => id === 'held'),
    write: vi.fn(),
    resize: vi.fn(),
    killAll: vi.fn(async () => sessions.clear()),
    getSessionIds: vi.fn(() => [...sessions.keys()]),
    cleanupOrphans: vi.fn(() => ({ cleanedCount: 2 })),
  }
}

const VALID_CREATE = {
  projectId: '123e4567-e89b-42d3-a456-426614174000',
  type: 'human',
  tabTitle: 'Terminal 1',
  cwd: '/repo',
}

describe('registerTerminalHandlers', () => {
  let ptyManager: ReturnType<typeof makeFakePtyManager>
  let webContentsSend: ReturnType<typeof vi.fn>
  let win: { isDestroyed: () => boolean; webContents: { send: ReturnType<typeof vi.fn> } } | null

  beforeEach(() => {
    vi.clearAllMocks()
    ptyManager = makeFakePtyManager()
    webContentsSend = vi.fn()
    win = { isDestroyed: () => false, webContents: { send: webContentsSend } }
    registerTerminalHandlers(ptyManager as never, () => win as never)
  })

  describe('terminal:create', () => {
    it('spawns an app-origin session with project metadata', () => {
      const result = invokeHandler('terminal:create')({}, VALID_CREATE) as { sessionId: string }
      expect(result.sessionId).toBeTruthy()
      expect(ptyManager.spawnSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: result.sessionId,
          cwd: '/repo',
          shell: '/bin/zsh',
          type: 'human',
          origin: 'app',
          projectId: VALID_CREATE.projectId,
          tabTitle: 'Terminal 1',
        })
      )
    })

    it('relays output and exit pushes to the renderer window', () => {
      const { sessionId } = invokeHandler('terminal:create')({}, VALID_CREATE) as {
        sessionId: string
      }
      ptyManager.emitData(sessionId, 'out')
      expect(webContentsSend).toHaveBeenCalledWith('terminal:output', { sessionId, data: 'out' })
      ptyManager.emitExit(sessionId, 7)
      expect(webContentsSend).toHaveBeenCalledWith('terminal:process-exit', {
        sessionId,
        exitCode: 7,
      })
    })

    it('does not relay when the window is gone', () => {
      const { sessionId } = invokeHandler('terminal:create')({}, VALID_CREATE) as {
        sessionId: string
      }
      win = null
      ptyManager.emitData(sessionId, 'out')
      expect(webContentsSend).not.toHaveBeenCalled()
    })

    it('returns VALIDATION_ERROR for an invalid payload', () => {
      const result = invokeHandler('terminal:create')({}, { cwd: '/x' }) as { error: string }
      expect(result.error).toBe('VALIDATION_ERROR')
      expect(ptyManager.spawnSession).not.toHaveBeenCalled()
    })

    it('resolves ~ to the home directory', () => {
      invokeHandler('terminal:create')({}, { ...VALID_CREATE, cwd: '~' })
      const spawned = ptyManager.spawnSession.mock.calls[0][0] as { cwd: string }
      expect(spawned.cwd).not.toBe('~')
      expect(spawned.cwd.startsWith('/')).toBe(true)
    })

    it('honors an explicit shell over the settings default', () => {
      invokeHandler('terminal:create')({}, { ...VALID_CREATE, shell: '/bin/fish' })
      expect(ptyManager.spawnSession).toHaveBeenCalledWith(
        expect.objectContaining({ shell: '/bin/fish' })
      )
    })
  })

  describe('terminal:list-sessions', () => {
    it('returns app-origin sessions only, shaped for the renderer', () => {
      invokeHandler('terminal:create')({}, VALID_CREATE)
      ptyManager.sessions.set('remote-1', {
        sessionId: 'remote-1',
        cwd: '/r',
        type: 'human',
        origin: 'remote',
        createdAt: 't',
        pid: 2,
      })
      const result = invokeHandler('terminal:list-sessions')({}) as Array<{ sessionId: string }>
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        sessionId: expect.any(String),
        projectId: VALID_CREATE.projectId,
        tabTitle: 'Terminal 1',
        type: 'human',
      })
    })
  })

  describe('terminal:attach', () => {
    // Output a terminal produced before it was on screen is held rather than
    // dropped; this is what says the tab is ready for it.
    it('releases what was held for the session', () => {
      const result = invokeHandler('terminal:attach')({}, { sessionId: 'held' }) as {
        released: boolean
      }
      expect(ptyManager.releaseOutput).toHaveBeenCalledWith('held')
      expect(result.released).toBe(true)
    })

    it('reports nothing released for a terminal that was never holding', () => {
      const result = invokeHandler('terminal:attach')({}, { sessionId: 'ordinary' }) as {
        released: boolean
      }
      expect(result.released).toBe(false)
    })

    it('refuses a payload naming no session rather than guessing one', () => {
      const result = invokeHandler('terminal:attach')({}, {}) as { released: boolean }
      expect(result.released).toBe(false)
      expect(ptyManager.releaseOutput).not.toHaveBeenCalled()
    })
  })

  describe('terminal:close / input / resize', () => {
    it('kills the session on close', () => {
      const result = invokeHandler('terminal:close')({}, { sessionId: 's1' }) as {
        success: boolean
      }
      expect(result.success).toBe(true)
      expect(ptyManager.kill).toHaveBeenCalledWith('s1')
    })

    it('writes valid input and ignores invalid payloads', () => {
      sendHandler('terminal:input')({}, { sessionId: 's1', data: 'ls' })
      expect(ptyManager.write).toHaveBeenCalledWith('s1', 'ls')
      sendHandler('terminal:input')({}, { sessionId: 's1' })
      expect(ptyManager.write).toHaveBeenCalledTimes(1)
    })

    it('resizes with valid dimensions and ignores invalid ones', () => {
      sendHandler('terminal:resize')({}, { sessionId: 's1', cols: 120, rows: 40 })
      expect(ptyManager.resize).toHaveBeenCalledWith('s1', 120, 40)
      sendHandler('terminal:resize')({}, { sessionId: 's1', cols: -1, rows: 0 })
      expect(ptyManager.resize).toHaveBeenCalledTimes(1)
    })
  })

  describe('terminal:close-all / cleanup-orphans', () => {
    it('reports the terminated count', async () => {
      invokeHandler('terminal:create')({}, VALID_CREATE)
      const result = (await invokeHandler('terminal:close-all')({})) as {
        terminatedCount: number
      }
      expect(result.terminatedCount).toBe(1)
      expect(ptyManager.killAll).toHaveBeenCalled()
    })

    it('delegates orphan cleanup', () => {
      expect(invokeHandler('terminal:cleanup-orphans')({})).toEqual({ cleanedCount: 2 })
    })
  })
})

describe('terminal:create — linked issue', () => {
  const P = '11111111-1111-4111-8111-111111111111'

  beforeEach(() => {
    issues.link = null
    issues.context = null
    issues.sent.length = 0
    issues.create.mockClear()
  })

  async function createTerminal(ptyManager: ReturnType<typeof makeFakePtyManager>) {
    registerTerminalHandlers(ptyManager as never, () => ({}) as never)
    // The outer suite has already registered handlers against a different fake;
    // mockHandle accumulates, so take the most recent registration, not the
    // first one find() would return.
    const calls = mockHandle.mock.calls.filter(([ch]) => ch === 'terminal:create')
    const handler = calls[calls.length - 1][1] as (event: unknown, payload?: unknown) => unknown
    return handler({}, { projectId: P, tabTitle: 'shell', type: 'human', cwd: '/tmp' })
  }

  it('passes the issue key and tracker into the session environment', async () => {
    issues.link = { projectId: P, tracker: 'linear', key: 'TAV-42', injectContext: true }
    const ptyManager = makeFakePtyManager()
    await createTerminal(ptyManager)

    expect(ptyManager.spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({
        env: { TERMINATOR_ISSUE_KEY: 'TAV-42', TERMINATOR_ISSUE_TRACKER: 'linear' },
      })
    )
  })

  it('passes no environment for an unlinked project', async () => {
    const ptyManager = makeFakePtyManager()
    await createTerminal(ptyManager)
    expect(ptyManager.spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({ env: undefined })
    )
  })

  it('tells the operator the session started with issue context (FR-024)', async () => {
    issues.link = { projectId: P, tracker: 'linear', key: 'TAV-42', injectContext: true }
    issues.context = { tracker: 'linear', key: 'TAV-42', chars: 2143, truncated: false }
    await createTerminal(makeFakePtyManager())
    await new Promise((r) => setImmediate(r))

    expect(issues.create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'issueContextInjected',
        title: expect.stringContaining('TAV-42'),
      })
    )
    expect(issues.sent.map((s) => s.channel)).toContain('integrations:context-injected')
  })

  it('says how much context, and whether it was shortened', async () => {
    issues.link = { projectId: P, tracker: 'linear', key: 'TAV-42', injectContext: true }
    issues.context = { tracker: 'linear', key: 'TAV-42', chars: 9900, truncated: true }
    await createTerminal(makeFakePtyManager())
    await new Promise((r) => setImmediate(r))

    const call = issues.create.mock.calls[0][0] as { message: string }
    expect(call.message).toContain('9,900')
    expect(call.message).toContain('shortened')
  })

  it('says nothing when injection is turned off for the project', async () => {
    issues.link = { projectId: P, tracker: 'linear', key: 'TAV-42', injectContext: false }
    issues.context = { tracker: 'linear', key: 'TAV-42', chars: 10, truncated: false }
    await createTerminal(makeFakePtyManager())
    await new Promise((r) => setImmediate(r))

    expect(issues.create).not.toHaveBeenCalled()
    expect(issues.sent).toHaveLength(0)
  })

  it('says nothing when no context has been written yet', async () => {
    issues.link = { projectId: P, tracker: 'linear', key: 'TAV-42', injectContext: true }
    await createTerminal(makeFakePtyManager())
    await new Promise((r) => setImmediate(r))
    expect(issues.create).not.toHaveBeenCalled()
  })
})
