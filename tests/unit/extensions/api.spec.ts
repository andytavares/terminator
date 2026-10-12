import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

const mockSend = vi.fn()
const mockWindow = {
  webContents: { send: mockSend, isDestroyed: vi.fn(() => false) },
  isDestroyed: vi.fn(() => false),
}

// Mock electron before importing api.ts
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [mockWindow]),
  },
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  Menu: {
    getApplicationMenu: vi.fn(() => null),
    buildFromTemplate: vi.fn((t) => t),
    setApplicationMenu: vi.fn(),
  },
  MenuItem: vi.fn().mockImplementation((opts) => opts),
  Notification: Object.assign(
    vi.fn().mockImplementation(() => ({ show: vi.fn() })),
    {
      isSupported: vi.fn(() => false),
    }
  ),
  app: { dock: null },
}))

vi.mock('../../../src/main/shell/shell-executor', () => ({
  execShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false }),
  assertCommandAllowed: vi.fn(),
  assertCwdInScope: vi.fn(),
  CommandNotAllowedError: class CommandNotAllowedError extends Error {
    readonly code = 'COMMAND_NOT_ALLOWED'
    constructor(cmd: string) {
      super(`COMMAND_NOT_ALLOWED: "${cmd}" is not allowed`)
    }
  },
  CwdOutOfScopeError: class CwdOutOfScopeError extends Error {
    readonly code = 'CWD_OUT_OF_SCOPE'
  },
}))

const mockExtensionStore: Record<string, unknown> = {}
vi.mock('../../../src/main/storage/extension-settings-store', () => ({
  getExtensionSetting: (key: string) => mockExtensionStore[key],
  setExtensionSetting: (key: string, value: unknown) => {
    mockExtensionStore[key] = value
  },
  getAllExtensionSettings: () => ({ ...mockExtensionStore }),
}))

const mockGetGlobalSettings = vi.fn()
const mockGetWorkspaceSettings = vi.fn()
vi.mock('../../../src/main/storage/settings-store', () => ({
  getGlobalSettings: () => mockGetGlobalSettings(),
  getWorkspaceSettings: (id: string) => mockGetWorkspaceSettings(id),
}))

const mockListWorkspaces = vi.fn(
  () => [] as Array<{ id: string; name: string; folderPath: string }>
)
vi.mock('../../../src/main/storage/workspace-store', () => ({
  listWorkspaces: () => mockListWorkspaces(),
  listProjects: () => [],
  deleteProject: vi.fn(),
}))

import {
  createExtensionAPI,
  globalRegistry,
  setMenuRebuildCallback,
  listExtensionSettingsSections,
  listExtensionCommands,
  executeExtensionCommand,
  listNativeViewMenuItems,
  getPanelMenuItemId,
} from '../../../src/main/extensions/api'
import { ipcInvokeRegistry } from '../../../src/main/remote/ipc-registry'
import { registerAdminIpcHandlers } from '../../../extensions/task-vault/src/ipc/admin.ipc'
import type { ExtensionDB } from '@terminator/extension-sdk'
import * as shellExecutor from '../../../src/main/shell/shell-executor'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetGlobalSettings.mockReturnValue({
    notifications: { defaultTargets: ['system', 'center', 'toast'], extensionOverrides: {} },
  })
  // Reset shared registry state between tests
  globalRegistry.topBarItems.clear()
  globalRegistry.nativeMenuItems.clear()
  globalRegistry.settingsSections.clear()
})

// The Git extension's review lists leave out pull requests whose source
// branch matches Settings → Git → Branch Exclude Patterns. Core owns the
// patterns and how they match; the extension only asks.
describe('api.settings.isBranchExcluded', () => {
  beforeEach(() => {
    mockGetGlobalSettings.mockReturnValue({ git: { branchExcludePatterns: ['renovate/*'] } })
    mockGetWorkspaceSettings.mockReturnValue({ workspaceId: 'w1', overrides: {}, extensions: {} })
    mockListWorkspaces.mockReturnValue([{ id: 'w1', name: 'WS', folderPath: '/repo' }])
  })

  it('matches the global patterns, across slashes', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(api.settings.isBranchExcluded('renovate/npm/vitest-4')).toBe(true)
    expect(api.settings.isBranchExcluded('feature/login')).toBe(false)
  })

  it('uses the override of the workspace that owns the repository', () => {
    mockGetWorkspaceSettings.mockReturnValue({
      workspaceId: 'w1',
      overrides: { git: { branchExcludePatterns: ['dependabot/*'] } },
      extensions: {},
    })
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(api.settings.isBranchExcluded('dependabot/npm/x', '/repo')).toBe(true)
    expect(api.settings.isBranchExcluded('renovate/x', '/repo')).toBe(false)
    expect(api.settings.isBranchExcluded('renovate/x', '/elsewhere')).toBe(true)
  })

  it('excludes nothing when no pattern is set', () => {
    mockGetGlobalSettings.mockReturnValue({ git: {} })
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(api.settings.isBranchExcluded('renovate/x')).toBe(false)
  })
})

