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

const mockGetVisible = vi.fn().mockReturnValue(true)
const mockOpenDevTools = vi.fn()
const mockFocus = vi.fn()

vi.mock('electron', () => ({
  WebContentsView: class {
    constructor(...args: unknown[]) {
      capturedWebContentsViewArgs.push(args[0])
    }
    webContents = {
      send: mockSend,
      on: mockOn,
      loadURL: mockLoadURL,
      reload: mockReload,
      openDevTools: mockOpenDevTools,
      focus: mockFocus,
      insertCSS: vi.fn().mockResolvedValue(undefined),
    }
    setBounds = mockSetBounds
    setVisible = mockSetVisible
    getVisible = mockGetVisible
  },
  session: { defaultSession: mockDefaultSession, fromPartition: () => mockDefaultSession },
}))

vi.mock('../../src/main/logger.js', () => ({
  makeLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('../../../src/main/logger.js', () => ({
  makeLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import {
  ExtensionViewHost,
  EXTENSION_BASE_CSS,
} from '../../../../src/main/extensions/extension-view-host.js'
import type { Extension } from '../../../../src/shared/types/index.js'

const mockMainWebContentsFocus = vi.fn()

function makeMainWindow() {
  return {
    webContents: { send: mockSend, focus: mockMainWebContentsFocus },
    contentView: { addChildView: mockAddChildView, removeChildView: mockRemoveChildView },
    getContentBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1280, height: 800 }),
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
    host.handleBoundsUpdate('com.test.ext', 'main', { x: 10, y: 20, width: 400, height: 300 }, true)
    // width = winW(1280) - x(10) = 1270; height = bounds.height(300) (renderer-reported)
    expect(mockSetBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 1270, height: 300 })
    expect(mockSetVisible).toHaveBeenCalledWith(true)
  })

  it('handleBoundsUpdate sets visible: false when not visible', async () => {
    await host.createView(makeExt(), 'main')
    host.handleBoundsUpdate('com.test.ext', 'main', { x: 0, y: 0, width: 100, height: 100 }, false)
    expect(mockSetVisible).toHaveBeenCalledWith(false)
  })

  it('handleBoundsUpdate is a no-op for unknown extension', () => {
    host.handleBoundsUpdate('com.unknown', 'main', { x: 0, y: 0, width: 100, height: 100 }, true)
    expect(mockSetBounds).not.toHaveBeenCalled()
  })

  it('handleBoundsUpdate is a no-op for unknown viewParam', async () => {
    await host.createView(makeExt(), 'main')
    host.handleBoundsUpdate(
      'com.test.ext',
      'sidebar',
      { x: 0, y: 0, width: 100, height: 100 },
      true
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

  it('did-finish-load callback sends panel-loaded and workspace:changed when repoRoot provided', async () => {
    let finishLoadCb: (() => void) | undefined
    mockOn.mockImplementation((event: string, cb: () => void) => {
      if (event === 'did-finish-load') finishLoadCb = cb
    })
    await host.createView(makeExt(), 'main', '/repo/root')
    expect(finishLoadCb).toBeDefined()
    finishLoadCb!()
    expect(mockSend).toHaveBeenCalledWith('extension:panel-loaded', {
      id: 'com.test.ext',
      viewParam: 'main',
    })
    expect(mockSend).toHaveBeenCalledWith('workspace:changed', { repoRoot: '/repo/root' })
  })

  it('did-finish-load callback skips workspace:changed when repoRoot is null', async () => {
    let finishLoadCb: (() => void) | undefined
    mockOn.mockImplementation((event: string, cb: () => void) => {
      if (event === 'did-finish-load') finishLoadCb = cb
    })
    await host.createView(makeExt(), 'main', null)
    finishLoadCb?.()
    const workspaceCalls = mockSend.mock.calls.filter(([ch]) => ch === 'workspace:changed')
    expect(workspaceCalls).toHaveLength(0)
  })

  it('handleBoundsUpdate broadcasts workspace:changed when repoRoot changes', async () => {
    await host.createView(makeExt(), 'main', '/old-root')
    vi.clearAllMocks()
    host.handleBoundsUpdate(
      'com.test.ext',
      'main',
      { x: 0, y: 0, width: 100, height: 100 },
      true,
      '/new-root'
    )
    expect(mockSend).toHaveBeenCalledWith('workspace:changed', { repoRoot: '/new-root' })
  })

  it('createView includes repoRoot in URL when provided', async () => {
    await host.createView(makeExt(), 'main', '/my/repo')
    expect(mockLoadURL).toHaveBeenCalledWith(expect.stringContaining('repoRoot='))
  })

  it('createView URL omits repoRoot when not provided', async () => {
    await host.createView(makeExt(), 'sidebar')
    expect(mockLoadURL).toHaveBeenCalledWith(expect.not.stringContaining('repoRoot='))
  })

  it('openDevToolsForAll calls openDevTools on all views', async () => {
    await host.createView(makeExt(), 'main')
    host.openDevToolsForAll()
    expect(mockOpenDevTools).toHaveBeenCalledWith({ mode: 'detach' })
  })

  it('focusView calls focus on the matching view webContents', async () => {
    await host.createView(makeExt(), 'main')
    host.focusView('com.test.ext', 'main')
    expect(mockFocus).toHaveBeenCalled()
  })

  it('focusView is a no-op for unknown extensionId', () => {
    host.focusView('com.unknown', 'main')
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('setBottomInset re-applies bounds with reduced height for all views that have stored bounds', async () => {
    await host.createView(makeExt(), 'main')
    // Store bounds: window is 1280x800, view at y=10, height=700
    host.handleBoundsUpdate('com.test.ext', 'main', { x: 0, y: 10, width: 100, height: 700 }, true)
    vi.clearAllMocks()

    // After applying a 280px inset: maxH = 800 - 10 - 280 = 510, height = min(700, 510) = 510
    host.setBottomInset(280)
    expect(mockSetBounds).toHaveBeenCalledWith({ x: 0, y: 10, width: 1280, height: 510 })
    expect(mockSetVisible).toHaveBeenCalledWith(true)
  })

  it('setBottomInset skips views that have no stored bounds yet', async () => {
    await host.createView(makeExt(), 'main')
    // No handleBoundsUpdate call — lastBounds is null
    host.setBottomInset(280)
    expect(mockSetBounds).not.toHaveBeenCalled()
  })
})

describe('ExtensionViewHost focus restoration', () => {
  let host: ExtensionViewHost
  let mainWindow: ReturnType<typeof makeMainWindow>

  // The electron mock shares one `on` spy across every WebContentsView, so the
  // handlers are recovered positionally: one 'focus' registration per created view.
  function focusHandlers(): Array<() => void> {
    return mockOn.mock.calls
      .filter(([event]) => event === 'focus')
      .map(([, handler]) => handler as () => void)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mainWindow = makeMainWindow()
    host = new ExtensionViewHost(mainWindow as never, '/fake/preload/webview.js')
  })

  async function makeVisibleView(viewParam: string) {
    await host.createView(makeExt(), viewParam)
    host.handleBoundsUpdate(
      'com.test.ext',
      viewParam,
      { x: 0, y: 0, width: 100, height: 100 },
      true
    )
  }

  it('restores focus to the extension view that was focused when the window blurred', async () => {
    await makeVisibleView('main')

    focusHandlers()[0]() // the view takes focus
    host.captureFocusTarget() // window blurs
    host.restoreFocus() // window regains focus

    expect(mockFocus).toHaveBeenCalled()
    expect(mockMainWebContentsFocus).not.toHaveBeenCalled()
  })

  it('ignores focus moving to the main renderer after the blur snapshot was taken', async () => {
    await makeVisibleView('main')

    focusHandlers()[0]()
    host.captureFocusTarget()
    // Electron restores focus to the window's own webContents before the
    // window 'focus' event fires — that must not clobber the snapshot.
    host.noteFocused(null)
    host.restoreFocus()

    expect(mockFocus).toHaveBeenCalled()
    expect(mockMainWebContentsFocus).not.toHaveBeenCalled()
  })

  it('falls back to the main renderer when focus was last in the main renderer', async () => {
    await makeVisibleView('main')

    focusHandlers()[0]()
    host.noteFocused(null) // user clicked back into the main renderer
    host.captureFocusTarget()
    host.restoreFocus()

    expect(mockMainWebContentsFocus).toHaveBeenCalled()
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('falls back to the main renderer when the remembered view is hidden', async () => {
    await makeVisibleView('main')

    focusHandlers()[0]()
    host.captureFocusTarget()
    host.handleBoundsUpdate('com.test.ext', 'main', { x: 0, y: 0, width: 100, height: 100 }, false)
    host.restoreFocus()

    expect(mockMainWebContentsFocus).toHaveBeenCalled()
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('falls back to the main renderer when the remembered view was destroyed', async () => {
    await makeVisibleView('main')

    focusHandlers()[0]()
    host.captureFocusTarget()
    host.destroyAllViews('com.test.ext')
    host.restoreFocus()

    expect(mockMainWebContentsFocus).toHaveBeenCalled()
    expect(mockFocus).not.toHaveBeenCalled()
  })

  it('restores the correct view when several are open', async () => {
    await makeVisibleView('main')
    await makeVisibleView('sidebar')

    focusHandlers()[1]() // the sidebar view takes focus
    host.captureFocusTarget()
    host.restoreFocus()

    expect(mockFocus).toHaveBeenCalledTimes(1)
    expect(mockMainWebContentsFocus).not.toHaveBeenCalled()
  })

  it('focusView records the focused view so a later restore targets it', async () => {
    await makeVisibleView('main')

    host.focusView('com.test.ext', 'main')
    mockFocus.mockClear()

    host.captureFocusTarget()
    host.restoreFocus()

    expect(mockFocus).toHaveBeenCalled()
    expect(mockMainWebContentsFocus).not.toHaveBeenCalled()
  })

  it('restores to the main renderer when nothing has ever been focused', () => {
    host.captureFocusTarget()
    host.restoreFocus()

    expect(mockMainWebContentsFocus).toHaveBeenCalled()
  })

  describe('findViewByWebContents', () => {
    it('resolves the extension id and viewParam for a created view', async () => {
      await host.createView(makeExt(), 'sidebar')
      const { webContents } = mockAddChildView.mock.calls[0][0]

      expect(host.findViewByWebContents(webContents)).toEqual({
        extensionId: 'com.test.ext',
        viewParam: 'sidebar',
      })
    })

    it('distinguishes two views of the same extension', async () => {
      await host.createView(makeExt(), 'main')
      await host.createView(makeExt(), 'sidebar')
      const second = mockAddChildView.mock.calls[1][0].webContents

      expect(host.findViewByWebContents(second)).toEqual({
        extensionId: 'com.test.ext',
        viewParam: 'sidebar',
      })
    })

    it('returns null for webContents that belong to no extension view', () => {
      expect(host.findViewByWebContents({} as never)).toBeNull()
    })
  })
})

describe('EXTENSION_BASE_CSS', () => {
  // Regression test: these tokens are consumed by extension diff/syntax-highlighting
  // CSS (e.g. git-integration's FileDiffView/syntax-theme.css) but are only defined
  // in core's own renderer/styles.css — extension webviews never load that file, so
  // any --tm-* token used by extension CSS must also be defined here or it silently
  // resolves to nothing (no diff highlight background, no syntax colors).
  const requiredTokens = [
    '--tm-diff-added-bg',
    '--tm-diff-removed-bg',
    '--tm-syntax-comment',
    '--tm-syntax-keyword',
    '--tm-syntax-string',
    '--tm-syntax-tag',
    '--tm-syntax-literal',
    '--tm-syntax-number',
    '--tm-syntax-title',
    '--tm-syntax-attribute',
  ]

  it.each(requiredTokens)('defines %s', (token) => {
    expect(EXTENSION_BASE_CSS).toMatch(new RegExp(`${token}:\\s*\\S`))
  })
})
