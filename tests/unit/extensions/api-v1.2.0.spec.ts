import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Electron mock ────────────────────────────────────────────────────────────
const mockSend = vi.fn()
const mockWindow = { webContents: { send: mockSend }, isDestroyed: vi.fn(() => false) }
const registeredGlobalShortcuts = new Map<string, () => void>()

const mockBWInstance = vi.hoisted(() => ({
  focus: vi.fn(),
  isDestroyed: vi.fn(() => false),
  on: vi.fn(),
  loadURL: vi.fn(),
  loadFile: vi.fn(),
  webContents: { send: vi.fn() },
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
vi.mock('../../../src/main/storage/extension-settings-store', () => ({
  getExtensionSetting: () => undefined,
  setExtensionSetting: vi.fn(),
  getAllExtensionSettings: () => ({}),
}))

// ── Shell mock ───────────────────────────────────────────────────────────────
vi.mock('../../../src/main/shell/shell-executor', () => ({
  execShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
  assertCommandAllowed: vi.fn(),
}))

// ── Workspace store mock ─────────────────────────────────────────────────────
const mockWorkspaces = [
  { id: 'ws-1', name: 'Alpha', folderPath: '/projects/alpha', color: undefined, tags: [] },
  { id: 'ws-2', name: 'Beta', folderPath: '/projects/beta', color: undefined, tags: [] },
]
const mockProjects = [
  { id: 'proj-1', workspaceId: 'ws-1', name: 'App', gitBranch: 'main' },
  { id: 'proj-2', workspaceId: 'ws-1', name: 'API', gitBranch: 'main' },
]

vi.mock('../../../src/main/storage/workspace-store', () => ({
  listWorkspaces: vi.fn(() => mockWorkspaces),
  listProjects: vi.fn((wsId: string) => mockProjects.filter((p) => p.workspaceId === wsId)),
}))

// ── FS watcher mock ─────────────────────────────────────────────────────────
vi.mock('../../../src/main/fs/fs-watcher', () => ({
  fsWatcherService: { addHandler: vi.fn(), removeHandler: vi.fn() },
}))

// ── Logger mock ─────────────────────────────────────────────────────────────
vi.mock('../../../src/main/logger', () => ({
  makeLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

// ────────────────────────────────────────────────────────────────────────────

import { createExtensionAPI, globalRegistry } from '../../../src/main/extensions/api'
import {
  emitWorkspaceDelete,
  emitProjectDelete,
} from '../../../src/main/extensions/workspace-events'
import { setExtensionSetting } from '../../../src/main/storage/extension-settings-store'
import { fsWatcherService } from '../../../src/main/fs/fs-watcher'
import { EventEmitter } from 'events'

beforeEach(() => {
  vi.clearAllMocks()
  registeredGlobalShortcuts.clear()
  globalRegistry.sidebarPanels.clear()
  globalRegistry.globalTabs?.clear()
  globalRegistry.sidebarItems?.clear()
})

// ── sidebar.registerGlobalTab ────────────────────────────────────────────────

describe('api.sidebar.registerGlobalTab', () => {
  it('registers a global tab in the registry', () => {
    const api = createExtensionAPI('test.vault', '0.1.0')
    const tab = { id: 'task-vault', label: 'Task Vault', component: () => null, permanent: true }

    api.sidebar.registerGlobalTab(tab)

    expect(globalRegistry.globalTabs.size).toBe(1)
    expect(globalRegistry.globalTabs.get('test.vault.globaltab.task-vault')).toMatchObject({
      id: 'task-vault',
      label: 'Task Vault',
    })
  })

  it('returns a Disposable that removes the tab on dispose', () => {
    const api = createExtensionAPI('test.vault2', '0.1.0')
    const tab = { id: 'task-vault', label: 'Task Vault', component: () => null }

    const d = api.sidebar.registerGlobalTab(tab)
    expect(globalRegistry.globalTabs.size).toBe(1)

    d.dispose()
    expect(globalRegistry.globalTabs.size).toBe(0)
  })

  it('throws if the same tab id is registered twice by the same extension', () => {
    const api = createExtensionAPI('test.vault3', '0.1.0')
    const tab = { id: 'task-vault', label: 'Task Vault', component: () => null }

    api.sidebar.registerGlobalTab(tab)
    expect(() => api.sidebar.registerGlobalTab(tab)).toThrow('GLOBAL_TAB_ALREADY_REGISTERED')
  })
})

// ── globalShortcut ───────────────────────────────────────────────────────────

describe('api.globalShortcut.register', () => {
  it('calls Electron globalShortcut.register with the given accelerator', async () => {
    const { globalShortcut: electronGS } = await import('electron')
    const api = createExtensionAPI('test.gs', '0.1.0')
    const handler = vi.fn()

    api.globalShortcut.register('CmdOrCtrl+Shift+Space', handler)

    expect(electronGS.register).toHaveBeenCalledWith('CmdOrCtrl+Shift+Space', expect.any(Function))
  })

  it('returns a Disposable that unregisters the shortcut on dispose', async () => {
    const { globalShortcut: electronGS } = await import('electron')
    const api = createExtensionAPI('test.gs2', '0.1.0')

    const d = api.globalShortcut.register('CmdOrCtrl+Shift+Y', vi.fn())
    d.dispose()

    expect(electronGS.unregister).toHaveBeenCalledWith('CmdOrCtrl+Shift+Y')
  })

  it('throws if Electron reports the accelerator is already registered', async () => {
    const { globalShortcut: electronGS } = await import('electron')
    vi.mocked(electronGS.register).mockReturnValueOnce(false as unknown as boolean)
    const api = createExtensionAPI('test.gs3', '0.1.0')

    expect(() => api.globalShortcut.register('CmdOrCtrl+Shift+Q', vi.fn())).toThrow(
      'ACCELERATOR_TAKEN'
    )
  })
})

// ── workspace ────────────────────────────────────────────────────────────────

describe('api.workspace.list', () => {
  it('returns WorkspaceSnapshot[] from the workspace store', () => {
    const api = createExtensionAPI('test.ws', '0.1.0')

    const result = api.workspace.list()

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'ws-1', name: 'Alpha', folderPath: '/projects/alpha' })
    expect(result[1]).toMatchObject({ id: 'ws-2', name: 'Beta', folderPath: '/projects/beta' })
  })
})

describe('api.workspace.listProjects', () => {
  it('returns ProjectSnapshot[] for the given workspace', () => {
    const api = createExtensionAPI('test.ws2', '0.1.0')

    const result = api.workspace.listProjects('ws-1')

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'proj-1', workspaceId: 'ws-1', name: 'App' })
  })
})

describe('api.workspace.onDelete', () => {
  it('calls registered handler when a workspace is deleted', () => {
    const api = createExtensionAPI('test.ws3', '0.1.0')
    const handler = vi.fn()

    api.workspace.onDelete(handler)
    emitWorkspaceDelete('ws-1')

    expect(handler).toHaveBeenCalledWith('ws-1')
  })

  it('returns a Disposable that stops receiving events', () => {
    const api = createExtensionAPI('test.ws4', '0.1.0')
    const handler = vi.fn()

    const d = api.workspace.onDelete(handler)
    d.dispose()
    emitWorkspaceDelete('ws-2')

    expect(handler).not.toHaveBeenCalled()
  })
})

describe('api.workspace.onProjectDelete', () => {
  it('calls registered handler when a project is deleted', () => {
    const api = createExtensionAPI('test.ws5', '0.1.0')
    const handler = vi.fn()

    api.workspace.onProjectDelete(handler)
    emitProjectDelete('proj-1')

    expect(handler).toHaveBeenCalledWith('proj-1')
  })

  it('returns a Disposable that stops receiving events', () => {
    const api = createExtensionAPI('test.ws6', '0.1.0')
    const handler = vi.fn()

    const d = api.workspace.onProjectDelete(handler)
    d.dispose()
    emitProjectDelete('proj-2')

    expect(handler).not.toHaveBeenCalled()
  })
})

// ── settings.set ─────────────────────────────────────────────────────────────

describe('api.settings.set', () => {
  it('persists the value via setExtensionSetting', () => {
    const api = createExtensionAPI('test.set', '0.1.0')
    api.settings.set('myKey', 'myValue')
    expect(vi.mocked(setExtensionSetting)).toHaveBeenCalledWith('myKey', 'myValue')
  })
})

// ── sidebar.registerItem ──────────────────────────────────────────────────────

describe('api.sidebar.registerItem', () => {
  it('registers an item in the global registry', () => {
    const api = createExtensionAPI('test.sbi', '0.1.0')
    const item = { id: 'my-item', label: 'My Item' } as never
    api.sidebar.registerItem(item)
    expect(globalRegistry.sidebarItems.get('test.sbi.sidebar.my-item')).toBe(item)
  })

  it('returns a Disposable that removes the item on dispose', () => {
    const api = createExtensionAPI('test.sbi2', '0.1.0')
    const item = { id: 'my-item', label: 'My Item' } as never
    const d = api.sidebar.registerItem(item)
    d.dispose()
    expect(globalRegistry.sidebarItems.has('test.sbi2.sidebar.my-item')).toBe(false)
  })
})

// ── fs.watch ─────────────────────────────────────────────────────────────────

describe('api.fs.watch', () => {
  it('registers the handler with fsWatcherService', () => {
    const api = createExtensionAPI('test.fs', '0.1.0')
    const handler = vi.fn()
    api.fs.watch(handler)
    expect(vi.mocked(fsWatcherService.addHandler)).toHaveBeenCalledWith(handler)
  })

  it('returns a Disposable that removes the handler on dispose', () => {
    const api = createExtensionAPI('test.fs2', '0.1.0')
    const handler = vi.fn()
    const d = api.fs.watch(handler)
    d.dispose()
    expect(vi.mocked(fsWatcherService.removeHandler)).toHaveBeenCalledWith(handler)
  })
})

// ── ipc bridge channels ───────────────────────────────────────────────────────

describe('api.ipc bridge channels', () => {
  it('invokeChannel calls the registered handler and returns its result', async () => {
    const handler = vi.fn().mockResolvedValue('result')
    const bridge = {
      invokeRegistry: new Map([['my:channel', { handler, remoteAccessible: false }]]),
      sendRegistry: new Map<string, (e: never, p: unknown) => void>(),
      eventBus: new EventEmitter(),
    }
    const api = createExtensionAPI('test.ipc', '0.1.0', { bridge })
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
    const api = createExtensionAPI('test.ipc2', '0.1.0', { bridge })
    const result = await api.ipc.invokeChannel('missing:channel', {})
    expect(result).toBeUndefined()
  })

  it('sendChannel calls the registered handler', () => {
    const handler = vi.fn()
    const bridge = {
      invokeRegistry: new Map(),
      sendRegistry: new Map<string, (e: never, p: unknown) => void>([['my:send', handler]]),
      eventBus: new EventEmitter(),
    }
    const api = createExtensionAPI('test.ipc3', '0.1.0', { bridge })
    api.ipc.sendChannel('my:send', { payload: 42 })
    expect(handler).toHaveBeenCalledWith(null, { payload: 42 })
  })

  it('sendChannel is a no-op when channel is not registered', () => {
    const bridge = {
      invokeRegistry: new Map(),
      sendRegistry: new Map<string, (e: never, p: unknown) => void>(),
      eventBus: new EventEmitter(),
    }
    const api = createExtensionAPI('test.ipc4', '0.1.0', { bridge })
    expect(() => api.ipc.sendChannel('missing:send', {})).not.toThrow()
  })

  it('onWindowEvent subscribes and unsubscribes from the event bus', () => {
    const eventBus = new EventEmitter()
    const bridge = {
      invokeRegistry: new Map(),
      sendRegistry: new Map<string, (e: never, p: unknown) => void>(),
      eventBus,
    }
    const api = createExtensionAPI('test.ipc5', '0.1.0', { bridge })
    const handler = vi.fn()
    const unsub = api.ipc.onWindowEvent('my:event', handler)
    eventBus.emit('my:event', 'arg1', 'arg2')
    expect(handler).toHaveBeenCalledWith('arg1', 'arg2')
    unsub()
    eventBus.emit('my:event', 'arg3')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('isRemoteAccessible: true for allowlisted core channels', () => {
    const api = createExtensionAPI('test.ipc6', '0.1.0', {})
    expect(api.ipc.isRemoteAccessible('workspace:list')).toBe(true)
  })

  it('isRemoteAccessible: false for channels with no registered handler and not in allowlist', () => {
    // No bridge provided → invokeRegistry check returns false
    const api = createExtensionAPI('test.ipc6', '0.1.0', {})
    expect(api.ipc.isRemoteAccessible('dialog:open-directory')).toBe(false)
    expect(api.ipc.isRemoteAccessible('no-such-channel')).toBe(false)
  })

  it('isRemoteAccessible: true for extension channels registered in invokeRegistry', () => {
    // Dot-prefixed channels (notepad) and short-prefixed channels (task-vault) both work
    // as long as they have a registered handler in invokeRegistry
    const invokeRegistry = new Map([
      ['terminator.notepad:notes.list', { handler: vi.fn(), remoteAccessible: false }],
      ['task-vault:vault:get-today', { handler: vi.fn(), remoteAccessible: false }],
    ])
    const eventBus = new EventEmitter()
    const api = createExtensionAPI('test.ipc6', '0.1.0', {
      bridge: { invokeRegistry, sendRegistry: new Map(), eventBus },
    })
    expect(api.ipc.isRemoteAccessible('terminator.notepad:notes.list')).toBe(true)
    expect(api.ipc.isRemoteAccessible('task-vault:vault:get-today')).toBe(true)
    // channels not in registry remain blocked even with a bridge
    expect(api.ipc.isRemoteAccessible('dialog:open-directory')).toBe(false)
  })

  it('isRemoteAccessible: any channel in invokeRegistry is accessible (design intent — all registered channels are extension-owned or explicitly allowlisted)', () => {
    // This is the regression test for the registry-based design: the `remoteAccessible` flag
    // on registry entries is intentionally ignored. Access is gated by registry presence only,
    // so adding a channel to the registry (which only extensions do at runtime) makes it
    // accessible. Core non-allowlist channels (shell:open-external, dialog:open-directory)
    // are never invoked via the bridge in practice — the shim handles them locally.
    const invokeRegistry = new Map([
      ['dialog:open-directory', { handler: vi.fn(), remoteAccessible: false }],
    ])
    const eventBus = new EventEmitter()
    const api = createExtensionAPI('test.ipc6', '0.1.0', {
      bridge: { invokeRegistry, sendRegistry: new Map(), eventBus },
    })
    // The remoteAccessible flag is NOT checked — registry presence is sufficient.
    // If this assertion changes to false, the extension channel access design has regressed.
    expect(api.ipc.isRemoteAccessible('dialog:open-directory')).toBe(true)
  })
})

// ── pty ──────────────────────────────────────────────────────────────────────

describe('api.pty', () => {
  const mockPtyManager = {
    spawn: vi.fn(() => 'session-xyz'),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    listSessions: vi.fn(() => ['s1', 's2']),
    attachOnData: vi.fn(() => () => {}),
    attachOnExit: vi.fn(() => () => {}),
  }

  describe('with ptyManager', () => {
    it('spawn delegates to ptyManager.spawn', () => {
      const api = createExtensionAPI('test.pty', '0.1.0', { ptyManager: mockPtyManager })
      const onData = vi.fn()
      const onExit = vi.fn()
      api.pty.spawn('s1', '/cwd', '/bin/zsh', 'human', onData, onExit)
      expect(mockPtyManager.spawn).toHaveBeenCalledWith(
        's1',
        '/cwd',
        '/bin/zsh',
        'human',
        onData,
        onExit
      )
    })

    it('write delegates to ptyManager.write', () => {
      const api = createExtensionAPI('test.pty2', '0.1.0', { ptyManager: mockPtyManager })
      api.pty.write('s1', 'hello')
      expect(mockPtyManager.write).toHaveBeenCalledWith('s1', 'hello')
    })

    it('resize delegates to ptyManager.resize', () => {
      const api = createExtensionAPI('test.pty3', '0.1.0', { ptyManager: mockPtyManager })
      api.pty.resize('s1', 80, 24)
      expect(mockPtyManager.resize).toHaveBeenCalledWith('s1', 80, 24)
    })

    it('kill delegates to ptyManager.kill', () => {
      const api = createExtensionAPI('test.pty4', '0.1.0', { ptyManager: mockPtyManager })
      api.pty.kill('s1')
      expect(mockPtyManager.kill).toHaveBeenCalledWith('s1')
    })

    it('listSessions returns the manager session list', () => {
      const api = createExtensionAPI('test.pty5', '0.1.0', { ptyManager: mockPtyManager })
      expect(api.pty.listSessions()).toEqual(['s1', 's2'])
    })

    it('attachOnData/attachOnExit return the manager disposers', () => {
      const api = createExtensionAPI('test.pty6', '0.1.0', { ptyManager: mockPtyManager })
      expect(typeof api.pty.attachOnData('s1', vi.fn())).toBe('function')
      expect(typeof api.pty.attachOnExit('s1', vi.fn())).toBe('function')
    })
  })

  describe('without ptyManager', () => {
    it('listSessions returns [] and attach* return null', () => {
      const api = createExtensionAPI('test.pty.nopty5', '0.1.0')
      expect(api.pty.listSessions()).toEqual([])
      expect(api.pty.attachOnData('s1', vi.fn())).toBeNull()
      expect(api.pty.attachOnExit('s1', vi.fn())).toBeNull()
    })

    it('spawn throws PTY access not available', () => {
      const api = createExtensionAPI('test.pty.nopty', '0.1.0')
      expect(() => api.pty.spawn('s1', '/cwd', '/bin/zsh', 'human', vi.fn(), vi.fn())).toThrow(
        'PTY access not available'
      )
    })

    it('write is a no-op and does not throw', () => {
      const api = createExtensionAPI('test.pty.nopty2', '0.1.0')
      expect(() => api.pty.write('s1', 'hello')).not.toThrow()
    })

    it('resize is a no-op and does not throw', () => {
      const api = createExtensionAPI('test.pty.nopty3', '0.1.0')
      expect(() => api.pty.resize('s1', 80, 24)).not.toThrow()
    })

    it('kill is a no-op and does not throw', () => {
      const api = createExtensionAPI('test.pty.nopty4', '0.1.0')
      expect(() => api.pty.kill('s1')).not.toThrow()
    })
  })
})

// ── window.broadcast ─────────────────────────────────────────────────────────

describe('api.window.broadcast', () => {
  it('calls deps.broadcastToWindows when provided', () => {
    const broadcastToWindows = vi.fn()
    const api = createExtensionAPI('test.bcast', '0.1.0', { broadcastToWindows })
    api.window.broadcast('my:event', { data: 1 })
    expect(broadcastToWindows).toHaveBeenCalledWith('my:event', { data: 1 })
  })

  it('falls back to BrowserWindow.getAllWindows() when no broadcastToWindows dep', async () => {
    const { BrowserWindow } = await import('electron')
    const api = createExtensionAPI('test.bcast2', '0.1.0')
    api.window.broadcast('my:event', { data: 2 })
    expect(BrowserWindow.getAllWindows).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith('my:event', { data: 2 })
  })
})

// ── window.openAuxiliary ─────────────────────────────────────────────────────

describe('api.window.openAuxiliary', () => {
  it('opens a new BrowserWindow for a new view', async () => {
    const { BrowserWindow } = await import('electron')
    const api = createExtensionAPI('test.aux', '0.1.0')
    api.window.openAuxiliary('test-view-new-1')
    expect(BrowserWindow).toHaveBeenCalled()
  })

  it('focuses the existing window when called again for the same view', async () => {
    const { BrowserWindow } = await import('electron')
    const api = createExtensionAPI('test.aux2', '0.1.0')
    api.window.openAuxiliary('test-view-new-2')
    vi.mocked(BrowserWindow).mockClear()
    mockBWInstance.isDestroyed.mockReturnValueOnce(false)
    api.window.openAuxiliary('test-view-new-2')
    expect(BrowserWindow).not.toHaveBeenCalled()
    expect(mockBWInstance.focus).toHaveBeenCalled()
  })

  it('opens a new window when the existing one is destroyed', async () => {
    const { BrowserWindow } = await import('electron')
    const api = createExtensionAPI('test.aux3', '0.1.0')
    api.window.openAuxiliary('test-view-new-3')
    vi.mocked(BrowserWindow).mockClear()
    mockBWInstance.isDestroyed.mockReturnValueOnce(true)
    api.window.openAuxiliary('test-view-new-3')
    expect(BrowserWindow).toHaveBeenCalled()
  })
})