describe('api.notifications.showToast', () => {
  it('routes through notificationManager, resolving targets from settings like createNotification', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.notifications.showToast('info', 'Hello toast', 'somethingHappened')

    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ type: 'info', title: 'Hello toast', source: 'test.ext' })
    )
  })

  it('sends error toast with correct type', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.notifications.showToast('error', 'Something failed', 'somethingFailed')

    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ type: 'error', title: 'Something failed', source: 'test.ext' })
    )
  })
})

describe('api.shell.exec', () => {
  beforeEach(() => {
    vi.mocked(shellExecutor.assertCommandAllowed).mockReset()
    vi.mocked(shellExecutor.assertCwdInScope).mockReset()
    vi.mocked(shellExecutor.execShell).mockReset().mockResolvedValue({
      exitCode: 0,
      stdout: 'output',
      stderr: '',
      timedOut: false,
    })
  })

  it('calls execShell with correct args for git command', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const result = await api.shell.exec({ command: 'git', args: ['status'], cwd: '/tmp/repo' })

    expect(shellExecutor.assertCommandAllowed).toHaveBeenCalledWith('git')
    expect(shellExecutor.execShell).toHaveBeenCalledWith({
      command: 'git',
      args: ['status'],
      cwd: '/tmp/repo',
      timeoutMs: 10000,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('output')
  })

  it('rejects with COMMAND_NOT_ALLOWED for non-allowlisted commands', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    vi.mocked(shellExecutor.assertCommandAllowed).mockImplementationOnce((cmd) => {
      throw new shellExecutor.CommandNotAllowedError(cmd)
    })

    await expect(api.shell.exec({ command: 'git', args: [], cwd: '/tmp' })).rejects.toThrow(
      'COMMAND_NOT_ALLOWED'
    )
  })
})

describe('api.nativeMenu.addViewMenuItem', () => {
  beforeEach(() => {
    globalRegistry.panelMenuItemIds.clear()
  })

  afterEach(() => {
    setMenuRebuildCallback(() => {})
  })

  it('adds item and returns a disposable', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const onClick = vi.fn()

    const disposable = api.nativeMenu.addViewMenuItem({
      id: 'test-item',
      label: 'Test Item',
      onClick,
    })

    expect(disposable).toHaveProperty('dispose')
    expect(typeof disposable.dispose).toBe('function')
    expect(globalRegistry.nativeMenuItems.has('test.ext.nativemenu.test-item')).toBe(true)
  })

  it('dispose removes item from registry', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.nativeMenu.addViewMenuItem({
      id: 'item-to-remove',
      label: 'Remove Me',
      onClick: vi.fn(),
    })

    disposable.dispose()
    expect(globalRegistry.nativeMenuItems.has('test.ext.nativemenu.item-to-remove')).toBe(false)
  })

  it('stores panelId and type fields on the contribution', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.nativeMenu.addViewMenuItem({
      id: 'panel-toggle',
      label: 'Toggle Panel',
      onClick: vi.fn(),
      type: 'checkbox',
      panelId: 'my-panel',
    })

    const contrib = globalRegistry.nativeMenuItems.get('test.ext.nativemenu.panel-toggle')
    expect(contrib?.type).toBe('checkbox')
    expect(contrib?.panelId).toBe('my-panel')
  })

  it('rebuildViewMenu populates panelMenuItemIds for contributions with panelId', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.nativeMenu.addViewMenuItem({
      id: 'rebuild-test',
      label: 'Rebuild Test',
      onClick: vi.fn(),
      type: 'checkbox',
      panelId: 'rebuild-panel',
    })

    expect(globalRegistry.panelMenuItemIds.get('rebuild-panel')).toBe('ext-menu-rebuild-test')
  })

  it('rebuildViewMenu does not add to panelMenuItemIds when panelId is absent', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(() =>
      api.nativeMenu.addViewMenuItem({ id: 'no-panel', label: 'No Panel', onClick: vi.fn() })
    ).not.toThrow()
    expect(globalRegistry.panelMenuItemIds.has('no-panel')).toBe(false)
  })

  it('rebuildViewMenu calls the registered menu rebuild callback', () => {
    const mockRebuild = vi.fn()
    setMenuRebuildCallback(mockRebuild)

    const api = createExtensionAPI('test.ext', '0.1.0')
    api.nativeMenu.addViewMenuItem({ id: 'cb-test', label: 'CB Test', onClick: vi.fn() })

    expect(mockRebuild).toHaveBeenCalled()
  })
})

