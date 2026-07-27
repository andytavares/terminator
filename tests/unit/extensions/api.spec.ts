import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()
const mockWindow = { webContents: { send: mockSend }, isDestroyed: vi.fn(() => false) }

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
  listExtensionSidebarItems,
  listExtensionContextMenuItems,
  dispatchContextMenuClick,
  listExtensionCommands,
  executeExtensionCommand,
  listNativeViewMenuItems,
  getPanelMenuItemId,
  setSupervisionDeps,
} from '../../../src/main/extensions/api'
import { ipcInvokeRegistry } from '../../../src/main/remote/ipc-registry'
import * as shellExecutor from '../../../src/main/shell/shell-executor'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetGlobalSettings.mockReturnValue({
    notifications: { defaultTargets: ['system', 'center', 'toast'], extensionOverrides: {} },
  })
  // Reset shared registry state between tests
  globalRegistry.sidebarPanels.clear()
  globalRegistry.topBarItems.clear()
  globalRegistry.nativeMenuItems.clear()
  globalRegistry.settingsSections.clear()
})

describe('api.settings.resolveWorktreeBaseDir', () => {
  beforeEach(() => {
    mockGetGlobalSettings.mockReturnValue({ git: { worktreeBaseDir: '' } })
    mockGetWorkspaceSettings.mockReturnValue({ workspaceId: 'w1', overrides: {}, extensions: {} })
    mockListWorkspaces.mockReturnValue([{ id: 'w1', name: 'WS', folderPath: '/repo' }])
  })

  it('defaults to <workspacePath>/.worktrees when nothing is configured', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(api.settings.resolveWorktreeBaseDir('/repo')).toBe('/repo/.worktrees')
  })

  it('uses the global git.worktreeBaseDir setting when set', () => {
    mockGetGlobalSettings.mockReturnValue({ git: { worktreeBaseDir: '/global/wt' } })
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(api.settings.resolveWorktreeBaseDir('/repo')).toBe('/global/wt')
  })

  it('prefers a workspace override over the global setting', () => {
    mockGetGlobalSettings.mockReturnValue({ git: { worktreeBaseDir: '/global/wt' } })
    mockGetWorkspaceSettings.mockReturnValue({
      workspaceId: 'w1',
      overrides: { git: { worktreeBaseDir: '/ws/override' } },
      extensions: {},
    })
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(api.settings.resolveWorktreeBaseDir('/repo')).toBe('/ws/override')
  })

  it('falls back to the default when the workspace path matches no known workspace', () => {
    mockListWorkspaces.mockReturnValue([])
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(api.settings.resolveWorktreeBaseDir('/unknown')).toBe('/unknown/.worktrees')
  })

  it('never returns the legacy .wt directory', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(api.settings.resolveWorktreeBaseDir('/repo')).not.toContain('.wt/')
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

describe('api.sidebar.registerPanel', () => {
  it('registers a panel and returns a disposable', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.sidebar.registerPanel('right-sidebar', {
      id: 'test-panel',
      title: 'Test Panel',
      component: {} as unknown,
      defaultVisible: false,
    })

    expect(disposable).toHaveProperty('dispose')
    expect(globalRegistry.sidebarPanels.has('test.ext.panel.right-sidebar')).toBe(true)
  })

  it('throws SLOT_ALREADY_REGISTERED when same slot registered twice by same extension', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.sidebar.registerPanel('right-sidebar', {
      id: 'panel-1',
      title: 'Panel 1',
      component: {} as unknown,
    })

    expect(() =>
      api.sidebar.registerPanel('right-sidebar', {
        id: 'panel-2',
        title: 'Panel 2',
        component: {} as unknown,
      })
    ).toThrow('SLOT_ALREADY_REGISTERED')
  })

  it('allows different extensions to register in same slot', () => {
    const api1 = createExtensionAPI('ext.one', '0.1.0')
    const api2 = createExtensionAPI('ext.two', '0.1.0')

    expect(() => {
      api1.sidebar.registerPanel('right-sidebar', {
        id: 'p1',
        title: 'P1',
        component: {} as unknown,
      })
      api2.sidebar.registerPanel('right-sidebar', {
        id: 'p2',
        title: 'P2',
        component: {} as unknown,
      })
    }).not.toThrow()
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

describe('api.contextMenu.registerItem', () => {
  it('registers item and returns disposable', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const onClick = vi.fn<[string], void>()
    const disposable = api.contextMenu.registerItem('workspace', {
      id: 'ctx-item',
      label: 'Open',
      onClick,
    })
    expect(disposable).toHaveProperty('dispose')
    disposable.dispose()
  })
})

describe('api.keyboard.register', () => {
  it('registers a shortcut and returns disposable', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const handler = vi.fn()
    const disposable = api.keyboard.register('Ctrl+Shift+Z', handler)
    expect(disposable).toHaveProperty('dispose')
    disposable.dispose()
  })

  it('throws when accelerator is reserved', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(() => api.keyboard.register('CmdOrCtrl+T', vi.fn())).toThrow('reserved')
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

  it('records the channel as remoteAccessible by default', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.ipc.registerHandler('test.ext:remote-default', vi.fn())
    expect(ipcInvokeRegistry.get('test.ext:remote-default')?.remoteAccessible).toBe(true)
    disposable.dispose()
    expect(ipcInvokeRegistry.has('test.ext:remote-default')).toBe(false)
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

describe('api.sidebar.registerGlobalTab', () => {
  it('registers a global tab and returns disposable', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.sidebar.registerGlobalTab({
      id: 'my-tab',
      label: 'My Tab',
      component: {} as unknown,
    })
    expect(disposable).toHaveProperty('dispose')
    disposable.dispose()
  })

  it('throws GLOBAL_TAB_ALREADY_REGISTERED when same tab registered twice', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.sidebar.registerGlobalTab({ id: 'dup-tab', label: 'Dup', component: {} as unknown })
    expect(() =>
      api.sidebar.registerGlobalTab({ id: 'dup-tab', label: 'Dup 2', component: {} as unknown })
    ).toThrow('GLOBAL_TAB_ALREADY_REGISTERED')
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
      attachOnData: vi.fn(() => () => {}),
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

describe('api.pty.attachOnData', () => {
  it('delegates to ptyManager.attachOnData when deps are provided', () => {
    const mockDispose = vi.fn()
    const mockPtyMgr = {
      spawn: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      listSessions: vi.fn(() => []),
      attachOnData: vi.fn(() => mockDispose),
    }
    const api = createExtensionAPI('test.ext', '0.1.0', {
      ptyManager: mockPtyMgr as never,
    })
    const onData = vi.fn()
    const dispose = api.pty.attachOnData('s1', onData)
    expect(mockPtyMgr.attachOnData).toHaveBeenCalledWith('s1', onData)
    expect(dispose).toBe(mockDispose)
  })

  it('returns null when no ptyManager dep is provided', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect(api.pty.attachOnData('s1', vi.fn())).toBeNull()
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

  it('listExtensionSidebarItems returns the renderer-facing shape', () => {
    const api = createExtensionAPI('com.query.sidebar', '0.1.0')
    const d = api.sidebar.registerItem({ id: 'q-item', label: 'Q', tooltip: 'tip' })
    expect(listExtensionSidebarItems()).toContainEqual({ id: 'q-item', label: 'Q', tooltip: 'tip' })
    d.dispose()
  })

  it('context menu items are listed per target and dispatched by id', () => {
    const api = createExtensionAPI('com.query.ctx', '0.1.0')
    const onClick = vi.fn()
    const d = api.contextMenu.registerItem('workspace', { id: 'q-ctx', label: 'Do', onClick })
    expect(listExtensionContextMenuItems('workspace')).toContainEqual({ id: 'q-ctx', label: 'Do' })
    expect(listExtensionContextMenuItems('project')).toEqual([])
    dispatchContextMenuClick('workspace', 'q-ctx', 'target-1')
    expect(onClick).toHaveBeenCalledWith('target-1')
    dispatchContextMenuClick('workspace', 'nope', 'target-1')
    expect(onClick).toHaveBeenCalledTimes(1)
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

// The supervision surface an extension sees. Read-only by construction: no
// transcript path, no pending permission, no raw event stream, and no way to
// assert a runtime state (Constitution II, FR-070 – FR-073).

describe('the supervision extension API', () => {
  const session = { id: 's1', repoPath: '/repo', branch: 'feat/x', runtimeState: 'working' }

  function withDeps(over: Record<string, unknown> = {}) {
    const off = vi.fn()
    const deps = {
      listSessions: vi.fn().mockReturnValue([session]),
      getSession: vi.fn().mockReturnValue(session),
      onStateChanged: vi.fn().mockReturnValue(off),
      provisionWorktree: vi.fn().mockResolvedValue({ worktreePath: '/wt/s1' }),
      releaseWorktree: vi.fn().mockResolvedValue(undefined),
      listWorktrees: vi.fn().mockReturnValue([{ worktreePath: '/wt/s1' }]),
      publicationDirectoryFor: vi.fn().mockReturnValue('/data/workitems/test.ext'),
      registerProducer: vi.fn(),
      unregisterProducer: vi.fn(),
      ...over,
    }
    setSupervisionDeps(deps as never)
    return { deps, off }
  }

  it('lists sessions and reads one', async () => {
    const { deps } = withDeps()
    const api = createExtensionAPI('test.ext', '0.1.0')
    await expect(api.supervision.listSessions()).resolves.toEqual([session])
    await expect(api.supervision.getSession('s1')).resolves.toEqual(session)
    expect(deps.getSession).toHaveBeenCalledWith('s1')
  })

  it('subscribes to state changes and unsubscribes on dispose', () => {
    const { deps, off } = withDeps()
    const api = createExtensionAPI('test.ext', '0.1.0')
    const handler = vi.fn()
    const subscription = api.supervision.onStateChanged(handler)
    expect(deps.onStateChanged).toHaveBeenCalledWith(handler)
    subscription.dispose()
    expect(off).toHaveBeenCalled()
  })

  it('provisions, lists and releases worktrees', async () => {
    const { deps } = withDeps()
    const api = createExtensionAPI('test.ext', '0.1.0')
    await expect(
      api.worktrees.provision({ repoPath: '/repo', branch: 'feat/x' })
    ).resolves.toMatchObject({ worktreePath: '/wt/s1' })
    await expect(api.worktrees.list()).resolves.toHaveLength(1)
    await api.worktrees.release('/wt/s1')
    expect(deps.releaseWorktree).toHaveBeenCalledWith('/wt/s1')
  })

  it('hands a producer its own publication directory, never a shared one', async () => {
    const { deps } = withDeps()
    const api = createExtensionAPI('test.ext', '0.1.0')
    await expect(api.workItems.publicationDirectory()).resolves.toBe('/data/workitems/test.ext')
    expect(deps.publicationDirectoryFor).toHaveBeenCalledWith('test.ext')
  })

  it('registers a producer and unregisters it on dispose', () => {
    const { deps } = withDeps()
    const api = createExtensionAPI('test.ext', '0.1.0')
    const handlers = { approveGate: vi.fn() }
    const subscription = api.workItems.registerProducer(handlers)
    expect(deps.registerProducer).toHaveBeenCalledWith('test.ext', handlers)
    subscription.dispose()
    expect(deps.unregisterProducer).toHaveBeenCalledWith('test.ext')
  })
})

describe('the supervision extension API on a console built without supervision (SC-011)', () => {
  beforeEach(() => {
    // The injection point is module state; clearing it is how a host that never
    // wired supervision is represented.
    setSupervisionDeps(null as never)
  })

  it('reports an empty session list rather than throwing', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    await expect(api.supervision.listSessions()).resolves.toEqual([])
    await expect(api.supervision.getSession('s1')).resolves.toBeNull()
  })

  it('returns a disposable subscription that is safe to dispose', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const subscription = api.supervision.onStateChanged(vi.fn())
    expect(() => subscription.dispose()).not.toThrow()
  })

  it('reports no worktrees and releases nothing', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    await expect(api.worktrees.list()).resolves.toEqual([])
    await expect(api.worktrees.release('/wt/s1')).resolves.toBeUndefined()
  })

  it('refuses to provision, saying why rather than failing silently', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    await expect(api.worktrees.provision({ repoPath: '/repo', branch: 'b' })).rejects.toThrow(
      /supervision is not available/
    )
  })

  it('refuses to hand out a publication directory that does not exist', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    await expect(api.workItems.publicationDirectory()).rejects.toThrow(
      /supervision is not available/
    )
  })

  it('accepts a producer registration that goes nowhere, rather than throwing', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const subscription = api.workItems.registerProducer({})
    expect(() => subscription.dispose()).not.toThrow()
  })
})
