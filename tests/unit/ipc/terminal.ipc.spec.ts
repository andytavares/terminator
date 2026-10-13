import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as os from 'node:os'
import { makeTempDir } from '../../support/temp-dir'

const { mockHandle, mockOn } = vi.hoisted(() => ({ mockHandle: vi.fn(), mockOn: vi.fn() }))
const paths = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => paths.userData, dock: null },
  ipcMain: { handle: mockHandle, on: mockOn, removeHandler: vi.fn() },
  Notification: { isSupported: () => false },
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('electron-store', async () =>
  (await import('../../support/stores')).inMemoryElectronStore()
)

import { registerTerminalHandlers, sendToRenderer } from '../../../src/main/ipc/terminal.ipc.js'
import { OutputRelay } from '../../../src/main/terminal/output-relay.js'
import { MissingCwdError } from '../../../src/main/terminal/pty-manager.js'
import type { SessionInfo, SpawnSessionOptions } from '@terminator/extension-sdk'
import { OUTPUT_FLUSH_INTERVAL_MS } from '../../../src/main/terminal/output-batcher.js'
import { HIGH_WATERMARK_CHARS } from '../../../src/main/terminal/flow-control.js'
import {
  updateGlobalSettings,
  updateWorkspaceSettings,
} from '../../../src/main/storage/settings-store.js'
import { createProject, createWorkspace } from '../../../src/main/storage/workspace-store.js'
import * as records from '../../../src/main/sessions/session-record-store.js'
import * as links from '../../../src/main/integrations/issue-link-store.js'
import { writeContextFile } from '../../../src/main/integrations/agent-context.js'
import { notificationManager } from '../../../src/main/notifications/notification-manager.js'

/** Each test starts from an empty user-data directory and an empty notification centre. */
beforeEach(async () => {
  paths.userData = makeTempDir('terminal-ipc-')
  await records.loadRecords()
  await links.loadLinks()
  for (const notification of notificationManager.list())
    notificationManager.dismissNotification(notification.id)
  updateGlobalSettings({ terminal: { defaultShell: '/bin/zsh' } })
})

/** A window that is open, and what was sent to it. */
function openWindow() {
  const send = vi.fn()
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } }
}

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

/** Output and exit listeners per session, and a way to fire them. */
function fakeSessionStreams(sessions: Map<string, SessionInfo>) {
  const dataListeners = new Map<string, Set<(data: string) => void>>()
  const exitListeners = new Map<string, Set<(code: number) => void>>()
  return {
    emitData(id: string, data: string) {
      dataListeners.get(id)?.forEach((l) => l(data))
    },
    emitExit(id: string, code: number) {
      sessions.delete(id)
      exitListeners.get(id)?.forEach((l) => l(code))
    },
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
  }
}