describe('api.terminal session handlers', () => {
  it('onSessionCreate registers handler and returns disposable', async () => {
    const { createExtensionAPI, globalRegistry } = await import('../../../src/main/extensions/api')
    const api = createExtensionAPI('com.term.test', '0.1.0')
    const handler = vi.fn()
    const disposable = api.terminal.onSessionCreate(handler)
    expect(globalRegistry.sessionCreateHandlers.has(handler)).toBe(true)
    disposable.dispose()
    expect(globalRegistry.sessionCreateHandlers.has(handler)).toBe(false)
  })

  it('onSessionClose registers handler and returns disposable', async () => {
    const { createExtensionAPI, globalRegistry } = await import('../../../src/main/extensions/api')
    const api = createExtensionAPI('com.term.test2', '0.1.0')
    const handler = vi.fn()
    const disposable = api.terminal.onSessionClose(handler)
    expect(globalRegistry.sessionCloseHandlers.has(handler)).toBe(true)
    disposable.dispose()
    expect(globalRegistry.sessionCloseHandlers.has(handler)).toBe(false)
  })
})

describe('api.settings workspace precedence', () => {
  beforeEach(() => {
    // Clear mock store between tests
    for (const key of Object.keys(mockExtensionStore)) {
      delete mockExtensionStore[key]
    }
  })

  it('returns global value when no workspace override exists', () => {
    const api = createExtensionAPI('com.test', '0.1.0')
    mockExtensionStore['com.test.enabled'] = true

    const val = api.settings.get<boolean>('com.test.enabled')
    expect(val).toBe(true)
  })

  it('returns undefined when key not set globally or in workspace', () => {
    const api = createExtensionAPI('com.test', '0.1.0', () => 'ws-789')

    const val = api.settings.get<boolean>('com.test.missing')
    expect(val).toBeUndefined()
  })

  it('returns schema default when key not set but schema registered', () => {
    const api = createExtensionAPI('com.test', '0.1.0')
    api.settings.register({
      label: 'Test',
      properties: {
        'com.test.enabled': { type: 'boolean', label: 'Enabled', default: true },
      },
    })

    const val = api.settings.get<boolean>('com.test.enabled')
    expect(val).toBe(true)
  })

  it('returns stored value over schema default', () => {
    const api = createExtensionAPI('com.test', '0.1.0')
    api.settings.register({
      label: 'Test',
      properties: {
        'com.test.enabled': { type: 'boolean', label: 'Enabled', default: true },
      },
    })
    mockExtensionStore['com.test.enabled'] = false

    const val = api.settings.get<boolean>('com.test.enabled')
    expect(val).toBe(false)
  })

  it('ignores workspace values when no workspace ID getter provided', () => {
    const api = createExtensionAPI('com.test', '0.1.0')
    mockExtensionStore['com.test.enabled'] = false

    const val = api.settings.get<boolean>('com.test.enabled')
    expect(val).toBe(false)
  })
})

describe('api.notifications.createNotification', () => {
  it('returns a disposable that can dismiss the notification', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.notifications.createNotification({
      type: 'info',
      title: 'Test notif',
      key: 'testNotif',
    })
    expect(disposable).toHaveProperty('dispose')
    expect(() => disposable.dispose()).not.toThrow()
  })

  it('creates notification with actions', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.notifications.createNotification({
      type: 'warning',
      title: 'With actions',
      message: 'Please review',
      key: 'withActions',
      actions: [{ id: 'go', label: 'Go', handler: vi.fn() }],
    })
    expect(disposable).toHaveProperty('dispose')
    disposable.dispose()
  })
})

describe('api.commands.register', () => {
  it('registers command and returns disposable', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const handler = vi.fn()
    const disposable = api.commands.register({ id: 'my-command', label: 'My Command' }, handler)
    expect(disposable).toHaveProperty('dispose')
    disposable.dispose()
  })
})

