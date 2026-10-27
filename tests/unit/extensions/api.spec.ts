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
const mockShowSaveDialog = vi.hoisted(() => vi.fn())

// Mock electron before importing api.ts
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [mockWindow]),
    getFocusedWindow: vi.fn(() => null),
  },
  dialog: { showOpenDialog: mockShowOpenDialog, showSaveDialog: mockShowSaveDialog },
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
  extensionSettingsSnapshot: () => ({
    global: { ...mockExtensionStore },
    workspaces: mockWorkspaceExtensionValues,
  }),
}))
const mockWorkspaceExtensionValues: Record<string, Record<string, Record<string, unknown>>> = {}

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
import { notificationManager } from '../../../src/main/notifications/notification-manager'

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
    const api = createExtensionAPI('test.ext')
    expect(await api.settings.isBranchExcluded('renovate/npm/vitest-4')).toBe(true)
    expect(await api.settings.isBranchExcluded('feature/login')).toBe(false)
  })

  it('uses the override of the workspace that owns the repository', async () => {
    mockGetWorkspaceSettings.mockReturnValue({
      workspaceId: 'w1',
      overrides: { git: { branchExcludePatterns: ['dependabot/*'] } },
      extensions: {},
    })
    const api = createExtensionAPI('test.ext')
    expect(await api.settings.isBranchExcluded('dependabot/npm/x', '/repo')).toBe(true)
    expect(await api.settings.isBranchExcluded('renovate/x', '/repo')).toBe(false)
    expect(await api.settings.isBranchExcluded('renovate/x', '/elsewhere')).toBe(true)
  })
})

describe('api.notifications.showToast', () => {
  it('routes through notificationManager, resolving targets from settings like createNotification', () => {
    const api = createExtensionAPI('test.ext')
    api.notifications.showToast('info', 'Hello toast', 'somethingHappened')

    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ type: 'info', title: 'Hello toast', source: 'test.ext' })
    )
  })

  it('sends error toast with correct type', () => {
    const api = createExtensionAPI('test.ext')
    api.notifications.showToast('error', 'Something failed', 'somethingFailed')

    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ type: 'error', title: 'Something failed', source: 'test.ext' })
    )
  })
})

function useExecMocks(): void {
  beforeEach(() => {
    vi.mocked(shellExecutor.assertCommandAllowed).mockReset()
    vi.mocked(shellExecutor.assertCwdInScope).mockReset()
    vi.mocked(shellExecutor.execShell).mockReset().mockResolvedValue({
      exitCode: 0,
      stdout: 'output',
      stderr: '',
      timedOut: false,
      exceededMaxBuffer: false,
    })
  })
}

