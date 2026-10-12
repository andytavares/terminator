import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

const mockSend = vi.fn()
const mockWindow = {
  webContents: { send: mockSend, isDestroyed: vi.fn(() => false) },
  isDestroyed: vi.fn(() => false),
  isMinimized: vi.fn(() => true),
  restore: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
}
const mockShowOpenDialog = vi.hoisted(() => vi.fn())

// Mock electron before importing api.ts
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [mockWindow]),
    getFocusedWindow: vi.fn(() => null),
  },
  dialog: { showOpenDialog: mockShowOpenDialog },
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
import { defineChannel, type ExtensionDB } from '@terminator/extension-sdk'
import { z } from 'zod'
import * as shellExecutor from '../../../src/main/shell/shell-executor'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetGlobalSettings.mockReturnValue({
    notifications: { defaultTargets: ['system', 'center', 'toast'], extensionOverrides: {} },
  })
  // Reset shared registry state between tests
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

  it('matches the global patterns, across slashes', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(await api.settings.isBranchExcluded('renovate/npm/vitest-4')).toBe(true)
    expect(await api.settings.isBranchExcluded('feature/login')).toBe(false)
  })

  it('uses the override of the workspace that owns the repository', async () => {
    mockGetWorkspaceSettings.mockReturnValue({
      workspaceId: 'w1',
      overrides: { git: { branchExcludePatterns: ['dependabot/*'] } },
      extensions: {},
    })
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(await api.settings.isBranchExcluded('dependabot/npm/x', '/repo')).toBe(true)
    expect(await api.settings.isBranchExcluded('renovate/x', '/repo')).toBe(false)
    expect(await api.settings.isBranchExcluded('renovate/x', '/elsewhere')).toBe(true)
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

  it('hands the per-call buffer limit, environment and encoding to the command', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    await api.shell.exec({
      command: 'gh',
      args: ['api', 'user'],
      cwd: '/tmp/repo',
      timeoutMs: 500,
      maxBuffer: 2048,
      env: { GH_REPO: 'octo/repo' },
      encoding: 'buffer',
    })

    expect(shellExecutor.execShell).toHaveBeenCalledWith({
      command: 'gh',
      args: ['api', 'user'],
      cwd: '/tmp/repo',
      timeoutMs: 500,
      maxBuffer: 2048,
      env: { GH_REPO: 'octo/repo' },
      encoding: 'buffer',
    })
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

  // Quick Actions lists the registered commands; an extension that activates
  // after the panel opened must still reach it.
  it('tells the windows when a command arrives and when it goes', () => {
    const broadcastToWindows = vi.fn()
    const api = createExtensionAPI('test.ext', '0.1.0', { broadcastToWindows })
    const disposable = api.commands.register({ id: 'push', label: 'Push' }, vi.fn())
    expect(broadcastToWindows).toHaveBeenCalledWith('extension:commands-changed', null)
    broadcastToWindows.mockClear()
    disposable.dispose()
    expect(broadcastToWindows).toHaveBeenCalledWith('extension:commands-changed', null)
  })
})

/** A channel that takes any payload, for tests about registration itself. */
function anyPayload(channel: string) {
  return defineChannel({ channel, schema: z.unknown(), invalid: null, run: vi.fn() })
}

describe('api.ipc.registerHandler', () => {
  it('registers an IPC handler and returns disposable', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.ipc.registerHandler(anyPayload('test.ext:my-channel'))
    expect(disposable).toHaveProperty('dispose')
    disposable.dispose()
  })

  // ADR 096. Extension bundles are plain JavaScript at run time, so the type
  // alone does not stop a handler from arriving without one.
  it('refuses a handler registered without a schema', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const register = api.ipc.registerHandler as unknown as (...args: unknown[]) => unknown
    expect(() => register('test.ext:bare', vi.fn())).toThrow(/schema/)
    expect(ipcInvokeRegistry.has('test.ext:bare')).toBe(false)
  })

  it('keeps a channel registered without the option local-only', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.ipc.registerHandler(anyPayload('test.ext:no-option'))
    expect(ipcInvokeRegistry.get('test.ext:no-option')?.remoteAccessible).toBe(false)
    disposable.dispose()
    expect(ipcInvokeRegistry.has('test.ext:no-option')).toBe(false)
  })

  it('makes a channel remote-accessible only when it opts in', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.ipc.registerHandler(anyPayload('test.ext:opted-in'), {
      remoteAccessible: true,
    })
    expect(ipcInvokeRegistry.get('test.ext:opted-in')?.remoteAccessible).toBe(true)
    disposable.dispose()
  })

  it('keeps the task-vault SQL console and its admin channels out of the remote bridge', async () => {
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
      expect(await api.ipc.isRemoteAccessible(channel)).toBe(false)
    }
    dispose()
  })

  it('parses the payload of a channel registered with a schema before run sees it', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const run = vi.fn(({ id }: { id: string }) => ({ data: id }))
    const disposable = api.ipc.registerHandler(
      defineChannel({
        channel: 'test.ext:get',
        schema: z.object({ id: z.string() }),
        invalid: { error: 'VALIDATION_ERROR' },
        run,
      })
    )
    const handler = ipcInvokeRegistry.get('test.ext:get')!.handler

    await expect(handler(null as never, { id: 'n1', extra: true })).resolves.toEqual({
      data: 'n1',
    })
    expect(run).toHaveBeenCalledWith({ id: 'n1' })
    disposable.dispose()
  })

  it('answers a payload the schema rejects with the declared invalid response', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const run = vi.fn()
    const disposable = api.ipc.registerHandler(
      defineChannel({
        channel: 'test.ext:strict',
        schema: z.object({ id: z.string() }),
        invalid: { error: 'VALIDATION_ERROR' },
        run,
      }),
      { remoteAccessible: true }
    )
    const entry = ipcInvokeRegistry.get('test.ext:strict')!

    await expect(entry.handler(null as never, { id: 7 })).resolves.toEqual({
      error: 'VALIDATION_ERROR',
    })
    expect(run).not.toHaveBeenCalled()
    expect(entry.remoteAccessible).toBe(true)
    disposable.dispose()
    expect(ipcInvokeRegistry.has('test.ext:strict')).toBe(false)
  })

  it('honors remoteAccessible: false for local-only channels', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.ipc.registerHandler(anyPayload('test.ext:local-only'), {
      remoteAccessible: false,
    })
    expect(ipcInvokeRegistry.get('test.ext:local-only')?.remoteAccessible).toBe(false)
    disposable.dispose()
  })
})

