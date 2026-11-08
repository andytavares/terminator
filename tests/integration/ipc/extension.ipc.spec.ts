import { describe, it, expect, vi, beforeEach } from 'vitest'

// The handlers delegate to the real api.ts registry query functions, so this
// spec uses the real api module and seeds the real globalRegistry, and the
// real stores over an in-memory electron-store.
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  Menu: {
    getApplicationMenu: vi.fn(() => null),
    buildFromTemplate: vi.fn((t) => t),
    setApplicationMenu: vi.fn(),
  },
  MenuItem: vi.fn().mockImplementation((opts) => opts),
  Notification: Object.assign(
    vi.fn().mockImplementation(() => ({ show: vi.fn() })),
    { isSupported: vi.fn(() => false) }
  ),
  app: { dock: null },
}))

vi.mock('../../../src/main/shell/shell-executor', () => ({
  execShell: vi.fn(),
  assertCommandAllowed: vi.fn(),
  assertCwdInScope: vi.fn(),
  CommandNotAllowedError: class extends Error {},
  CwdOutOfScopeError: class extends Error {},
}))

vi.mock('electron-store', async () =>
  (await import('../../support/stores')).inMemoryElectronStore()
)

import type { ExtensionHost } from '../../../src/main/extensions/extension-host'
import { partialFake } from '../../support/fakes'

const mockExtensionHost = {
  setEnabled: vi.fn(),
  uninstallExtension: vi.fn(),
  reloadExtension: vi.fn(),
  whenActivated: vi.fn().mockResolvedValue(undefined),
}
const extensionHost = partialFake<ExtensionHost>(mockExtensionHost)

type ApiModule = typeof import('../../../src/main/extensions/api')
type ExtensionIpcModule = typeof import('../../../src/main/ipc/extension.ipc')

// Imported again for each test, after vi.resetModules(), so the registry and the
// in-memory extension-settings store start empty every time.
let ipcMain: (typeof import('electron'))['ipcMain']
let globalRegistry: ApiModule['globalRegistry']
let registerExtensionHandlers: ExtensionIpcModule['registerExtensionHandlers']

