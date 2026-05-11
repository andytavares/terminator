import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()
const mockWindow = { webContents: { send: mockSend } }

// Mock electron before importing api.ts
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [mockWindow]),
  },
  Menu: {
    getApplicationMenu: vi.fn(() => null),
    buildFromTemplate: vi.fn((t) => t),
    setApplicationMenu: vi.fn(),
  },
  MenuItem: vi.fn().mockImplementation((opts) => opts),
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

import { createExtensionAPI, globalRegistry } from '../../../src/main/extensions/api'
import * as shellExecutor from '../../../src/main/shell/shell-executor'

beforeEach(() => {
  vi.clearAllMocks()
  // Reset shared registry state between tests
  globalRegistry.sidebarPanels.clear()
  globalRegistry.topBarItems.clear()
  globalRegistry.nativeMenuItems.clear()
  globalRegistry.settingsSections.clear()
})

describe('api.notifications.showToast', () => {
  it('sends extension:toast IPC message to all windows', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.notifications.showToast('info', 'Hello toast')

    expect(mockSend).toHaveBeenCalledWith('extension:toast', {
      type: 'info',
      message: 'Hello toast',
    })
  })

  it('sends error toast with correct type', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.notifications.showToast('error', 'Something failed')

    expect(mockSend).toHaveBeenCalledWith('extension:toast', {
      type: 'error',
      message: 'Something failed',
    })
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
