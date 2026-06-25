import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Extension } from '../../../src/shared/types/index.js'

const createdViews = vi.hoisted(
  () =>
    [] as Array<{
      webContents: {
        loadURL: ReturnType<typeof vi.fn>
        send: ReturnType<typeof vi.fn>
        reload: ReturnType<typeof vi.fn>
        on: ReturnType<typeof vi.fn>
      }
      setBounds: ReturnType<typeof vi.fn>
      setVisible: ReturnType<typeof vi.fn>
    }>
)

vi.mock('electron', () => ({
  WebContentsView: class {
    webContents = {
      loadURL: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(),
      reload: vi.fn(),
      on: vi.fn(),
    }
    setBounds = vi.fn()
    setVisible = vi.fn()
    constructor() {
      createdViews.push(this as never)
    }
  },
}))

import { ExtensionViewHost } from '../../../src/main/extensions/extension-view-host.js'

const mockContentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
const mockWindow = { contentView: mockContentView, webContents: { send: vi.fn() } }

const makeExt = (overrides: Partial<Extension> = {}): Extension => ({
  id: 'com.test.ext',
  name: 'Test Extension',
  version: '1.0.0',
  description: 'Test',
  entryPoint: '/tmp/ext/dist/main.cjs',
  status: 'enabled',
  installedAt: new Date().toISOString(),
  rendererUrl: 'ext://com.test.ext/dist/index.html',
  contributes: { globalTab: { label: 'Test', view: 'main' } },
  ...overrides,
})

describe('ExtensionViewHost', () => {
  let host: ExtensionViewHost

  beforeEach(() => {
    createdViews.length = 0
    vi.clearAllMocks()
    host = new ExtensionViewHost(mockWindow as never)
  })

  describe('createView', () => {
    it('creates a WebContentsView and adds it to contentView', async () => {
      await host.createView(makeExt(), 'main')
      expect(createdViews).toHaveLength(1)
      expect(mockContentView.addChildView).toHaveBeenCalledWith(createdViews[0])
    })

    it('loads the ext:// URL into the view', async () => {
      await host.createView(makeExt(), 'main')
      expect(createdViews[0].webContents.loadURL).toHaveBeenCalledWith(
        expect.stringContaining('ext://com.test.ext/')
      )
    })

    it('appends the view param to the URL', async () => {
      await host.createView(makeExt(), 'sidebar')
      expect(createdViews[0].webContents.loadURL).toHaveBeenCalledWith(
        expect.stringContaining('view=sidebar')
      )
    })

    it('registers did-finish-load listener to send panel-loaded push', async () => {
      await host.createView(makeExt(), 'main')
      expect(createdViews[0].webContents.on).toHaveBeenCalledWith(
        'did-finish-load',
        expect.any(Function)
      )
    })

    it('does nothing if rendererUrl is absent', async () => {
      await host.createView(makeExt({ rendererUrl: undefined }), 'main')
      expect(createdViews).toHaveLength(0)
      expect(mockContentView.addChildView).not.toHaveBeenCalled()
    })
  })

  describe('destroyAllViews', () => {
    it('removes the view from contentView', async () => {
      const ext = makeExt()
      await host.createView(ext, 'main')
      const view = createdViews[0]
      host.destroyAllViews(ext.id)
      expect(mockContentView.removeChildView).toHaveBeenCalledWith(view)
    })

    it('is a no-op for unknown extension id', () => {
      expect(() => host.destroyAllViews('unknown')).not.toThrow()
    })
  })

  describe('reloadAllViews', () => {
    it('calls webContents.reload on all views for the extension', async () => {
      const ext = makeExt()
      await host.createView(ext, 'main')
      host.reloadAllViews(ext.id)
      expect(createdViews[0].webContents.reload).toHaveBeenCalled()
    })
  })

  describe('handleBoundsUpdate', () => {
    it('calls setBounds with dpr-scaled bounds', async () => {
      const ext = makeExt()
      await host.createView(ext, 'main')
      host.handleBoundsUpdate(ext.id, 'main', { x: 10, y: 20, width: 400, height: 600 }, true, 2)
      expect(createdViews[0].setBounds).toHaveBeenCalledWith({
        x: 20,
        y: 40,
        width: 800,
        height: 1200,
      })
    })

    it('calls setVisible with the visible flag', async () => {
      const ext = makeExt()
      await host.createView(ext, 'main')
      host.handleBoundsUpdate(ext.id, 'main', { x: 0, y: 0, width: 100, height: 100 }, false, 1)
      expect(createdViews[0].setVisible).toHaveBeenCalledWith(false)
    })
  })

  describe('hasView', () => {
    it('returns false before any view is created', () => {
      expect(host.hasView('com.test.ext', 'main')).toBe(false)
    })

    it('returns true after a view is created', async () => {
      await host.createView(makeExt(), 'main')
      expect(host.hasView('com.test.ext', 'main')).toBe(true)
    })

    it('returns false for a different viewParam', async () => {
      await host.createView(makeExt(), 'main')
      expect(host.hasView('com.test.ext', 'sidebar')).toBe(false)
    })
  })

  describe('broadcastToAll', () => {
    it('sends to all view webContents', async () => {
      const ext = makeExt()
      await host.createView(ext, 'main')
      host.broadcastToAll('workspace:changed', { workspaceId: 'w1' })
      expect(createdViews[0].webContents.send).toHaveBeenCalledWith('workspace:changed', {
        workspaceId: 'w1',
      })
    })
  })

  describe('broadcastToExtension', () => {
    it('sends only to views belonging to the specified extension', async () => {
      const ext1 = makeExt({
        id: 'com.test.ext1',
        rendererUrl: 'ext://com.test.ext1/dist/index.html',
      })
      const ext2 = makeExt({
        id: 'com.test.ext2',
        rendererUrl: 'ext://com.test.ext2/dist/index.html',
      })
      await host.createView(ext1, 'main')
      await host.createView(ext2, 'main')

      const view1 = createdViews[0]
      const view2 = createdViews[1]

      host.broadcastToExtension('com.test.ext1', 'ext:command:test', {})
      expect(view1.webContents.send).toHaveBeenCalledWith('ext:command:test', {})
      expect(view2.webContents.send).not.toHaveBeenCalled()
    })
  })
})
