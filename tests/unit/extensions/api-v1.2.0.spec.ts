import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Electron mock ────────────────────────────────────────────────────────────
const mockSend = vi.fn()
const mockWindow = { webContents: { send: mockSend } }
const registeredGlobalShortcuts = new Map<string, () => void>()

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [mockWindow]) },
  Menu: {
    getApplicationMenu: vi.fn(() => null),
    buildFromTemplate: vi.fn((t) => t),
    setApplicationMenu: vi.fn(),
  },
  MenuItem: vi.fn().mockImplementation((opts) => opts),
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

beforeEach(() => {
  vi.clearAllMocks()
  registeredGlobalShortcuts.clear()
  globalRegistry.sidebarPanels.clear()
  globalRegistry.globalTabs?.clear()
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
