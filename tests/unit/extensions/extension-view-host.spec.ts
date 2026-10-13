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
        openDevTools: ReturnType<typeof vi.fn>
        insertCSS: ReturnType<typeof vi.fn>
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
      openDevTools: vi.fn(),
      insertCSS: vi.fn().mockResolvedValue(undefined),
      isDestroyed: vi.fn().mockReturnValue(false),
    }
    setBounds = vi.fn()
    setVisible = vi.fn()
    getVisible = vi.fn().mockReturnValue(true)
    constructor() {
      createdViews.push(this as never)
    }
  },
  session: { defaultSession: {}, fromPartition: () => ({}) },
}))

import { ExtensionViewHost } from '../../../src/main/extensions/extension-view-host.js'

const mockContentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
const mockWindow = {
  contentView: mockContentView,
  webContents: { send: vi.fn() },
  getContentBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 1280, height: 800 }),
}

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

let host: ExtensionViewHost

const rect = (y: number) => ({ x: 10, y, width: 500, height: 300 })

/** Places the extension's 'panel' view at height `y` for the repo at /repo. */
function placePanel(ext: Extension, y: number, visible = true): Promise<void> {
  return host.updatePanelBounds(() => ext, {
    extensionId: ext.id,
    viewParam: 'panel',
    bounds: rect(y),
    visible,
    repoRoot: '/repo',
  })
}

function useViewHost(): void {
  beforeEach(() => {
    createdViews.length = 0
    vi.clearAllMocks()
    host = new ExtensionViewHost(mockWindow as never, '/fake/preload/webview.js')
  })
}

describe('ExtensionViewHost — createView', () => {
  useViewHost()

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

  it('injects design token CSS and signals panel-loaded on did-finish-load', async () => {
    await host.createView(makeExt(), 'main')
    const calls = (createdViews[0].webContents.on as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, () => void]
    >
    const finishLoadCb = calls.find(([event]) => event === 'did-finish-load')![1]
    finishLoadCb()
    expect(createdViews[0].webContents.insertCSS).toHaveBeenCalledWith(
      expect.stringContaining('--tm-bg-base')
    )
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('extension:panel-loaded', {
      id: 'com.test.ext',
      viewParam: 'main',
    })
  })
})

describe('ExtensionViewHost — destroyAllViews', () => {
  useViewHost()

  it('removes the view from contentView', async () => {
    const ext = makeExt()
    await host.createView(ext, 'main')
    const view = createdViews[0]
    host.destroyAllViews(ext.id)
    expect(mockContentView.removeChildView).toHaveBeenCalledWith(view)
  })
})

describe('ExtensionViewHost — broadcastToExtension', () => {
  useViewHost()

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

describe('ExtensionViewHost — reserving a strip of the window', () => {
  useViewHost()

  it('moves the view aside rather than leaving it under a drawer', async () => {
    // A WebContentsView paints above the renderer's DOM, so a panel drawn
    // over it would be invisible. The old answer was to hide every extension
    // view while a modal was open — right for a centred dialog, and wrong for
    // a drawer down one edge: opening it blanked the whole application.
    const ext = makeExt()
    await placePanel(ext, 50)
    host.setLeftInset(340)
    const bounds = createdViews[0].setBounds.mock.calls.at(-1)![0]
    expect(bounds.x).toBe(340)
  })

  it('keeps the view visible while the strip is reserved', async () => {
    const ext = makeExt()
    await placePanel(ext, 50)
    host.setLeftInset(340)
    expect(createdViews[0].setVisible).toHaveBeenLastCalledWith(true)
  })

  it('narrows the view by exactly what it gave up', async () => {
    const ext = makeExt()
    await placePanel(ext, 50)
    const before = createdViews[0].setBounds.mock.calls.at(-1)![0]
    host.setLeftInset(340)
    const after = createdViews[0].setBounds.mock.calls.at(-1)![0]
    expect(after.x - before.x + after.width).toBe(before.width)
  })
})

describe('ExtensionViewHost — releasing and bounding the strip', () => {
  useViewHost()

  it('gives the strip back when the drawer closes', async () => {
    const ext = makeExt()
    await placePanel(ext, 50)
    const before = createdViews[0].setBounds.mock.calls.at(-1)![0]
    host.setLeftInset(340)
    host.setLeftInset(0)
    expect(createdViews[0].setBounds.mock.calls.at(-1)![0]).toEqual(before)
  })

  it('leaves a view already right of the strip where it is', async () => {
    const ext = makeExt()
    await placePanel(ext, 50)
    host.setLeftInset(5)
    expect(createdViews[0].setBounds.mock.calls.at(-1)![0].x).toBe(10)
  })

  it('refuses a negative reservation rather than pushing the view off-screen', async () => {
    const ext = makeExt()
    await placePanel(ext, 50)
    host.setLeftInset(-500)
    expect(createdViews[0].setBounds.mock.calls.at(-1)![0].x).toBe(10)
  })
})

describe('ExtensionViewHost — updatePanelBounds', () => {
  useViewHost()

  it('creates the view on first update and applies the bounds', async () => {
    const ext = makeExt()
    await placePanel(ext, 50)
    expect(createdViews).toHaveLength(1)
    expect(host.hasView(ext.id, 'panel')).toBe(true)
    expect(createdViews[0].setVisible).toHaveBeenCalledWith(true)
    expect(createdViews[0].setBounds).toHaveBeenCalledWith(
      expect.objectContaining({ x: 10, y: 50 })
    )
  })

  it('applies the LATEST bounds received while the view was being created', async () => {
    const ext = makeExt()
    const first = placePanel(ext, 50)
    // A second update lands while createView is still awaiting loadURL
    const second = placePanel(ext, 200)
    await Promise.all([first, second])
    expect(createdViews).toHaveLength(1)
    const lastSetBounds = createdViews[0].setBounds.mock.calls.at(-1)![0]
    expect(lastSetBounds.y).toBe(200)
  })
})

describe('ExtensionViewHost — updatePanelBounds on an existing or unknown view', () => {
  useViewHost()

  it('updates an existing view without creating another', async () => {
    const ext = makeExt()
    await placePanel(ext, 50)
    await placePanel(ext, 120, false)
    expect(createdViews).toHaveLength(1)
    expect(createdViews[0].setVisible).toHaveBeenLastCalledWith(false)
  })

  it('is safe when the extension record is unknown', async () => {
    await host.updatePanelBounds(() => undefined, {
      extensionId: 'ghost.ext',
      viewParam: 'panel',
      bounds: rect(50),
      visible: true,
      repoRoot: null,
    })
    expect(createdViews).toHaveLength(0)
    expect(host.hasView('ghost.ext', 'panel')).toBe(false)
  })
})
