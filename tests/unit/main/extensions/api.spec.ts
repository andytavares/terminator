import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()
const mockWindow = {
  webContents: { send: mockSend, isDestroyed: vi.fn(() => false) },
  isDestroyed: vi.fn(() => false),
}

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

vi.mock('../../../../src/main/shell/shell-executor', () => ({
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
vi.mock('../../../../src/main/storage/extension-settings-store', () => ({
  getExtensionSetting: (key: string) => mockExtensionStore[key],
  setExtensionSetting: (key: string, value: unknown) => {
    mockExtensionStore[key] = value
  },
  getAllExtensionSettings: () => ({ ...mockExtensionStore }),
}))

const mockGetGlobalSettings = vi.fn()
const mockGetWorkspaceSettings = vi.fn()
vi.mock('../../../../src/main/storage/settings-store', () => ({
  getGlobalSettings: () => mockGetGlobalSettings(),
  getWorkspaceSettings: (id: string) => mockGetWorkspaceSettings(id),
}))

const mockListWorkspaces = vi.fn(
  () => [] as Array<{ id: string; name: string; folderPath: string }>
)
vi.mock('../../../../src/main/storage/workspace-store', () => ({
  listWorkspaces: () => mockListWorkspaces(),
  listProjects: () => [],
  deleteProject: vi.fn(),
}))

import {
  createExtensionAPI,
  globalRegistry,
  listExtensionCommands,
  executeExtensionCommand,
} from '../../../../src/main/extensions/api'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetGlobalSettings.mockReturnValue({
    notifications: { defaultTargets: ['system', 'center', 'toast'], extensionOverrides: {} },
  })
  globalRegistry.commandContributions.clear()
  globalRegistry.commandHandlers.clear()
  globalRegistry.commandDisabledReasons.clear()
})

describe('api.commands.register', () => {
  it('has no keyboard.register member — the interface was deleted', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    expect('keyboard' in api).toBe(false)
  })

  it('registers a command with mnemonic and requires', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.commands.register({ id: 'push', label: 'Push', mnemonic: 'p', requires: 'repo' }, vi.fn())
    const cmd = listExtensionCommands().find((c) => c.id === 'push')
    expect(cmd).toMatchObject({
      extensionId: 'test.ext',
      id: 'push',
      label: 'Push',
      mnemonic: 'p',
      requires: 'repo',
    })
  })

  it('passes CommandContext through to the handler', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const handler = vi.fn()
    api.commands.register({ id: 'push', label: 'Push' }, handler)
    const key = listExtensionCommands().find((c) => c.id === 'push')!.key

    const ctx = { projectId: 'p1', sessionId: 's1', repoRoot: '/repo' }
    await executeExtensionCommand(key, ctx)

    expect(handler).toHaveBeenCalledWith(ctx)
  })

  it('zero-arg handlers still work when a ctx is passed', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const handler = vi.fn(() => {})
    api.commands.register({ id: 'noop', label: 'Noop' }, handler)
    const key = listExtensionCommands().find((c) => c.id === 'noop')!.key

    await executeExtensionCommand(key, { projectId: null, sessionId: null, repoRoot: null })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('a disposed command clears its disabled reason', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const disposable = api.commands.register({ id: 'push', label: 'Push' }, vi.fn())
    api.commands.setEnabled('push', false, 'No repository focused')
    disposable.dispose()

    expect(listExtensionCommands().find((c) => c.id === 'push')).toBeUndefined()
    expect(globalRegistry.commandDisabledReasons.size).toBe(0)
  })
})

describe('api.commands.setEnabled', () => {
  it('sets a disabledReason that listExtensionCommands surfaces', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.commands.register({ id: 'push', label: 'Push' }, vi.fn())
    api.commands.setEnabled('push', false, 'No repository focused')

    const cmd = listExtensionCommands().find((c) => c.id === 'push')
    expect(cmd?.disabledReason).toBe('No repository focused')
  })

  it('defaults the reason when none is given', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.commands.register({ id: 'push', label: 'Push' }, vi.fn())
    api.commands.setEnabled('push', false)

    expect(listExtensionCommands().find((c) => c.id === 'push')?.disabledReason).toBe('Disabled')
  })

  it('clears the reason when re-enabled', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.commands.register({ id: 'push', label: 'Push' }, vi.fn())
    api.commands.setEnabled('push', false, 'No repository focused')
    api.commands.setEnabled('push', true)

    expect(listExtensionCommands().find((c) => c.id === 'push')?.disabledReason).toBeUndefined()
  })

  it('a disabled command does not run', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    const handler = vi.fn()
    api.commands.register({ id: 'push', label: 'Push' }, handler)
    api.commands.setEnabled('push', false, 'No repository focused')
    const key = listExtensionCommands().find((c) => c.id === 'push')!.key

    await executeExtensionCommand(key, { projectId: null, sessionId: null, repoRoot: null })

    expect(handler).not.toHaveBeenCalled()
  })
})

describe('executeExtensionCommand', () => {
  it('is a no-op for an unknown key', async () => {
    await expect(
      executeExtensionCommand('unknown-key', { projectId: null, sessionId: null, repoRoot: null })
    ).resolves.toBeUndefined()
  })

  it('logs, and does not throw, when the handler rejects', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.commands.register(
      { id: 'boom', label: 'Boom' },
      vi.fn().mockRejectedValue(new Error('kaboom'))
    )
    const key = listExtensionCommands().find((c) => c.id === 'boom')!.key

    await expect(
      executeExtensionCommand(key, { projectId: null, sessionId: null, repoRoot: null })
    ).resolves.toBeUndefined()
  })

  it('logs, and does not throw, when the handler throws synchronously', async () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.commands.register(
      { id: 'boom', label: 'Boom' },
      vi.fn(() => {
        throw new Error('kaboom')
      })
    )
    const key = listExtensionCommands().find((c) => c.id === 'boom')!.key

    await expect(
      executeExtensionCommand(key, { projectId: null, sessionId: null, repoRoot: null })
    ).resolves.toBeUndefined()
  })
})

describe('api.window.showSelf', () => {
  it('broadcasts extension:show-surface with the extension id and default view', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.window.showSelf()

    expect(mockSend).toHaveBeenCalledWith('extension:show-surface', {
      extensionId: 'test.ext',
      view: 'main',
    })
  })

  it('broadcasts the given view', () => {
    const api = createExtensionAPI('test.ext', '0.1.0')
    api.window.showSelf('sidebar')

    expect(mockSend).toHaveBeenCalledWith('extension:show-surface', {
      extensionId: 'test.ext',
      view: 'sidebar',
    })
  })
})