function makeFakePtyManager() {
  const sessions = new Map<string, SessionInfo>()
  return {
    sessions,
    ...fakeSessionStreams(sessions),
    spawnSession: vi.fn((opts: SpawnSessionOptions): SessionInfo => {
      const { sessionId, cwd, type, origin, projectId, tabTitle } = opts
      const info = { sessionId, cwd, type, origin, projectId, tabTitle, createdAt: 't', pid: 1 }
      sessions.set(sessionId, info)
      return { ...info }
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

let ptyManager: ReturnType<typeof makeFakePtyManager>
let webContentsSend: ReturnType<typeof vi.fn>
let win: ReturnType<typeof openWindow> | null

function useTerminalHandlers(): void {
  beforeEach(() => {
    vi.clearAllMocks()
    ptyManager = makeFakePtyManager()
    win = openWindow()
    webContentsSend = win.webContents.send
    const getWindow = () => win as never
    registerTerminalHandlers(
      ptyManager as never,
      getWindow,
      new OutputRelay(ptyManager as never, sendToRenderer(getWindow))
    )
  })
}

describe('registerTerminalHandlers — terminal:create', () => {
  useTerminalHandlers()

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
})

describe('registerTerminalHandlers — terminal:create output relay', () => {
  useTerminalHandlers()

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
    vi.useFakeTimers()
    const { sessionId } = (await invokeHandler('terminal:create')({}, VALID_CREATE)) as {
      sessionId: string
    }
    win = null
    ptyManager.emitData(sessionId, 'out')
    // The batch is flushed after the interval; asserting before it would pass either way.
    vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)
    expect(webContentsSend).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('registerTerminalHandlers — terminal:create environment', () => {
  useTerminalHandlers()

  it('resolves ~ to the home directory', async () => {
    await invokeHandler('terminal:create')({}, { ...VALID_CREATE, cwd: '~' })
    expect(ptyManager.spawnSession.mock.calls[0][0].cwd).toBe(os.homedir())
  })

  it('names the terminal in its environment, so an agent in it can be placed', async () => {
    const { sessionId } = (await invokeHandler('terminal:create')({}, VALID_CREATE)) as {
      sessionId: string
    }
    expect(ptyManager.spawnSession.mock.calls[0][0].env?.TERMINATOR_SESSION_ID).toBe(sessionId)
  })

  it('names it beside the linked issue, not instead of it', async () => {
    await links.setLink({ projectId: VALID_CREATE.projectId, tracker: 'linear', key: 'TAV-42' })
    await invokeHandler('terminal:create')({}, VALID_CREATE)
    expect(ptyManager.spawnSession.mock.calls[0][0].env).toMatchObject({
      TERMINATOR_ISSUE_KEY: 'TAV-42',
      TERMINATOR_SESSION_ID: expect.any(String),
    })
  })
})

describe('registerTerminalHandlers — terminal:create initial command and shell', () => {
  useTerminalHandlers()

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
})

describe('registerTerminalHandlers — terminal:create explicit shell', () => {
  useTerminalHandlers()

  it('honors an explicit shell over the settings default', async () => {
    await invokeHandler('terminal:create')({}, { ...VALID_CREATE, shell: '/bin/fish' })
    expect(ptyManager.spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({ shell: '/bin/fish' })
    )
  })
})

/** A project in a new workspace whose own default shell is `shell`. */
function projectInWorkspaceUsing(shell: string): string {
  const created = createWorkspace({ name: `ws ${shell}`, folderPath: '/repo', color: '', tags: [] })
  if (!('workspace' in created)) throw new Error('workspace not created')
  updateWorkspaceSettings(created.workspace.id, { terminal: { defaultShell: shell } })
  const made = createProject({
    workspaceId: created.workspace.id,
    name: 'main',
    worktreePath: '/repo',
    isWorktree: false,
  })
  if (!('project' in made)) throw new Error('project not created')
  return made.project.id
}

describe('registerTerminalHandlers — a workspace default shell', () => {
  useTerminalHandlers()

  it("opens a project's terminal in its workspace's own default shell", async () => {
    const projectId = projectInWorkspaceUsing('/bin/fish')
    const created = (await invokeHandler('terminal:create')(
      {},
      { ...VALID_CREATE, projectId }
    )) as {
      shell: string
    }
    expect(created.shell).toBe('/bin/fish')
    expect(ptyManager.spawnSession).toHaveBeenCalledWith(
      expect.objectContaining({ shell: '/bin/fish' })
    )
  })

  it('uses the global default shell for a project whose workspace sets none', async () => {
    const created = (await invokeHandler('terminal:create')({}, VALID_CREATE)) as { shell: string }
    expect(created.shell).toBe('/bin/zsh')
  })
})

describe('registerTerminalHandlers — terminal:list-sessions', () => {
  useTerminalHandlers()

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

describe('registerTerminalHandlers — terminal:attach', () => {
  useTerminalHandlers()

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

describe('registerTerminalHandlers — terminal:close / input / resize', () => {
  useTerminalHandlers()

  it('kills the session on close', async () => {
    const result = (await invokeHandler('terminal:close')({}, { sessionId: 's1' })) as {
      success: boolean
    }
    expect(result.success).toBe(true)
    expect(ptyManager.kill).toHaveBeenCalledWith('s1')
  })
})

describe('registerTerminalHandlers — terminal:close records', () => {
  useTerminalHandlers()

  it('closes the session record after killing the process', async () => {
    await records.setDescription(
      {
        sessionId: 's1',
        projectId: VALID_CREATE.projectId,
        workspaceName: null,
        projectName: null,
        branch: null,
        tabTitle: 'Terminal 1',
        shell: '/bin/zsh',
        startedAt: '2026-09-15T10:00:00.000Z',
      },
      'why'
    )
    const closedAt = () => records.listRecords().find((r) => r.sessionId === 's1')?.closedAt
    let closedAtKill: string | undefined = 'not killed'
    ptyManager.kill.mockImplementation(() => {
      closedAtKill = closedAt()
      return true
    })
    await invokeHandler('terminal:close')({}, { sessionId: 's1' })
    expect(closedAtKill).toBeUndefined()
    expect(closedAt()).toEqual(expect.any(String))
  })
})

describe('registerTerminalHandlers — terminal:input and acknowledge', () => {
  useTerminalHandlers()

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
})

describe('registerTerminalHandlers — acknowledgements and resize', () => {
  useTerminalHandlers()

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
})

describe('registerTerminalHandlers — terminal:resize', () => {
  useTerminalHandlers()

  it('resizes with valid dimensions and ignores invalid ones', async () => {
    sendHandler('terminal:resize')({}, { sessionId: 's1', cols: 120, rows: 40 })
    expect(ptyManager.resize).toHaveBeenCalledWith('s1', 120, 40)
    sendHandler('terminal:resize')({}, { sessionId: 's1', cols: -1, rows: 0 })
    expect(ptyManager.resize).toHaveBeenCalledTimes(1)
  })
})

describe('registerTerminalHandlers — a branch whose folder is gone', () => {
  useTerminalHandlers()

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

    await expect(invokeHandler('terminal:create')({}, VALID_CREATE)).rejects.toThrow('fork failed')
  })
})

describe('registerTerminalHandlers — terminal:close-all / cleanup-orphans', () => {
  useTerminalHandlers()

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

const P = '11111111-1111-4111-8111-111111111111'
let linkedWin: ReturnType<typeof openWindow>

async function createTerminal(ptyManager: ReturnType<typeof makeFakePtyManager>) {
  linkedWin = openWindow()
  const getWindow = () => linkedWin as never
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

const contextOf = (chars: number, truncated: boolean) => ({
  projectId: P,
  tracker: 'linear' as const,
  key: 'TAV-42',
  markdown: '# TAV-42',
  chars,
  truncated,
  builtAt: '2026-09-15T10:00:00.000Z',
})

const sentChannels = () => linkedWin.webContents.send.mock.calls.map(([channel]) => channel)

describe('terminal:create — linked issue', () => {
  it('passes the issue key and tracker into the session environment', async () => {
    await links.setLink({ projectId: P, tracker: 'linear', key: 'TAV-42' })
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
})

describe('terminal:create — linked issue notices', () => {
  it('tells the operator the session started with issue context (FR-024)', async () => {
    await links.setLink({ projectId: P, tracker: 'linear', key: 'TAV-42' })
    await writeContextFile(contextOf(2143, false))
    await createTerminal(makeFakePtyManager())

    await vi.waitFor(() =>
      expect(notificationManager.list()).toEqual([
        expect.objectContaining({ title: expect.stringContaining('TAV-42') }),
      ])
    )
    expect(sentChannels()).toContain('integrations:context-injected')
  })

  it('says how much context, and whether it was shortened', async () => {
    await links.setLink({ projectId: P, tracker: 'linear', key: 'TAV-42' })
    await writeContextFile(contextOf(9900, true))
    await createTerminal(makeFakePtyManager())

    await vi.waitFor(() => expect(notificationManager.list()).toHaveLength(1))
    const [notice] = notificationManager.list()
    expect(notice.message).toContain('9,900')
    expect(notice.message).toContain('shortened')
  })
})

describe('terminal:create — linked issue, nothing to say', () => {
  it('says nothing when injection is turned off for the project', async () => {
    await links.setLink({ projectId: P, tracker: 'linear', key: 'TAV-42', injectContext: false })
    await writeContextFile(contextOf(10, false))
    await createTerminal(makeFakePtyManager())
    await new Promise((r) => setImmediate(r))

    expect(notificationManager.list()).toEqual([])
    expect(sentChannels()).not.toContain('integrations:context-injected')
  })

  it('says nothing when no context has been written yet', async () => {
    await links.setLink({ projectId: P, tracker: 'linear', key: 'TAV-42' })
    await createTerminal(makeFakePtyManager())
    await new Promise((r) => setImmediate(r))
    expect(notificationManager.list()).toEqual([])
  })
})
