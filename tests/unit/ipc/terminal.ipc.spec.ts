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

const records = vi.hoisted(() => ({ markClosed: vi.fn().mockResolvedValue(undefined) }))

vi.mock('../../../src/main/sessions/session-record-store.js', () => ({
  markClosed: records.markClosed,
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

import { registerTerminalHandlers, sendToRenderer } from '../../../src/main/ipc/terminal.ipc.js'
import { OutputRelay } from '../../../src/main/terminal/output-relay.js'
import { MissingCwdError } from '../../../src/main/terminal/pty-manager.js'
import type { SessionInfo } from '../../../src/main/terminal/pty-manager.js'
import { OUTPUT_FLUSH_INTERVAL_MS } from '../../../src/main/terminal/output-batcher.js'
import { HIGH_WATERMARK_CHARS } from '../../../src/main/terminal/flow-control.js'

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
    pause: vi.fn(),
    resume: vi.fn(),
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
    const getWindow = () => win as never
    registerTerminalHandlers(
      ptyManager as never,
      getWindow,
      new OutputRelay(ptyManager as never, sendToRenderer(getWindow))
    )
  })

  describe('terminal:create', () => {
    it('spawns an app-origin session with project metadata', async () => {
      const result = (await invokeHandler('terminal:create')({}, VALID_CREATE)) as {
        sessionId: string
      }
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

    it('relays output and exit pushes to the renderer window', async () => {
      vi.useFakeTimers()
      const { sessionId } = (await invokeHandler('terminal:create')({}, VALID_CREATE)) as {
        sessionId: string
      }
      ptyManager.emitData(sessionId, 'out')
      vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)
      expect(webContentsSend).toHaveBeenCalledWith('terminal:output', { sessionId, data: 'out' })
      ptyManager.emitExit(sessionId, 7)
      expect(webContentsSend).toHaveBeenCalledWith('terminal:process-exit', {
        sessionId,
        exitCode: 7,
      })
      vi.useRealTimers()
    })

    it('does not relay when the window is gone', async () => {
      const { sessionId } = (await invokeHandler('terminal:create')({}, VALID_CREATE)) as {
        sessionId: string
      }
      win = null
      ptyManager.emitData(sessionId, 'out')
      expect(webContentsSend).not.toHaveBeenCalled()
    })

    it('resolves ~ to the home directory', async () => {
      await invokeHandler('terminal:create')({}, { ...VALID_CREATE, cwd: '~' })
      const spawned = ptyManager.spawnSession.mock.calls[0][0] as { cwd: string }
      expect(spawned.cwd).not.toBe('~')
      expect(spawned.cwd.startsWith('/')).toBe(true)
    })

    it('names the terminal in its environment, so an agent in it can be placed', async () => {
      const { sessionId } = (await invokeHandler('terminal:create')({}, VALID_CREATE)) as {
        sessionId: string
      }
      const spawned = ptyManager.spawnSession.mock.calls[0][0] as { env: Record<string, string> }
      expect(spawned.env.TERMINATOR_SESSION_ID).toBe(sessionId)
    })

    it('names it beside the linked issue, not instead of it', async () => {
      issues.link = { projectId: VALID_CREATE.projectId, tracker: 'linear', key: 'TAV-42' }
      await invokeHandler('terminal:create')({}, VALID_CREATE)
      const spawned = ptyManager.spawnSession.mock.calls[0][0] as { env: Record<string, string> }
      expect(spawned.env).toMatchObject({
        TERMINATOR_ISSUE_KEY: 'TAV-42',
        TERMINATOR_SESSION_ID: expect.any(String),
      })
      issues.link = null
    })

    it('runs an initial command in the terminal it opened', async () => {
      const { sessionId } = (await invokeHandler('terminal:create')(
        {},
        { ...VALID_CREATE, initialCommand: 'claude --resume abc-123' }
      )) as { sessionId: string }
      expect(ptyManager.write).toHaveBeenCalledWith(sessionId, 'claude --resume abc-123\n')
    })

    it('writes nothing when no initial command was asked for', async () => {
      await invokeHandler('terminal:create')({}, VALID_CREATE)
      expect(ptyManager.write).not.toHaveBeenCalled()
    })

    it('returns the shell it actually spawned', async () => {
      const fromSettings = (await invokeHandler('terminal:create')({}, VALID_CREATE)) as {
        shell: string
      }
      expect(fromSettings.shell).toBe('/bin/zsh')
      const explicit = (await invokeHandler('terminal:create')(
        {},
        {
          ...VALID_CREATE,
          shell: '/bin/fish',
        }
      )) as { shell: string }
      expect(explicit.shell).toBe('/bin/fish')
    })

    it('honors an explicit shell over the settings default', async () => {
      await invokeHandler('terminal:create')({}, { ...VALID_CREATE, shell: '/bin/fish' })
      expect(ptyManager.spawnSession).toHaveBeenCalledWith(
        expect.objectContaining({ shell: '/bin/fish' })
      )
    })
  })

  describe('terminal:list-sessions', () => {
    it('returns app-origin sessions only, shaped for the renderer', async () => {
      await invokeHandler('terminal:create')({}, VALID_CREATE)
      ptyManager.sessions.set('remote-1', {
        sessionId: 'remote-1',
        cwd: '/r',
        type: 'human',
        origin: 'remote',
        createdAt: 't',
        pid: 2,
      })
      const result = (await invokeHandler('terminal:list-sessions')({})) as Array<{
        sessionId: string
      }>
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
    it('releases what was held for the session', async () => {
      const result = (await invokeHandler('terminal:attach')({}, { sessionId: 'held' })) as {
        released: boolean
      }
      expect(ptyManager.releaseOutput).toHaveBeenCalledWith('held')
      expect(result.released).toBe(true)
    })

    it('reports nothing released for a terminal that was never holding', async () => {
      const result = (await invokeHandler('terminal:attach')({}, { sessionId: 'ordinary' })) as {
        released: boolean
      }
      expect(result.released).toBe(false)
    })
  })

  describe('terminal:close / input / resize', () => {
    it('kills the session on close', async () => {
      const result = (await invokeHandler('terminal:close')({}, { sessionId: 's1' })) as {
        success: boolean
      }
      expect(result.success).toBe(true)
      expect(ptyManager.kill).toHaveBeenCalledWith('s1')
    })

    it('closes the session record after killing the process', async () => {
      await invokeHandler('terminal:close')({}, { sessionId: 's1' })
      expect(records.markClosed).toHaveBeenCalledWith('s1', expect.any(Date))
      expect(ptyManager.kill.mock.invocationCallOrder[0]).toBeLessThan(
        records.markClosed.mock.invocationCallOrder[0]
      )
    })

    it('writes valid input and ignores invalid payloads', async () => {
      sendHandler('terminal:input')({}, { sessionId: 's1', data: 'ls' })
      expect(ptyManager.write).toHaveBeenCalledWith('s1', 'ls')
      sendHandler('terminal:input')({}, { sessionId: 's1' })
      expect(ptyManager.write).toHaveBeenCalledTimes(1)
    })

    it('pauses the process when the renderer falls behind, and resumes it on acknowledgement', async () => {
      vi.useFakeTimers()
      const { sessionId } = (await invokeHandler('terminal:create')({}, VALID_CREATE)) as {
        sessionId: string
      }
      ptyManager.emitData(sessionId, 'x'.repeat(HIGH_WATERMARK_CHARS + 1))
      vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)
      expect(ptyManager.pause).toHaveBeenCalledWith(sessionId)

      sendHandler('terminal:acknowledge')({}, { sessionId, count: HIGH_WATERMARK_CHARS + 1 })
      expect(ptyManager.resume).toHaveBeenCalledWith(sessionId)
      vi.useRealTimers()
    })

    it('ignores an acknowledgement that is not a count', async () => {
      vi.useFakeTimers()
      const { sessionId } = (await invokeHandler('terminal:create')({}, VALID_CREATE)) as {
        sessionId: string
      }
      ptyManager.emitData(sessionId, 'x'.repeat(HIGH_WATERMARK_CHARS + 1))
      vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)

      sendHandler('terminal:acknowledge')({}, { sessionId, count: -5 })
      sendHandler('terminal:acknowledge')({}, { sessionId, count: 'all' })
      expect(ptyManager.resume).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('forgets what an earlier renderer owed when a terminal attaches', async () => {
      vi.useFakeTimers()
      const { sessionId } = (await invokeHandler('terminal:create')({}, VALID_CREATE)) as {
        sessionId: string
      }
      ptyManager.emitData(sessionId, 'x'.repeat(HIGH_WATERMARK_CHARS + 1))
      vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)

      await invokeHandler('terminal:attach')({}, { sessionId })
      expect(ptyManager.resume).toHaveBeenCalledWith(sessionId)
      vi.useRealTimers()
    })

    it('resizes with valid dimensions and ignores invalid ones', async () => {
      sendHandler('terminal:resize')({}, { sessionId: 's1', cols: 120, rows: 40 })
      expect(ptyManager.resize).toHaveBeenCalledWith('s1', 120, 40)
      sendHandler('terminal:resize')({}, { sessionId: 's1', cols: -1, rows: 0 })
      expect(ptyManager.resize).toHaveBeenCalledTimes(1)
    })
  })

  describe('a branch whose folder is gone', () => {
    // The renderer needs the folder's name to say anything useful, so the
    // handler reports rather than throws, and carries the message through.
    it('returns CWD_MISSING naming the folder, and opens no tab', async () => {
      ptyManager.spawnSession.mockImplementation(() => {
        throw new MissingCwdError('/repo/.worktrees/removed')
      })

      const result = (await invokeHandler('terminal:create')({}, VALID_CREATE)) as {
        error: string
        message: string
      }

      expect(result.error).toBe('CWD_MISSING')
      expect(result.message).toContain('/repo/.worktrees/removed')
      expect(ptyManager.onData).not.toHaveBeenCalled()
      expect(ptyManager.onExit).not.toHaveBeenCalled()
    })

    it('lets any other spawn failure through', async () => {
      ptyManager.spawnSession.mockImplementation(() => {
        throw new Error('fork failed')
      })

      await expect(invokeHandler('terminal:create')({}, VALID_CREATE)).rejects.toThrow(
        'fork failed'
      )
    })
  })

  describe('terminal:close-all / cleanup-orphans', () => {
    it('reports the terminated count', async () => {
      await invokeHandler('terminal:create')({}, VALID_CREATE)
      const result = (await invokeHandler('terminal:close-all')({})) as {
        terminatedCount: number
      }
      expect(result.terminatedCount).toBe(1)
      expect(ptyManager.killAll).toHaveBeenCalled()
    })

    it('delegates orphan cleanup', async () => {
      expect(await invokeHandler('terminal:cleanup-orphans')({})).toEqual({ cleanedCount: 2 })
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
    const getWindow = () => ({}) as never
    registerTerminalHandlers(
      ptyManager as never,
      getWindow,
      new OutputRelay(ptyManager as never, sendToRenderer(getWindow))
    )
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
        env: {
          TERMINATOR_ISSUE_KEY: 'TAV-42',
          TERMINATOR_ISSUE_TRACKER: 'linear',
          TERMINATOR_SESSION_ID: expect.any(String),
        },
      })
    )
  })

  // Every terminal names itself, linked or not (ADR 055): that is how an agent
  // started in it is matched to this session.
  it('passes only the terminal’s own name for an unlinked project', async () => {
    const ptyManager = makeFakePtyManager()
    await createTerminal(ptyManager)
    expect(ptyManager.spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({ env: { TERMINATOR_SESSION_ID: expect.any(String) } })
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