describe('api.ipc.registerHandler', () => {
  it('registers an IPC handler and returns disposable', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const handler = vi.fn().mockResolvedValue({ ok: true })
    const disposable = api.ipc.registerHandler('test.ext:my-channel', handler)
    expect(disposable).toHaveProperty('dispose')
    disposable.dispose()
  })

  it('keeps a channel registered without the option local-only', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.ipc.registerHandler('test.ext:no-option', vi.fn())
    expect(ipcInvokeRegistry.get('test.ext:no-option')?.remoteAccessible).toBe(false)
    disposable.dispose()
    expect(ipcInvokeRegistry.has('test.ext:no-option')).toBe(false)
  })

  it('makes a channel remote-accessible only when it opts in', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.ipc.registerHandler('test.ext:opted-in', vi.fn(), {
      remoteAccessible: true,
    })
    expect(ipcInvokeRegistry.get('test.ext:opted-in')?.remoteAccessible).toBe(true)
    disposable.dispose()
  })

  it('keeps the task-vault SQL console and its admin channels out of the remote bridge', () => {
    const api = createExtensionAPI('terminator.task-vault', '0.1.0', {
      bridge: {
        invokeRegistry: ipcInvokeRegistry,
        sendRegistry: new Map(),
        eventBus: new EventEmitter(),
      },
    })
    const dispose = registerAdminIpcHandlers(api, {} as ExtensionDB)

    for (const channel of [
      'task-vault:admin:run-query',
      'task-vault:admin:list-tables',
      'task-vault:admin:table-stats',
    ]) {
      expect(ipcInvokeRegistry.has(channel)).toBe(true)
      expect(api.ipc.isRemoteAccessible(channel)).toBe(false)
    }
    dispose()
  })

  it('honors remoteAccessible: false for local-only channels', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.ipc.registerHandler('test.ext:local-only', vi.fn(), {
      remoteAccessible: false,
    })
    expect(ipcInvokeRegistry.get('test.ext:local-only')?.remoteAccessible).toBe(false)
    disposable.dispose()
  })
})

describe('api.topBar.registerMenuItem', () => {
  it('registers a top bar item and returns disposable', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.topBar.registerMenuItem({
      id: 'tb-item',
      label: 'My Item',
      onClick: vi.fn(),
    })
    expect(globalRegistry.topBarItems.has('test.ext.topbar.tb-item')).toBe(true)
    disposable.dispose()
    expect(globalRegistry.topBarItems.has('test.ext.topbar.tb-item')).toBe(false)
  })
})

describe('api.pty.listSessions', () => {
  it('delegates to ptyManager.listSessions when deps are provided', () => {
    const mockPtyMgr = {
      spawn: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      listSessions: vi.fn(() => [{ sessionId: 's1', cwd: '/tmp' }]),
    }
    const api = createExtensionAPI('test.ext', '0.1.0', {
      ptyManager: mockPtyMgr as never,
    })
    const result = api.pty.listSessions()
    expect(result).toEqual([{ sessionId: 's1', cwd: '/tmp' }])
    expect(mockPtyMgr.listSessions).toHaveBeenCalledTimes(1)
  })

  it('returns empty array when no ptyManager dep is provided', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(api.pty.listSessions()).toEqual([])
  })
})

describe('registry query functions', () => {
  it('listExtensionSettingsSections decodes the extension id from the section key', () => {
    const api = createExtensionAPI('com.query.settings', '0.1.0')
    const d = api.settings.register({
      label: 'Query Test',
      properties: { 'com.query.settings.flag': { type: 'boolean', label: 'Flag', default: false } },
    })
    const section = listExtensionSettingsSections().find(
      (s) => s.extensionId === 'com.query.settings'
    )
    expect(section).toBeDefined()
    expect(section!.label).toBe('Query Test')
    expect(section!.properties['com.query.settings.flag']).toBeDefined()
    d.dispose()
  })

  it('commands are listed with their key and executed through it', () => {
    const api = createExtensionAPI('com.query.cmd', '0.1.0')
    const handler = vi.fn()
    const d = api.commands.register({ id: 'q-cmd', label: 'Run' }, handler)
    const cmd = listExtensionCommands().find((c) => c.id === 'q-cmd')
    expect(cmd).toBeDefined()
    executeExtensionCommand(cmd!.key)
    expect(handler).toHaveBeenCalled()
    executeExtensionCommand('unknown-key')
    expect(handler).toHaveBeenCalledTimes(1)
    d.dispose()
  })

  it('listNativeViewMenuItems records the panel menu-item id mapping', () => {
    const api = createExtensionAPI('com.query.menu', '0.1.0')
    const onClick = vi.fn()
    const d = api.nativeMenu.addViewMenuItem({
      id: 'q-menu',
      label: 'Toggle Panel',
      type: 'checkbox',
      panelId: 'q-panel',
      onClick,
    })
    const items = listNativeViewMenuItems()
    const item = items.find((i) => i.id === 'ext-menu-q-menu')
    expect(item).toMatchObject({ label: 'Toggle Panel', type: 'checkbox' })
    item!.onClick()
    expect(onClick).toHaveBeenCalled()
    expect(getPanelMenuItemId('q-panel')).toBe('ext-menu-q-menu')
    d.dispose()
  })
})