function captureHandle(channel: string): (event: unknown, payload?: unknown) => unknown {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const match = calls.find(([ch]) => ch === channel)
  if (!match) throw new Error(`No handler registered for: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => unknown
}

function useExtensionHandlers(): void {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    ;({ ipcMain } = await import('electron'))
    ;({ globalRegistry } = await import('../../../src/main/extensions/api'))
    ;({ registerExtensionHandlers } = await import('../../../src/main/ipc/extension.ipc'))
    registerExtensionHandlers(extensionHost, vi.fn())
  })
}

describe('extension IPC handlers — extension:toggle', () => {
  useExtensionHandlers()

  it('returns NOT_FOUND error when toggle returns null', async () => {
    mockExtensionHost.setEnabled.mockResolvedValue(null)
    const handler = captureHandle('extension:toggle')
    const result = (await handler({}, { id: 'missing', enabled: true })) as { error: string }
    expect(result.error).toBe('NOT_FOUND')
  })
})

describe('extension IPC handlers — extension:uninstall', () => {
  useExtensionHandlers()

  it('returns ok when extension is removed', async () => {
    mockExtensionHost.uninstallExtension.mockResolvedValue(true)
    const handler = captureHandle('extension:uninstall')
    const result = (await handler({}, { id: 'com.test' })) as { ok: boolean }
    expect(mockExtensionHost.uninstallExtension).toHaveBeenCalledWith('com.test')
    expect(result.ok).toBe(true)
  })

  it('returns NOT_FOUND when extension does not exist', async () => {
    mockExtensionHost.uninstallExtension.mockResolvedValue(false)
    const handler = captureHandle('extension:uninstall')
    const result = (await handler({}, { id: 'missing' })) as { error: string }
    expect(result.error).toBe('NOT_FOUND')
  })
})

describe('extension IPC handlers — extension:reload broadcasts', () => {
  useExtensionHandlers()

  it('calls broadcast with extension:renderer-reload on successful reload', async () => {
    const broadcast = vi.fn()
    vi.clearAllMocks()
    registerExtensionHandlers(extensionHost, broadcast)
    const ext = { id: 'com.test', status: 'enabled' }
    mockExtensionHost.reloadExtension.mockResolvedValue({ extension: ext })
    const handler = captureHandle('extension:reload')
    await handler({}, { id: 'com.test' })
    expect(broadcast).toHaveBeenCalledWith('extension:renderer-reload', { id: 'com.test' })
  })

  it('does not call broadcast when reload fails', async () => {
    const broadcast = vi.fn()
    vi.clearAllMocks()
    registerExtensionHandlers(extensionHost, broadcast)
    mockExtensionHost.reloadExtension.mockResolvedValue({ error: 'NOT_FOUND' })
    const handler = captureHandle('extension:reload')
    await handler({}, { id: 'missing' })
    expect(broadcast).not.toHaveBeenCalled()
  })
})

describe('extension IPC handlers — extension:get-settings-schemas', () => {
  useExtensionHandlers()

  it('returns empty schemas when none registered', async () => {
    const handler = captureHandle('extension:get-settings-schemas')
    const result = (await handler({})) as { schemas: unknown[] }
    expect(result.schemas).toEqual([])
  })

  it('returns registered schemas with extensionId derived from key', async () => {
    ;(globalRegistry.settingsSections as Map<string, unknown>).set('com.test.settings', {
      label: 'Test Extension',
      properties: { 'com.test.key': { type: 'string', label: 'Key', default: '' } },
    })
    const handler = captureHandle('extension:get-settings-schemas')
    const result = (await handler({})) as {
      schemas: Array<{ extensionId: string; label: string }>
    }
    expect(result.schemas).toHaveLength(1)
    expect(result.schemas[0].extensionId).toBe('com.test')
    expect(result.schemas[0].label).toBe('Test Extension')
  })
})

describe('extension IPC handlers — extension settings values', () => {
  useExtensionHandlers()

  it('answers what extension:update-setting stored', async () => {
    const update = captureHandle('extension:update-setting')
    const values = captureHandle('extension:get-settings-values')

    expect(await values({})).toEqual({ values: {} })
    expect(await update({}, { key: 'com.test.token', value: 'abc123' })).toEqual({ ok: true })
    expect(await values({})).toEqual({ values: { 'com.test.token': 'abc123' } })
  })

  // The remote bridge sends JSON, which drops a key whose value is undefined.
  it('takes a payload with no value', async () => {
    const update = captureHandle('extension:update-setting')

    expect(await update({}, { key: 'com.test.token' })).toEqual({ ok: true })
  })
})

describe('extension IPC handlers — extension:run-command', () => {
  useExtensionHandlers()

  it('runs a command called with no arguments', async () => {
    const handler = vi.fn()
    globalRegistry.commandHandlers.set('com.test.refresh', handler)
    const run = captureHandle('extension:run-command')

    expect(await run({}, { key: 'com.test.refresh' })).toEqual({ ok: true })
    expect(handler).toHaveBeenCalledOnce()
  })
})

// Workspace Settings sets a `workspaceScoped` setting for one workspace; the
// value lives in that workspace's settings, under the extension that declared it.
const WORKSPACE_ID = '7f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b'

function registerSignOff(): void {
  ;(globalRegistry.settingsSections as Map<string, unknown>).set('com.test.settings', {
    label: 'Test Extension',
    properties: {
      'com.test.signOff': {
        type: 'boolean',
        label: 'Sign off',
        default: false,
        workspaceScoped: true,
      },
      'com.test.token': { type: 'string', label: 'Token', default: '' },
    },
  })
}

describe('extension IPC handlers — a workspace value', () => {
  useExtensionHandlers()

  it('stores it under the extension that declared the key, and "Use global default" removes it', async () => {
    registerSignOff()
    const update = captureHandle('extension:update-workspace-setting')

    const set = (await update(
      {},
      { workspaceId: WORKSPACE_ID, key: 'com.test.signOff', value: true }
    )) as {
      settings: { extensions: unknown }
    }
    expect(set.settings.extensions).toEqual({ 'com.test': { 'com.test.signOff': true } })

    const cleared = (await update({}, { workspaceId: WORKSPACE_ID, key: 'com.test.signOff' })) as {
      settings: { extensions: unknown }
    }
    expect(cleared.settings.extensions).toEqual({ 'com.test': {} })
  })
})

describe('extension IPC handlers — a workspace value for another key', () => {
  useExtensionHandlers()

  it.each(['com.test.token', 'com.other.unknown'])(
    'refuses %s, a key no extension declared workspaceScoped',
    async (key) => {
      registerSignOff()
      const update = captureHandle('extension:update-workspace-setting')

      expect(await update({}, { workspaceId: WORKSPACE_ID, key, value: 'x' })).toEqual({
        error: 'NOT_WORKSPACE_SCOPED',
      })
    }
  )
})