describe('api.shell.exec', () => {
  useExecMocks()

  it('calls execShell with correct args for git command', async () => {
    const api = createExtensionAPI('test.ext')
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
})

describe('api.shell.exec — per-call options', () => {
  useExecMocks()

  it('hands the per-call buffer limit, environment and encoding to the command', async () => {
    const api = createExtensionAPI('test.ext')
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
})

describe('api.shell.exec — refusals', () => {
  useExecMocks()

  it('rejects with COMMAND_NOT_ALLOWED for non-allowlisted commands', async () => {
    const api = createExtensionAPI('test.ext')
    vi.mocked(shellExecutor.assertCommandAllowed).mockImplementationOnce((cmd) => {
      throw new shellExecutor.CommandNotAllowedError(cmd)
    })

    await expect(api.shell.exec({ command: 'git', args: [], cwd: '/tmp' })).rejects.toThrow(
      'COMMAND_NOT_ALLOWED'
    )
  })
})

function useMenuRegistry(): void {
  beforeEach(() => {
    globalRegistry.panelMenuItemIds.clear()
  })

  afterEach(() => {
    setMenuRebuildCallback(() => {})
  })
}

describe('api.nativeMenu.addViewMenuItem', () => {
  useMenuRegistry()

  it('adds the item to the registry under the extension', () => {
    const api = createExtensionAPI('test.ext')
    api.nativeMenu.addViewMenuItem({ id: 'test-item', label: 'Test Item', onClick: vi.fn() })
    expect(globalRegistry.nativeMenuItems.has('test.ext.nativemenu.test-item')).toBe(true)
  })

  it('dispose removes item from registry', () => {
    const api = createExtensionAPI('test.ext')
    const disposable = api.nativeMenu.addViewMenuItem({
      id: 'item-to-remove',
      label: 'Remove Me',
      onClick: vi.fn(),
    })

    disposable.dispose()
    expect(globalRegistry.nativeMenuItems.has('test.ext.nativemenu.item-to-remove')).toBe(false)
  })
})

describe('api.nativeMenu.addViewMenuItem — panels', () => {
  useMenuRegistry()

  it('stores panelId and type fields on the contribution', () => {
    const api = createExtensionAPI('test.ext')
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
    const api = createExtensionAPI('test.ext')
    api.nativeMenu.addViewMenuItem({
      id: 'rebuild-test',
      label: 'Rebuild Test',
      onClick: vi.fn(),
      type: 'checkbox',
      panelId: 'rebuild-panel',
    })

    expect(globalRegistry.panelMenuItemIds.get('rebuild-panel')).toBe('ext-menu-rebuild-test')
  })
})

describe('api.nativeMenu.addViewMenuItem — menu rebuilds', () => {
  useMenuRegistry()

  it('rebuildViewMenu does not add to panelMenuItemIds when panelId is absent', () => {
    const api = createExtensionAPI('test.ext')
    api.nativeMenu.addViewMenuItem({ id: 'no-panel', label: 'No Panel', onClick: vi.fn() })
    // Keyed by panel id, of which this item has none: nothing at all is recorded.
    expect(globalRegistry.panelMenuItemIds.size).toBe(0)
  })

  it('rebuildViewMenu calls the registered menu rebuild callback', () => {
    const mockRebuild = vi.fn()
    setMenuRebuildCallback(mockRebuild)

    const api = createExtensionAPI('test.ext')
    api.nativeMenu.addViewMenuItem({ id: 'cb-test', label: 'CB Test', onClick: vi.fn() })

    expect(mockRebuild).toHaveBeenCalled()
  })
})

function useEmptySettingsStore(): void {
  beforeEach(() => {
    // Clear mock store between tests
    for (const key of Object.keys(mockExtensionStore)) {
      delete mockExtensionStore[key]
    }
    for (const id of Object.keys(mockWorkspaceExtensionValues)) {
      delete mockWorkspaceExtensionValues[id]
    }
  })
}

describe('api.settings workspace precedence', () => {
  useEmptySettingsStore()

  it('returns global value when no workspace override exists', () => {
    const api = createExtensionAPI('com.test')
    mockExtensionStore['com.test.enabled'] = true

    const val = api.settings.get<boolean>('com.test.enabled')
    expect(val).toBe(true)
  })

  it('returns undefined when key not set globally or in workspace', () => {
    const api = createExtensionAPI('com.test')

    const val = api.settings.get<boolean>('com.test.missing')
    expect(val).toBeUndefined()
  })
})

describe('api.settings workspace precedence — a path in a workspace', () => {
  useEmptySettingsStore()
  beforeEach(() => {
    mockListWorkspaces.mockReturnValue([
      { id: 'w1', name: 'API', folderPath: '/code/api' },
      { id: 'w2', name: 'Web', folderPath: '/code/web' },
    ])
    mockExtensionStore['com.test.signOff'] = false
    mockWorkspaceExtensionValues.w1 = { 'com.test': { 'com.test.signOff': true } }
  })

  it("returns the workspace's own value for a path in it, the global one elsewhere", () => {
    const api = createExtensionAPI('com.test')

    expect(api.settings.get<boolean>('com.test.signOff', { repoPath: '/code/api' })).toBe(true)
    expect(api.settings.get<boolean>('com.test.signOff', { repoPath: '/code/web' })).toBe(false)
    expect(api.settings.get<boolean>('com.test.signOff')).toBe(false)
  })
})

describe('api.settings workspace precedence — a path in a workspace that sets nothing', () => {
  useEmptySettingsStore()
  beforeEach(() => {
    mockListWorkspaces.mockReturnValue([{ id: 'w1', name: 'API', folderPath: '/code/api' }])
    mockWorkspaceExtensionValues.w1 = {}
  })

  it('returns the schema default when neither the workspace nor the global settings hold it', () => {
    const api = createExtensionAPI('com.test')
    api.settings.register({
      label: 'Test',
      properties: {
        'com.test.signOff': {
          type: 'boolean',
          label: 'Sign off',
          default: true,
          workspaceScoped: true,
        },
      },
    })

    expect(api.settings.get<boolean>('com.test.signOff', { repoPath: '/code/api' })).toBe(true)
  })
})

describe('api.settings workspace precedence — schema defaults', () => {
  useEmptySettingsStore()

  it('returns schema default when key not set but schema registered', () => {
    const api = createExtensionAPI('com.test')
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
    const api = createExtensionAPI('com.test')
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
})

describe('api.notifications.createNotification', () => {
  const notificationTitles = () => notificationManager.list().map((n) => n.title)

  it('lists the notification until its disposable dismisses it', () => {
    const api = createExtensionAPI('test.ext')
    const disposable = api.notifications.createNotification({
      type: 'info',
      title: 'Test notif',
      key: 'testNotif',
    })
    expect(notificationTitles()).toContain('Test notif')
    disposable.dispose()
    expect(notificationTitles()).not.toContain('Test notif')
  })

  it('sends its actions to the windows, without their handlers', () => {
    const api = createExtensionAPI('test.ext')
    const disposable = api.notifications.createNotification({
      type: 'warning',
      title: 'With actions',
      message: 'Please review',
      key: 'withActions',
      actions: [{ id: 'go', label: 'Go', handler: vi.fn() }],
    })
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ title: 'With actions', actions: [{ id: 'go', label: 'Go' }] })
    )
    disposable.dispose()
  })
})

describe('api.commands.register', () => {
  it('lists the command until its disposable removes it', () => {
    const api = createExtensionAPI('test.ext')
    const disposable = api.commands.register({ id: 'my-command', label: 'My Command' }, vi.fn())
    const commandListed = () => listExtensionCommands().some((c) => c.id === 'my-command')
    expect(commandListed()).toBe(true)
    disposable.dispose()
    expect(commandListed()).toBe(false)
  })

  // Quick Actions lists the registered commands; an extension that activates
  // after the panel opened must still reach it.
  it('tells the windows when a command arrives and when it goes', () => {
    const broadcastToWindows = vi.fn()
    const api = createExtensionAPI('test.ext', { broadcastToWindows })
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
  // ADR 096. Extension bundles are plain JavaScript at run time, so the type
  // alone does not stop a handler from arriving without one.
  it('refuses a handler registered without a schema', () => {
    const api = createExtensionAPI('test.ext')
    // Called the way plain JavaScript can, which the declared type forbids.
    const callBare = () =>
      Reflect.apply(api.ipc.registerHandler, api.ipc, ['test.ext:bare', vi.fn()])
    expect(callBare).toThrow(/schema/)
    expect(ipcInvokeRegistry.has('test.ext:bare')).toBe(false)
  })

  it('keeps a channel registered without the option local-only', () => {
    const api = createExtensionAPI('test.ext')
    const disposable = api.ipc.registerHandler(anyPayload('test.ext:no-option'))
    expect(ipcInvokeRegistry.get('test.ext:no-option')?.remoteAccessible).toBe(false)
    disposable.dispose()
    expect(ipcInvokeRegistry.has('test.ext:no-option')).toBe(false)
  })
})

describe('api.ipc.registerHandler — remote access', () => {
  it('makes a channel remote-accessible only when it opts in', () => {
    const api = createExtensionAPI('test.ext')
    const disposable = api.ipc.registerHandler(anyPayload('test.ext:opted-in'), {
      remoteAccessible: true,
    })
    expect(ipcInvokeRegistry.get('test.ext:opted-in')?.remoteAccessible).toBe(true)
    disposable.dispose()
  })

  it('keeps the task-vault SQL console and its admin channels out of the remote bridge', async () => {
    const api = createExtensionAPI('terminator.task-vault', {
      bridge: {
        invokeRegistry: ipcInvokeRegistry,
        sendRegistry: new Map(),
        eventBus: new EventEmitter(),
      },
    })
    const dispose = registerAdminIpcHandlers(api, {} as ExtensionDB)

    for (const channel of ['task-vault:admin:run-query', 'task-vault:admin:table-stats']) {
      expect(ipcInvokeRegistry.has(channel)).toBe(true)
      expect(await api.ipc.isRemoteAccessible(channel)).toBe(false)
    }
    dispose()
  })
})

describe('api.ipc.registerHandler — payloads', () => {
  it('parses the payload of a channel registered with a schema before run sees it', async () => {
    const api = createExtensionAPI('test.ext')
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
})

describe('api.ipc.registerHandler — rejected payloads', () => {
  it('answers a payload the schema rejects with the declared invalid response', async () => {
    const api = createExtensionAPI('test.ext')
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
})

describe('api.ipc.registerHandler — local-only channels', () => {
  it('honors remoteAccessible: false for local-only channels', () => {
    const api = createExtensionAPI('test.ext')
    const disposable = api.ipc.registerHandler(anyPayload('test.ext:local-only'), {
      remoteAccessible: false,
    })
    expect(ipcInvokeRegistry.get('test.ext:local-only')?.remoteAccessible).toBe(false)
    disposable.dispose()
  })
})

describe('registry query functions', () => {
  it('lists a settings section under its extension, with its label, description and properties', () => {
    const api = createExtensionAPI('com.query.settings')
    const flag = { type: 'boolean' as const, label: 'Flag', default: false }
    const d = api.settings.register({
      label: 'Query Test',
      description: 'What the query extension can be told',
      properties: { 'com.query.settings.flag': flag },
    })
    const section = listExtensionSettingsSections().find(
      (s) => s.extensionId === 'com.query.settings'
    )
    expect(section).toEqual({
      extensionId: 'com.query.settings',
      label: 'Query Test',
      description: 'What the query extension can be told',
      properties: { 'com.query.settings.flag': flag },
    })
    d.dispose()
  })
})

describe('registry query functions — commands and menu items', () => {
  it('commands are listed with their key and executed through it', async () => {
    const api = createExtensionAPI('com.query.cmd')
    const handler = vi.fn()
    const d = api.commands.register({ id: 'q-cmd', label: 'Run' }, handler)
    const cmd = listExtensionCommands().find((c) => c.id === 'q-cmd')
    const ctx = { projectId: 'p1', sessionId: null, repoRoot: null }
    expect(await executeExtensionCommand(cmd!.key, ctx)).toEqual({ ok: true })
    expect(handler).toHaveBeenCalledWith(ctx)
    expect(await executeExtensionCommand('unknown-key', ctx)).toEqual({
      ok: false,
      reason: 'not-registered',
    })
    d.dispose()
  })
})

describe('registry query functions — menu items', () => {
  it('listNativeViewMenuItems records the panel menu-item id mapping', () => {
    const api = createExtensionAPI('com.query.menu')
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
    createExtensionAPI('com.raise').window.raise()
    expect(mockWindow.restore).toHaveBeenCalled()
    expect(mockWindow.show).toHaveBeenCalled()
    expect(mockWindow.focus).toHaveBeenCalled()
  })
})

describe('what the extension host cannot reach itself — open dialog', () => {
  it('showOpenDialog opens over a window and answers with only the chosen paths', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/x'], bookmarks: [] })
    const api = createExtensionAPI('com.dialog')
    const result = await api.dialog.showOpenDialog({ properties: ['openDirectory'] })
    expect(mockShowOpenDialog).toHaveBeenCalledWith(mockWindow, { properties: ['openDirectory'] })
    expect(result).toEqual({ canceled: false, filePaths: ['/x'] })
  })
})

describe('what the extension host cannot reach itself — dialogs without a window', () => {
  it('showOpenDialog opens on its own when no window is open', async () => {
    const { BrowserWindow } = await import('electron')
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([])
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const api = createExtensionAPI('com.dialog')
    await api.dialog.showOpenDialog({ properties: ['openFile'] })
    expect(mockShowOpenDialog).toHaveBeenLastCalledWith({ properties: ['openFile'] })
  })

  it('showSaveDialog opens over a window and answers with only the chosen path', async () => {
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/x.txt', bookmark: 'b' })
    const api = createExtensionAPI('com.dialog')
    const result = await api.dialog.showSaveDialog({ defaultPath: 'x.txt' })
    expect(mockShowSaveDialog).toHaveBeenCalledWith(mockWindow, { defaultPath: 'x.txt' })
    expect(result).toEqual({ canceled: false, filePath: '/x.txt' })
  })

  it('showSaveDialog opens on its own when no window is open', async () => {
    const { BrowserWindow } = await import('electron')
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValueOnce([])
    mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    await createExtensionAPI('com.dialog').dialog.showSaveDialog({})
    expect(mockShowSaveDialog).toHaveBeenLastCalledWith({})
  })
})

describe('what the extension host cannot reach itself — refusals and paths', () => {
  it('refuses the database before the app database is open', () => {
    const api = createExtensionAPI('com.nodb')
    expect(() => api.db.exec('SELECT 1')).toThrow('Extension "com.nodb": AppDB not initialized')
  })

  it("paths are the app's directory and the extension's own folder under userData", () => {
    const paths = { app: '/app', userData: '/data' }
    expect(createExtensionAPI('com.paths', { paths }).paths).toEqual({
      app: '/app',
      globalStorage: '/data/extensions/com.paths',
    })
  })
})
