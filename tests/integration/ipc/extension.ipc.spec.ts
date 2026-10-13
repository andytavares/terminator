import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

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

import { globalRegistry } from '../../../src/main/extensions/api'
import { registerExtensionHandlers } from '../../../src/main/ipc/extension.ipc'
import type { ExtensionHost } from '../../../src/main/extensions/extension-host'
import type { ExtensionViewHost } from '../../../src/main/extensions/extension-view-host'
import { partialFake } from '../../support/fakes'

const mockExtensionHost = {
  listExtensions: vi.fn(),
  load: vi.fn(),
  toggle: vi.fn(),
  uninstall: vi.fn(),
  reload: vi.fn(),
  whenActivated: vi.fn().mockResolvedValue(undefined),
}
const extensionHost = partialFake<ExtensionHost>(mockExtensionHost)

function captureHandle(channel: string): (event: unknown, payload?: unknown) => unknown {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const match = calls.find(([ch]) => ch === channel)
  if (!match) throw new Error(`No handler registered for: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => unknown
}

describe('extension IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalRegistry.settingsSections as Map<string, unknown>).clear()
    registerExtensionHandlers(extensionHost, vi.fn(), () => null)
  })

  describe('extension:list', () => {
    it('returns extensions from host', async () => {
      const extensions = [{ id: 'com.test', name: 'Test' }]
      mockExtensionHost.listExtensions.mockReturnValue(extensions)
      const handler = captureHandle('extension:list')
      const result = (await handler({})) as { extensions: unknown[] }
      expect(result.extensions).toEqual(extensions)
    })
  })

  describe('extension:install', () => {
    it('calls load with directoryPath and returns result', async () => {
      const ext = { extension: { id: 'com.new', name: 'New' } }
      mockExtensionHost.load.mockResolvedValue(ext)
      const handler = captureHandle('extension:install')
      const result = await handler({}, { directoryPath: '/extensions/new' })
      expect(mockExtensionHost.load).toHaveBeenCalledWith('/extensions/new')
      expect(result).toEqual(ext)
    })
  })

  describe('extension:toggle', () => {
    it('returns extension on successful toggle', async () => {
      const ext = { id: 'com.test', status: 'disabled' }
      mockExtensionHost.toggle.mockResolvedValue(ext)
      const handler = captureHandle('extension:toggle')
      const result = (await handler({}, { id: 'com.test', enabled: false })) as {
        extension: unknown
      }
      expect(mockExtensionHost.toggle).toHaveBeenCalledWith('com.test', false)
      expect(result.extension).toEqual(ext)
    })

    it('returns NOT_FOUND error when toggle returns null', async () => {
      mockExtensionHost.toggle.mockResolvedValue(null)
      const handler = captureHandle('extension:toggle')
      const result = (await handler({}, { id: 'missing', enabled: true })) as { error: string }
      expect(result.error).toBe('NOT_FOUND')
    })
  })

  describe('extension:uninstall', () => {
    it('returns ok when extension is removed', async () => {
      mockExtensionHost.uninstall.mockResolvedValue(true)
      const handler = captureHandle('extension:uninstall')
      const result = (await handler({}, { id: 'com.test' })) as { ok: boolean }
      expect(mockExtensionHost.uninstall).toHaveBeenCalledWith('com.test')
      expect(result.ok).toBe(true)
    })

    it('returns NOT_FOUND when extension does not exist', async () => {
      mockExtensionHost.uninstall.mockResolvedValue(false)
      const handler = captureHandle('extension:uninstall')
      const result = (await handler({}, { id: 'missing' })) as { error: string }
      expect(result.error).toBe('NOT_FOUND')
    })
  })

  describe('extension:reload', () => {
    it('returns extension on successful reload', async () => {
      const ext = { id: 'com.test', status: 'enabled' }
      mockExtensionHost.reload.mockResolvedValue({ extension: ext })
      const handler = captureHandle('extension:reload')
      const result = (await handler({}, { id: 'com.test' })) as { extension: unknown }
      expect(mockExtensionHost.reload).toHaveBeenCalledWith('com.test')
      expect(result.extension).toEqual(ext)
    })

    it('returns error when extension not found', async () => {
      mockExtensionHost.reload.mockResolvedValue({ error: 'NOT_FOUND' })
      const handler = captureHandle('extension:reload')
      const result = (await handler({}, { id: 'missing' })) as { error: string }
      expect(result.error).toBe('NOT_FOUND')
    })

    it('calls broadcast with extension:renderer-reload on successful reload', async () => {
      const broadcast = vi.fn()
      vi.clearAllMocks()
      registerExtensionHandlers(extensionHost, broadcast, () => null)
      const ext = { id: 'com.test', status: 'enabled' }
      mockExtensionHost.reload.mockResolvedValue({ extension: ext })
      const handler = captureHandle('extension:reload')
      await handler({}, { id: 'com.test' })
      expect(broadcast).toHaveBeenCalledWith('extension:renderer-reload', { id: 'com.test' })
    })

    it('does not call broadcast when reload fails', async () => {
      const broadcast = vi.fn()
      vi.clearAllMocks()
      registerExtensionHandlers(extensionHost, broadcast, () => null)
      mockExtensionHost.reload.mockResolvedValue({ error: 'NOT_FOUND' })
      const handler = captureHandle('extension:reload')
      await handler({}, { id: 'missing' })
      expect(broadcast).not.toHaveBeenCalled()
    })
  })

  describe('extension:update-panel-bounds', () => {
    it("places the extension's view where the renderer's placeholder is", async () => {
      const updatePanelBounds = vi.fn().mockResolvedValue(undefined)
      vi.clearAllMocks()
      registerExtensionHandlers(extensionHost, vi.fn(), () =>
        partialFake<ExtensionViewHost>({ updatePanelBounds })
      )
      const ext = { id: 'com.test', name: 'Test' }
      mockExtensionHost.listExtensions.mockReturnValue([ext])
      const bounds = { x: 10, y: 20, width: 300, height: 400 }
      await captureHandle('extension:update-panel-bounds')(
        {},
        { extensionId: 'com.test', viewParam: 'main', bounds, visible: true, repoRoot: '/repo' }
      )
      const [findExtension, ...rest] = updatePanelBounds.mock.calls[0]
      expect(rest).toEqual(['com.test', 'main', bounds, true, '/repo'])
      expect(findExtension()).toBe(ext)
    })

    it("does not create the extension's view until that extension has been activated", async () => {
      const updatePanelBounds = vi.fn().mockResolvedValue(undefined)
      vi.clearAllMocks()
      let finishActivation = () => {}
      mockExtensionHost.whenActivated.mockReturnValueOnce(
        new Promise<void>((resolve) => (finishActivation = resolve))
      )
      registerExtensionHandlers(extensionHost, vi.fn(), () =>
        partialFake<ExtensionViewHost>({ updatePanelBounds })
      )
      const bounds = { x: 0, y: 0, width: 1, height: 1 }
      const pending = captureHandle('extension:update-panel-bounds')(
        {},
        { extensionId: 'com.slow', viewParam: 'main', bounds, visible: true }
      )

      await Promise.resolve()
      expect(mockExtensionHost.whenActivated).toHaveBeenCalledWith('com.slow')
      expect(updatePanelBounds).not.toHaveBeenCalled()

      finishActivation()
      await pending
      expect(updatePanelBounds).toHaveBeenCalledTimes(1)
    })

    it('does nothing before the view host exists', async () => {
      const handler = captureHandle('extension:update-panel-bounds')
      const result = await handler(
        {},
        {
          extensionId: 'com.test',
          viewParam: 'main',
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          visible: false,
        }
      )
      expect(result).toBeUndefined()
    })
  })

  describe('extension:get-settings-schemas', () => {
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

  describe('extension settings values', () => {
    it('answers what extension:update-setting stored', async () => {
      const update = captureHandle('extension:update-setting')
      const values = captureHandle('extension:get-settings-values')

      expect(await values({})).toEqual({ values: {} })
      expect(await update({}, { key: 'com.test.token', value: 'abc123' })).toEqual({ ok: true })
      expect(await values({})).toEqual({ values: { 'com.test.token': 'abc123' } })
    })
  })
})
