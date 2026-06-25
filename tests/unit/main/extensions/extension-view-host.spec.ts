import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Electron mock ---
const mockSend = vi.fn()
const mockOn = vi.fn()
const mockLoadURL = vi.fn().mockResolvedValue(undefined)
const mockReload = vi.fn()
const mockSetBounds = vi.fn()
const mockSetVisible = vi.fn()
const mockAddChildView = vi.fn()
const mockRemoveChildView = vi.fn()

const { mockDefaultSession, capturedWebContentsViewArgs } = vi.hoisted(() => ({
  mockDefaultSession: { id: 'default' } as unknown,
  capturedWebContentsViewArgs: [] as unknown[],
}))

vi.mock('electron', () => ({
  WebContentsView: class {
    constructor(...args: unknown[]) {
      capturedWebContentsViewArgs.push(args[0])
    }
    webContents = { send: mockSend, on: mockOn, loadURL: mockLoadURL, reload: mockReload }
    setBounds = mockSetBounds
    setVisible = mockSetVisible
  },
  session: { defaultSession: mockDefaultSession, fromPartition: () => mockDefaultSession },
}))

vi.mock('../../src/main/logger.js', () => ({
  makeLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('../../../src/main/logger.js', () => ({
  makeLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { ExtensionViewHost } from '../../../../src/main/extensions/extension-view-host.js'
import type { Extension } from '../../../../src/shared/types/index.js'

function makeMainWindow() {
  return {
    webContents: { send: mockSend },
    contentView: { addChildView: mockAddChildView, removeChildView: mockRemoveChildView },
  } as unknown as Parameters<typeof ExtensionViewHost>[0]
}

function makeExt(overrides: Partial<Extension> = {}): Extension {
  return {
    id: 'com.test.ext',
    name: 'Test',
    version: '1.0.0',
    status: 'enabled',
    installedAt: new Date().toISOString(),
    rendererUrl: 'ext://com.test.ext/index.html',
    contributes: {},
    ...overrides,
  } as Extension
}

describe('ExtensionViewHost', () => {
  let host: ExtensionViewHost
  let mainWindow: ReturnType<typeof makeMainWindow>

  beforeEach(() => {
    vi.clearAllMocks()
    mainWindow = makeMainWindow()
    host = new ExtensionViewHost(mainWindow as never, '/fake/preload/webview.js')
  })

  it('hasView returns false before any view is created', () => {
    expect(host.hasView('com.test.ext', 'main')).toBe(false)
  })

  it('createView adds a WebContentsView to contentView and stores it', async () => {
    await host.createView(makeExt(), 'main')
    expect(mockAddChildView).toHaveBeenCalled()
    expect(host.hasView('com.test.ext', 'main')).toBe(true)
  })

  it('createView uses ext-views partition with preload and context isolation', async () => {
    capturedWebContentsViewArgs.length = 0
    await host.createView(makeExt(), 'main')
    expect(capturedWebContentsViewArgs[0]).toEqual(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          session: mockDefaultSession,
          preload: '/fake/preload/webview.js',
          contextIsolation: true,
          nodeIntegration: false,
        }),
      })
    )
  })

  it('createView passes viewParam as ?view= query param', async () => {
    await host.createView(makeExt(), 'sidebar')
    expect(mockLoadURL).toHaveBeenCalledWith(expect.stringContaining('view=sidebar'))
  })

  it('createView does nothing when ext has no rendererUrl', async () => {
    await host.createView(makeExt({ rendererUrl: undefined }), 'main')
    expect(mockAddChildView).not.toHaveBeenCalled()
    expect(host.hasView('com.test.ext', 'main')).toBe(false)
  })

  it('hasView returns true after createView', async () => {
    await host.createView(makeExt(), 'main')
    expect(host.hasView('com.test.ext', 'main')).toBe(true)
  })

  it('hasView returns false for a different viewParam', async () => {
    await host.createView(makeExt(), 'main')
    expect(host.hasView('com.test.ext', 'sidebar')).toBe(false)
  })

  it('destroyAllViews removes views from contentView and clears the map', async () => {
    await host.createView(makeExt(), 'main')
    host.destroyAllViews('com.test.ext')
    expect(mockRemoveChildView).toHaveBeenCalled()
    expect(host.hasView('com.test.ext', 'main')).toBe(false)
  })

  it('destroyAllViews is a no-op for unknown extensionId', () => {
    host.destroyAllViews('com.unknown')
    expect(mockRemoveChildView).not.toHaveBeenCalled()
  })

  it('reloadAllViews reloads all views for the extension', async () => {
    await host.createView(makeExt(), 'main')
    host.reloadAllViews('com.test.ext')
    expect(mockReload).toHaveBeenCalled()
  })

  it('reloadAllViews is a no-op for unknown extensionId', () => {
    host.reloadAllViews('com.unknown')
    expect(mockReload).not.toHaveBeenCalled()
  })

  it('handleBoundsUpdate sets bounds and visibility on the matching view', async () => {
    await host.createView(makeExt(), 'main')
    host.handleBoundsUpdate(
      'com.test.ext',
      'main',
      { x: 10, y: 20, width: 400, height: 300 },
      true,
      2
    )
    expect(mockSetBounds).toHaveBeenCalledWith({ x: 20, y: 40, width: 800, height: 600 })
    expect(mockSetVisible).toHaveBeenCalledWith(true)
  })

  it('handleBoundsUpdate sets visible: false when not visible', async () => {
    await host.createView(makeExt(), 'main')
    host.handleBoundsUpdate(
      'com.test.ext',
      'main',
      { x: 0, y: 0, width: 100, height: 100 },
      false,
      1
    )
    expect(mockSetVisible).toHaveBeenCalledWith(false)
  })

  it('handleBoundsUpdate is a no-op for unknown extension', () => {
    host.handleBoundsUpdate('com.unknown', 'main', { x: 0, y: 0, width: 100, height: 100 }, true, 1)
    expect(mockSetBounds).not.toHaveBeenCalled()
  })

  it('handleBoundsUpdate is a no-op for unknown viewParam', async () => {
    await host.createView(makeExt(), 'main')
    host.handleBoundsUpdate(
      'com.test.ext',
      'sidebar',
      { x: 0, y: 0, width: 100, height: 100 },
      true,
      1
    )
    expect(mockSetBounds).not.toHaveBeenCalled()
  })

  it('broadcastToAll sends to all views across all extensions', async () => {
    await host.createView(makeExt(), 'main')
    host.broadcastToAll('workspace:changed', { foo: 'bar' })
    expect(mockSend).toHaveBeenCalledWith('workspace:changed', { foo: 'bar' })
  })

  it('broadcastToExtension sends only to views for the given extension', async () => {
    await host.createView(makeExt(), 'main')
    host.broadcastToExtension('com.test.ext', 'test:event', { data: 1 })
    expect(mockSend).toHaveBeenCalledWith('test:event', { data: 1 })
  })

  it('broadcastToExtension is a no-op for unknown extension', () => {
    host.broadcastToExtension('com.unknown', 'test:event', {})
    expect(mockSend).not.toHaveBeenCalled()
  })
})