describe('api.pty.listSessions', () => {
  it('delegates to ptyManager.listSessions when deps are provided', async () => {
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
    const result = await api.pty.listSessions()
    expect(result).toEqual([{ sessionId: 's1', cwd: '/tmp' }])
    expect(mockPtyMgr.listSessions).toHaveBeenCalledTimes(1)
  })

  it('returns empty array when no ptyManager dep is provided', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(await api.pty.listSessions()).toEqual([])
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

// The members an extension in the extension host uses instead of Electron, which
// it cannot import there (SDK 4.0.0).
describe('what the extension host cannot reach itself', () => {
  it('raise restores a minimised window and brings it forward', () => {
    createExtensionAPI('com.raise', '0.1.0').window.raise()
    expect(mockWindow.restore).toHaveBeenCalled()
    expect(mockWindow.show).toHaveBeenCalled()
    expect(mockWindow.focus).toHaveBeenCalled()
  })

  it('showOpenDialog opens over a window and answers with only the chosen paths', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/x'], bookmarks: [] })
    const api = createExtensionAPI('com.dialog', '0.1.0')
    const result = await api.dialog.showOpenDialog({ properties: ['openDirectory'] })
    expect(mockShowOpenDialog).toHaveBeenCalledWith(mockWindow, { properties: ['openDirectory'] })
    expect(result).toEqual({ canceled: false, filePaths: ['/x'] })
  })

  it("paths are the app's directory and the extension's own folder under userData", () => {
    const paths = { app: '/app', userData: '/data' }
    expect(createExtensionAPI('com.paths', '0.1.0', { paths }).paths).toEqual({
      app: '/app',
      globalStorage: '/data/extensions/com.paths',
    })
  })
})
