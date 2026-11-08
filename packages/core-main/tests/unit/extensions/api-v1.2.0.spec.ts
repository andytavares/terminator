import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// electron-store 12 refuses to open outside Electron; the stores this spec reaches live in memory.
vi.mock('electron-store', async () =>
  (await import('../../../../test-support/src/stores')).inMemoryElectronStore()
)

// ── Electron mock ────────────────────────────────────────────────────────────
const mockSend = vi.fn()
const mockWindow = {
  webContents: { send: mockSend, isDestroyed: vi.fn(() => false) },
  isDestroyed: vi.fn(() => false),
}
const registeredGlobalShortcuts = new Map<string, () => void>()

const mockBWInstance = vi.hoisted(() => ({
  focus: vi.fn(),
  isDestroyed: vi.fn(() => false),
  on: vi.fn(),
  loadURL: vi.fn(),
  loadFile: vi.fn(),
  webContents: { send: vi.fn(), on: vi.fn(), insertCSS: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('electron', () => ({
  BrowserWindow: Object.assign(
    vi.fn(function () {
      return mockBWInstance
    }),
    {
      getAllWindows: vi.fn(() => [mockWindow]),
    }
  ),
  Menu: {
    getApplicationMenu: vi.fn(() => null),
    buildFromTemplate: vi.fn((t) => t),
    setApplicationMenu: vi.fn(),
  },
  MenuItem: vi.fn().mockImplementation(function (opts) {
    return opts
  }),
  globalShortcut: {
    register: vi.fn((accel: string, handler: () => void) => {
      registeredGlobalShortcuts.set(accel, handler)
      return true
    }),
    unregister: vi.fn((accel: string) => {
      registeredGlobalShortcuts.delete(accel)
    }),
    isRegistered: vi.fn((accel: string) => registeredGlobalShortcuts.has(accel)),
  },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}))

// ── Storage mock ─────────────────────────────────────────────────────────────
vi.mock('../../../src/storage/extension-settings-store', () => ({
  getExtensionSetting: () => undefined,
  setExtensionSetting: vi.fn(),
  getAllExtensionSettings: () => ({}),
}))

// ── Shell mock ───────────────────────────────────────────────────────────────
vi.mock('../../../src/shell/shell-executor', () => ({
  execShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
  assertCommandAllowed: vi.fn(),
}))

// ── Workspace store mock ─────────────────────────────────────────────────────
const mockWorkspaces = [
  { id: 'ws-1', name: 'Alpha', folderPath: '/projects/alpha', color: undefined, tags: [] },
  { id: 'ws-2', name: 'Beta', folderPath: '/projects/beta', color: undefined, tags: [] },
]
const mockProjects = [
  { id: 'proj-1', workspaceId: 'ws-1', name: 'App', gitBranch: 'main', worktreePath: '/wt/app' },
  { id: 'proj-2', workspaceId: 'ws-1', name: 'API', gitBranch: 'main', worktreePath: '/wt/api' },
]

vi.mock('../../../src/storage/workspace-store', () => ({
  listWorkspaces: vi.fn(() => mockWorkspaces),
  listProjects: vi.fn((wsId: string) => mockProjects.filter((p) => p.workspaceId === wsId)),
}))

// ── Logger mock ─────────────────────────────────────────────────────────────
vi.mock('../../../src/logger', () => ({
  makeLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

// ────────────────────────────────────────────────────────────────────────────

import { createExtensionAPI } from '../../../src/extensions/api'
import { setExtensionSetting } from '../../../src/storage/extension-settings-store'
import { EventEmitter } from 'events'
import type { ExtensionAPI, SessionInfo } from '@terminator/extension-sdk'
import type { PtyManager } from '../../../src/terminal/pty-manager'
import { partialFake } from '../../../../test-support/src/fakes'

beforeEach(() => {
  vi.clearAllMocks()
  registeredGlobalShortcuts.clear()
})

// ── globalShortcut ───────────────────────────────────────────────────────────

describe('api.globalShortcut.register', () => {
  it('calls Electron globalShortcut.register with the given accelerator', async () => {
    const { globalShortcut: electronGS } = await import('electron')
    const api = createExtensionAPI('test.gs')
    const handler = vi.fn()

    await api.globalShortcut.register('CmdOrCtrl+Shift+Space', handler)

    expect(electronGS.register).toHaveBeenCalledWith('CmdOrCtrl+Shift+Space', expect.any(Function))
  })

  it('returns a Disposable that unregisters the shortcut on dispose', async () => {
    const { globalShortcut: electronGS } = await import('electron')
    const api = createExtensionAPI('test.gs2')

    const d = await api.globalShortcut.register('CmdOrCtrl+Shift+Y', vi.fn())
    d.dispose()

    expect(electronGS.unregister).toHaveBeenCalledWith('CmdOrCtrl+Shift+Y')
  })

  it('rejects if Electron reports the accelerator is already registered', async () => {
    const { globalShortcut: electronGS } = await import('electron')
    vi.mocked(electronGS.register).mockReturnValueOnce(false)
    const api = createExtensionAPI('test.gs3')

    await expect(api.globalShortcut.register('CmdOrCtrl+Shift+Q', vi.fn())).rejects.toThrow(
      'ACCELERATOR_TAKEN'
    )
  })
})

// ── workspace ────────────────────────────────────────────────────────────────

describe('api.workspace.list', () => {
  it('returns each workspace with only its id, name and folder', () => {
    const api = createExtensionAPI('test.ws')

    expect(api.workspace.list()).toEqual([
      { id: 'ws-1', name: 'Alpha', folderPath: '/projects/alpha' },
      { id: 'ws-2', name: 'Beta', folderPath: '/projects/beta' },
    ])
  })
})

describe('api.workspace.listProjects', () => {
  it('returns each project of the workspace with only its id, workspace, name and worktree', () => {
    const api = createExtensionAPI('test.ws2')

    expect(api.workspace.listProjects('ws-1')).toEqual([
      { id: 'proj-1', workspaceId: 'ws-1', name: 'App', worktreePath: '/wt/app' },
      { id: 'proj-2', workspaceId: 'ws-1', name: 'API', worktreePath: '/wt/api' },
    ])
  })
})

// ── settings.set ─────────────────────────────────────────────────────────────

describe('api.settings.set', () => {
  it('persists the value via setExtensionSetting', () => {
    const api = createExtensionAPI('test.set')
    api.settings.set('myKey', 'myValue')
    expect(vi.mocked(setExtensionSetting)).toHaveBeenCalledWith('myKey', 'myValue')
  })
})

// ── sidebar.registerItem ──────────────────────────────────────────────────────

// ── fs.watch ─────────────────────────────────────────────────────────────────

// ── ipc bridge channels ───────────────────────────────────────────────────────

describe('api.ipc bridge channels', () => {
  it('invokeChannel calls the registered handler and returns its result', async () => {
    const handler = vi.fn().mockResolvedValue('result')
    const bridge = {
      invokeRegistry: new Map([['my:channel', { handler, remoteAccessible: false }]]),
      sendRegistry: new Map<string, (e: never, p: unknown) => void>(),
      eventBus: new EventEmitter(),
    }
    const api = createExtensionAPI('test.ipc', { bridge })
    const result = await api.ipc.invokeChannel('my:channel', { data: 1 })
    expect(result).toBe('result')
    expect(handler).toHaveBeenCalledWith(null, { data: 1 })
  })

  it('invokeChannel returns undefined when channel is not registered', async () => {
    const bridge = {
      invokeRegistry: new Map(),
      sendRegistry: new Map<string, (e: never, p: unknown) => void>(),
      eventBus: new EventEmitter(),
    }
    const api = createExtensionAPI('test.ipc2', { bridge })
    const result = await api.ipc.invokeChannel('missing:channel', {})
    expect(result).toBeUndefined()
  })
})

describe('api.ipc bridge channels — send', () => {
  it('sendChannel calls the registered handler', () => {
    const handler = vi.fn()
    const bridge = {
      invokeRegistry: new Map(),
      sendRegistry: new Map<string, (e: never, p: unknown) => void>([['my:send', handler]]),
      eventBus: new EventEmitter(),
    }
    const api = createExtensionAPI('test.ipc3', { bridge })
    api.ipc.sendChannel('my:send', { payload: 42 })
    expect(handler).toHaveBeenCalledWith(null, { payload: 42 })
  })

  it('sendChannel is a no-op when channel is not registered', () => {
    const bridge = {
      invokeRegistry: new Map(),
      sendRegistry: new Map<string, (e: never, p: unknown) => void>(),
      eventBus: new EventEmitter(),
    }
    const api = createExtensionAPI('test.ipc4', { bridge })
    expect(() => api.ipc.sendChannel('missing:send', {})).not.toThrow()
  })
})

describe('api.ipc bridge channels — window events and remote access', () => {
  it('onWindowEvent subscribes and unsubscribes from the event bus', () => {
    const eventBus = new EventEmitter()
    const bridge = {
      invokeRegistry: new Map(),
      sendRegistry: new Map<string, (e: never, p: unknown) => void>(),
      eventBus,
    }
    const api = createExtensionAPI('test.ipc5', { bridge })
    const handler = vi.fn()
    const unsub = api.ipc.onWindowEvent('my:event', handler)
    eventBus.emit('my:event', 'arg1', 'arg2')
    expect(handler).toHaveBeenCalledWith('arg1', 'arg2')
    unsub()
    eventBus.emit('my:event', 'arg3')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('isRemoteAccessible: true for allowlisted core channels', async () => {
    const api = createExtensionAPI('test.ipc6', {})
    expect(await api.ipc.isRemoteAccessible('workspace:list')).toBe(true)
  })

  it('isRemoteAccessible: false for channels with no registered handler and not in allowlist', async () => {
    // No bridge provided → invokeRegistry check returns false
    const api = createExtensionAPI('test.ipc6', {})
    expect(await api.ipc.isRemoteAccessible('dialog:open-directory')).toBe(false)
    expect(await api.ipc.isRemoteAccessible('no-such-channel')).toBe(false)
  })
})

describe('api.ipc bridge channels — declared remote access', () => {
  it('isRemoteAccessible: true for extension channels declared remoteAccessible at registration', async () => {
    // Extension channels that registered with { remoteAccessible: true } are what
    // these registry entries reflect.
    const invokeRegistry = new Map([
      ['terminator.notepad:notes.list', { handler: vi.fn(), remoteAccessible: true }],
      ['task-vault:vault:get-today', { handler: vi.fn(), remoteAccessible: true }],
    ])
    const eventBus = new EventEmitter()
    const api = createExtensionAPI('test.ipc6', {
      bridge: { invokeRegistry, sendRegistry: new Map(), eventBus },
    })
    expect(await api.ipc.isRemoteAccessible('terminator.notepad:notes.list')).toBe(true)
    expect(await api.ipc.isRemoteAccessible('task-vault:vault:get-today')).toBe(true)
    // channels not in registry remain blocked even with a bridge
    expect(await api.ipc.isRemoteAccessible('dialog:open-directory')).toBe(false)
  })
})

// ── pty ──────────────────────────────────────────────────────────────────────

const sessionInfo: SessionInfo = {
  sessionId: 's1',
  cwd: '/cwd',
  type: 'human',
  origin: 'app',
  createdAt: 't',
  pid: 1,
}
const otherSession: SessionInfo = { ...sessionInfo, sessionId: 's2' }
const mockPtyManager = partialFake<PtyManager>({
  spawnSession: vi.fn(() => sessionInfo),
  onData: vi.fn(() => () => {}),
  onExit: vi.fn(() => () => {}),
  getSession: vi.fn(() => sessionInfo),
  setWorkspace: vi.fn(() => true),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  listSessions: vi.fn(() => [sessionInfo, otherSession]),
})

describe('api.pty — session authority surface (v1.4.0)', () => {
  it('spawnSession hands the options to the ptyManager', async () => {
    const api = createExtensionAPI('test.pty10', { ptyManager: mockPtyManager })
    const opts = {
      sessionId: 's1',
      cwd: '/cwd',
      shell: '/bin/zsh',
      type: 'human' as const,
      origin: 'remote' as const,
    }
    await api.pty.spawnSession(opts)
    expect(mockPtyManager.spawnSession).toHaveBeenCalledWith(opts)
  })

  it('spawnSession rejects without a ptyManager in context', async () => {
    const api = createExtensionAPI('test.pty11', {})
    await expect(
      api.pty.spawnSession({
        sessionId: 's',
        cwd: '/',
        shell: '/bin/sh',
        type: 'human',
        origin: 'app',
      })
    ).rejects.toThrow('PTY access not available')
  })
})

describe('api.pty — session authority surface, streams and lookups', () => {
  it('onData/onExit subscribe to the session, and do nothing without a ptyManager', () => {
    const api = createExtensionAPI('test.pty12', { ptyManager: mockPtyManager })
    api.pty.onData('s1', vi.fn())
    api.pty.onExit('s1', vi.fn())
    expect(mockPtyManager.onData).toHaveBeenCalledWith('s1', expect.any(Function))
    expect(mockPtyManager.onExit).toHaveBeenCalledWith('s1', expect.any(Function))
    const bare = createExtensionAPI('test.pty13', {})
    expect(bare.pty.onData('s1', vi.fn())()).toBeUndefined()
    expect(bare.pty.onExit('s1', vi.fn())()).toBeUndefined()
  })
})

type Pty = ExtensionAPI['pty']

describe('api.pty — with ptyManager', () => {
  it.each([
    {
      name: 'write',
      call: (pty: Pty) => pty.write('s1', 'hello'),
      managerMethod: mockPtyManager.write,
      args: ['s1', 'hello'],
    },
    {
      name: 'resize',
      call: (pty: Pty) => pty.resize('s1', 80, 24),
      managerMethod: mockPtyManager.resize,
      args: ['s1', 80, 24],
    },
    {
      name: 'kill',
      call: (pty: Pty) => pty.kill('s1'),
      managerMethod: mockPtyManager.kill,
      args: ['s1'],
    },
  ])('$name delegates to the same ptyManager method', ({ call, managerMethod, args }) => {
    const api = createExtensionAPI('test.pty2', { ptyManager: mockPtyManager })
    call(api.pty)
    expect(managerMethod).toHaveBeenCalledWith(...args)
  })
})

describe('api.pty — with ptyManager, lookups', () => {
  it.each([
    {
      name: 'getSession',
      call: (pty: Pty) => pty.getSession('s1'),
      managerMethod: mockPtyManager.getSession,
      args: ['s1'],
    },
    {
      name: 'setWorkspace',
      call: (pty: Pty) => pty.setWorkspace('s1', 'ws-1'),
      managerMethod: mockPtyManager.setWorkspace,
      args: ['s1', 'ws-1'],
    },
    {
      name: 'listSessions',
      call: (pty: Pty) => pty.listSessions(),
      managerMethod: mockPtyManager.listSessions,
      args: [],
    },
  ])('$name asks the ptyManager', async ({ call, managerMethod, args }) => {
    const api = createExtensionAPI('test.pty3', { ptyManager: mockPtyManager })
    await call(api.pty)
    expect(managerMethod).toHaveBeenCalledWith(...args)
  })
})

describe('api.pty — without ptyManager', () => {
  it.each([
    ['listSessions', (pty: Pty) => pty.listSessions(), []],
    ['getSession', (pty: Pty) => pty.getSession('s1'), undefined],
    ['setWorkspace', (pty: Pty) => pty.setWorkspace('s1', 'ws-1'), false],
  ])('%s answers %j', async (_name, call, expected) => {
    const api = createExtensionAPI('test.pty.nopty5')
    expect(await call(api.pty)).toEqual(expected)
  })

  it.each([
    ['write', (pty: Pty) => pty.write('s1', 'hello')],
    ['resize', (pty: Pty) => pty.resize('s1', 80, 24)],
    ['kill', (pty: Pty) => pty.kill('s1')],
  ])('%s is a no-op and does not throw', (_name, call) => {
    const api = createExtensionAPI('test.pty.nopty2')
    expect(() => call(api.pty)).not.toThrow()
  })
})

// ── window.broadcast ─────────────────────────────────────────────────────────

describe('api.window.broadcast', () => {
  it('calls deps.broadcastToWindows when provided', () => {
    const broadcastToWindows = vi.fn()
    const api = createExtensionAPI('test.bcast', { broadcastToWindows })
    api.window.broadcast('my:event', { data: 1 })
    expect(broadcastToWindows).toHaveBeenCalledWith('my:event', { data: 1 })
  })

  it('falls back to BrowserWindow.getAllWindows() when no broadcastToWindows dep', async () => {
    const { BrowserWindow } = await import('electron')
    const api = createExtensionAPI('test.bcast2')
    api.window.broadcast('my:event', { data: 2 })
    expect(BrowserWindow.getAllWindows).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith('my:event', { data: 2 })
  })
})

// ── window.openAuxiliary ─────────────────────────────────────────────────────

describe('api.window.openAuxiliary', () => {
  it('opens a new BrowserWindow for a new view', async () => {
    const { BrowserWindow } = await import('electron')
    const api = createExtensionAPI('test.aux')
    api.window.openAuxiliary('test-view-new-1')
    expect(BrowserWindow).toHaveBeenCalled()
  })

  it('focuses the existing window when called again for the same view', async () => {
    const { BrowserWindow } = await import('electron')
    const api = createExtensionAPI('test.aux2')
    api.window.openAuxiliary('test-view-new-2')
    vi.mocked(BrowserWindow).mockClear()
    mockBWInstance.isDestroyed.mockReturnValueOnce(false)
    api.window.openAuxiliary('test-view-new-2')
    expect(BrowserWindow).not.toHaveBeenCalled()
    expect(mockBWInstance.focus).toHaveBeenCalled()
  })

  it('opens a new window when the existing one is destroyed', async () => {
    const { BrowserWindow } = await import('electron')
    const api = createExtensionAPI('test.aux3')
    api.window.openAuxiliary('test-view-new-3')
    vi.mocked(BrowserWindow).mockClear()
    mockBWInstance.isDestroyed.mockReturnValueOnce(true)
    api.window.openAuxiliary('test-view-new-3')
    expect(BrowserWindow).toHaveBeenCalled()
  })
})

describe("api.window.openAuxiliary — the extension's own renderer", () => {
  it('loads the rendererUrl directly when provided, appending query params', () => {
    const rendererUrl = 'ext://com.test.ext/index.html'
    const api = createExtensionAPI('test.aux-url', undefined, rendererUrl)
    api.window.openAuxiliary('my-view', { extra: 'val' })
    expect(mockBWInstance.loadURL).toHaveBeenCalledWith(expect.stringContaining('ext://'))
    expect(mockBWInstance.loadURL).toHaveBeenCalledWith(expect.stringContaining('view=my-view'))
    expect(mockBWInstance.loadURL).toHaveBeenCalledWith(expect.stringContaining('extra=val'))
  })

  it('TAV-6: re-navigates an already-open window when called again with params', () => {
    const rendererUrl = 'ext://com.test.ext/index.html'
    const api = createExtensionAPI('test.aux-renav', undefined, rendererUrl)
    api.window.openAuxiliary('pr-review', { repoRoot: '/repo' })
    vi.mocked(mockBWInstance.loadURL).mockClear()
    mockBWInstance.isDestroyed.mockReturnValueOnce(false)

    // Popping out again while reviewing a specific PR must carry the PR
    // context through to the already-open window, not just refocus it as-is.
    api.window.openAuxiliary('pr-review', { repoRoot: '/repo', prNumber: '49' })

    expect(mockBWInstance.loadURL).toHaveBeenCalledWith(expect.stringContaining('prNumber=49'))
    expect(mockBWInstance.focus).toHaveBeenCalled()
  })

  it('does not re-navigate an already-open window when called again with no params', () => {
    const rendererUrl = 'ext://com.test.ext/index.html'
    const api = createExtensionAPI('test.aux-bare', undefined, rendererUrl)
    api.window.openAuxiliary('pr-review', { repoRoot: '/repo', prNumber: '49' })
    vi.mocked(mockBWInstance.loadURL).mockClear()
    mockBWInstance.isDestroyed.mockReturnValueOnce(false)

    // A bare re-open (e.g. the "Code Reviews in New Window" menu item, which
    // always passes {}) should just refocus the window as-is, not reset it.
    api.window.openAuxiliary('pr-review', {})

    expect(mockBWInstance.loadURL).not.toHaveBeenCalled()
    expect(mockBWInstance.focus).toHaveBeenCalled()
  })
})

/** A BrowserWindow that emits its own events to the listeners openAuxiliary adds. */
function emittingWindow() {
  const webContents = Object.assign(new EventEmitter(), {
    send: vi.fn(),
    insertCSS: vi.fn().mockResolvedValue(undefined),
  })
  return Object.assign(new EventEmitter(), {
    focus: vi.fn(),
    isDestroyed: () => false,
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    webContents,
  })
}

describe('api.window.openAuxiliary — window lifecycle and sources', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('opens a new window once the previous one for the view has closed', async () => {
    const { BrowserWindow } = await import('electron')
    const auxWindow = emittingWindow()
    vi.mocked(BrowserWindow).mockImplementationOnce(function () {
      return auxWindow
    })
    const api = createExtensionAPI('test.aux-closed')
    api.window.openAuxiliary('test-view-closed')
    auxWindow.emit('closed')
    vi.mocked(BrowserWindow).mockClear()
    api.window.openAuxiliary('test-view-closed')
    expect(BrowserWindow).toHaveBeenCalled()
  })
})

describe('api.window.openAuxiliary — design tokens and the dev server', () => {
  afterEach(() => vi.unstubAllEnvs())

  it("gives an extension's own window the design tokens once it has loaded", async () => {
    const { BrowserWindow } = await import('electron')
    const auxWindow = emittingWindow()
    vi.mocked(BrowserWindow).mockImplementationOnce(function () {
      return auxWindow
    })
    const api = createExtensionAPI('test.aux-css', undefined, 'ext://com.css/index.html')
    api.window.openAuxiliary('test-view-css')
    auxWindow.webContents.emit('did-finish-load')
    expect(auxWindow.webContents.insertCSS).toHaveBeenCalledWith(expect.stringContaining('--tm-'))
  })

  it('loads the app renderer from the dev server when one is running', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    const api = createExtensionAPI('test.aux-dev')
    api.window.openAuxiliary('test-view-dev', { a: '1' })
    expect(mockBWInstance.loadURL).toHaveBeenCalledWith(
      'http://localhost:5173?view=test-view-dev&a=1'
    )
  })
})

// ── window.focusSelf ──────────────────────────────────────────────────────────

describe('api.window.focusSelf', () => {
  it('calls deps.focusExtensionView with the extensionId and viewParam', () => {
    const mockFocusExtensionView = vi.fn()
    const api = createExtensionAPI('test.focus', {
      focusExtensionView: mockFocusExtensionView,
    })
    api.window.focusSelf('sidebar')
    expect(mockFocusExtensionView).toHaveBeenCalledWith('test.focus', 'sidebar')
  })

  it('uses "main" as the default viewParam', () => {
    const mockFocusExtensionView = vi.fn()
    const api = createExtensionAPI('test.focus2', {
      focusExtensionView: mockFocusExtensionView,
    })
    api.window.focusSelf()
    expect(mockFocusExtensionView).toHaveBeenCalledWith('test.focus2', 'main')
  })

  it('is a no-op when focusExtensionView is not provided', () => {
    const api = createExtensionAPI('test.focus3')
    expect(() => api.window.focusSelf()).not.toThrow()
  })
})
