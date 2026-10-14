import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

const mockUpdatePanelBounds = vi.fn()
const mockOnExtensionPanelLoaded = vi.fn()

type ResizeObserverCallback = (entries: ResizeObserverEntry[]) => void
let capturedResizeCallback: ResizeObserverCallback | null = null
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()

vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(cb: ResizeObserverCallback) {
      capturedResizeCallback = cb
    }
    observe = mockObserve
    disconnect = mockDisconnect
  }
)

import { ExtensionPanelPortal } from '../../../../src/renderer/components/ExtensionPanelPortal.js'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useShownExtensionViews } from '../../../../src/renderer/stores/shown-extension-views.store'
import { useModalStore } from '../../../../src/renderer/stores/modal.store'

const mockExitExtensionToTerminal = vi.fn()

vi.mock('../../../../src/renderer/lib/focus-terminal', () => ({
  focusActiveTerminal: vi.fn(),
}))

let panelLoadedHandler: ((id: string) => void) | null = null

const originalElectronAPI = window.electronAPI

beforeEach(() => {
  vi.clearAllMocks()
  capturedResizeCallback = null
  panelLoadedHandler = null
  mockOnExtensionPanelLoaded.mockImplementation((handler: (id: string) => void) => {
    panelLoadedHandler = handler
    return () => {
      panelLoadedHandler = null
    }
  })
  // Mock getBoundingClientRect to return a controlled rect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
    width: 400,
    height: 300,
    right: 410,
    bottom: 320,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  } as DOMRect)
  Object.defineProperty(window, 'electronAPI', {
    value: {
      extension: { updatePanelBounds: mockUpdatePanelBounds },
      extensionEvents: { onExtensionPanelLoaded: mockOnExtensionPanelLoaded },
    },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  capturedResizeCallback = null
  vi.restoreAllMocks()
  Object.defineProperty(window, 'electronAPI', {
    value: originalElectronAPI,
    configurable: true,
    writable: true,
  })
})

describe('ExtensionPanelPortal', () => {
  it('fires updatePanelBounds using element rect dimensions when ResizeObserver fires', () => {
    render(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />)
    act(() => {
      capturedResizeCallback?.([])
    })
    // width = rect.width = 400, height = rect.height = 300
    expect(mockUpdatePanelBounds).toHaveBeenCalledWith({
      extensionId: 'com.test.ext',
      viewParam: 'main',
      bounds: { x: 10, y: 20, width: 400, height: 300 },
      visible: true,
      repoRoot: null,
    })
  })

  it('sends visible: false when isActive is false', () => {
    render(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={false} />)
    act(() => {
      capturedResizeCallback?.([])
    })
    expect(mockUpdatePanelBounds).toHaveBeenCalledWith(expect.objectContaining({ visible: false }))
  })

  it('shows a loading spinner initially', () => {
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    expect(container.querySelector('[data-testid="extension-loading"]')).toBeTruthy()
  })
})

describe('ExtensionPanelPortal — shows no spinner when the host cannot report that the panel loaded', () => {
  it('shows no spinner when the host cannot report that the panel loaded', () => {
    Object.defineProperty(window, 'electronAPI', {
      value: { extension: { updatePanelBounds: mockUpdatePanelBounds }, extensionEvents: {} },
      configurable: true,
      writable: true,
    })
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    expect(container.querySelector('[data-testid="extension-loading"]')).toBeNull()
  })

  it('dismisses the spinner when onExtensionPanelLoaded fires with matching id', () => {
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    act(() => {
      panelLoadedHandler?.('com.test.ext')
    })
    expect(container.querySelector('[data-testid="extension-loading"]')).toBeNull()
  })
})

describe('ExtensionPanelPortal — does not dismiss spinner when onExtensionPanelLoaded fires with a different id', () => {
  it('does not dismiss spinner when onExtensionPanelLoaded fires with a different id', () => {
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    act(() => {
      panelLoadedHandler?.('com.other.ext')
    })
    expect(container.querySelector('[data-testid="extension-loading"]')).toBeTruthy()
  })

  it('disconnects ResizeObserver on unmount', () => {
    const { unmount } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    unmount()
    expect(mockDisconnect).toHaveBeenCalled()
  })

  it('sends visible: false on unmount to release pointer event capture', () => {
    const { unmount } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    mockUpdatePanelBounds.mockClear()
    unmount()
    expect(mockUpdatePanelBounds).toHaveBeenCalledWith(
      expect.objectContaining({ visible: false, extensionId: 'com.test.ext', viewParam: 'main' })
    )
  })
})

/** The hooks every "ExtensionPanelPortal — remote/browser mode (onExtensionPanelLoaded absent)" describe registers. */
function setUpExtensionPanelPortalRemoteBrowserMode(): void {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: {
        extension: { updatePanelBounds: () => {} },
        extensionEvents: {}, // onExtensionPanelLoaded missing → remote mode
      },
      configurable: true,
      writable: true,
    })
  })
}

describe('ExtensionPanelPortal — remote/browser mode (onExtensionPanelLoaded absent)', () => {
  setUpExtensionPanelPortalRemoteBrowserMode()

  it('renders an iframe instead of a WebContentsView portal', () => {
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(container.querySelector('[data-testid="extension-loading"]')).toBeNull()
  })

  it('iframe src points to /ext/<extensionId>/ with viewParam', () => {
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="pr-review" isActive={true} />
    )
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.src).toContain('/ext/com.test.ext/')
    expect(iframe.src).toContain('viewParam=pr-review')
  })

  it('marks the extension shown while its frame is active, as the frame draws its own toasts', () => {
    const { unmount } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    expect([...useShownExtensionViews.getState().shown.values()]).toEqual(['com.test.ext'])
    unmount()
    expect([...useShownExtensionViews.getState().shown.values()]).toEqual([])
  })
})

describe('ExtensionPanelPortal — remote/browser mode (onExtensionPanelLoaded absent) — iframe includes repoRoot in query params when provided', () => {
  setUpExtensionPanelPortalRemoteBrowserMode()

  it('iframe includes repoRoot in query params when provided', () => {
    const { container } = render(
      <ExtensionPanelPortal
        extensionId="com.test.ext"
        viewParam="main"
        isActive={true}
        repoRoot="/home/user/repo"
      />
    )
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.src).toContain('repoRoot=%2Fhome%2Fuser%2Frepo')
  })

  it('wrapper div is hidden when isActive is false', () => {
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={false} />
    )
    const wrapper = container.querySelector('[data-extension-panel]') as HTMLElement
    expect(wrapper.style.display).toBe('none')
  })

  it('does not call updatePanelBounds (no WebContentsView to position)', () => {
    render(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />)
    expect(mockUpdatePanelBounds).not.toHaveBeenCalled()
  })
})

function pressEscapeInIframe(iframe: HTMLIFrameElement, times: number): void {
  act(() => {
    for (let i = 0; i < times; i++) {
      iframe.contentWindow?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    }
  })
}

/** The hooks every "ExtensionPanelPortal — remote/browser mode (onExtensionPanelLoaded absent) — double-Escape exit" describe registers. */
function setUpExtensionPanelPortalRemoteBrowserMode_(): void {
  setUpExtensionPanelPortalRemoteBrowserMode()

  beforeEach(() => {
    mockExitExtensionToTerminal.mockReset().mockReturnValue(true)
    useExtensionRegistry.setState({
      sidebarPanels: new Map(),
      exitExtensionToTerminal: mockExitExtensionToTerminal,
    })
  })
}

describe('ExtensionPanelPortal — remote/browser mode (onExtensionPanelLoaded absent) — double-Escape exit', () => {
  setUpExtensionPanelPortalRemoteBrowserMode_()

  it('ignores a single Escape', () => {
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    pressEscapeInIframe(container.querySelector('iframe') as HTMLIFrameElement, 1)
    expect(mockExitExtensionToTerminal).not.toHaveBeenCalled()
  })

  it('exits the full-screen surface on a second Escape', () => {
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    pressEscapeInIframe(container.querySelector('iframe') as HTMLIFrameElement, 2)
    expect(mockExitExtensionToTerminal).toHaveBeenCalledWith(undefined)
  })
})

describe('ExtensionPanelPortal — remote/browser mode (onExtensionPanelLoaded absent) — double-Escape exit — closes the panel when the iframe is the extension’s sidebar surface', () => {
  setUpExtensionPanelPortalRemoteBrowserMode_()

  it('closes the panel when the iframe is the extension’s sidebar surface', () => {
    useExtensionRegistry.setState({
      sidebarPanels: new Map([
        [
          'com.test.ext',
          { id: 'com.test.ext', label: 'Git', view: 'sidebar', component: null as never },
        ],
      ]),
    })
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="sidebar" isActive={true} />
    )
    pressEscapeInIframe(container.querySelector('iframe') as HTMLIFrameElement, 2)
    expect(mockExitExtensionToTerminal).toHaveBeenCalledWith('com.test.ext')
  })
})

describe('ExtensionPanelPortal — remote/browser mode (onExtensionPanelLoaded absent) — double-Escape exit — stops listening after unmount', () => {
  setUpExtensionPanelPortalRemoteBrowserMode_()

  it('stops listening after unmount', () => {
    const { container, unmount } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    const iframe = container.querySelector('iframe') as HTMLIFrameElement
    const win = iframe.contentWindow
    unmount()
    act(() => {
      win?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      win?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(mockExitExtensionToTerminal).not.toHaveBeenCalled()
  })
})

describe('ExtensionPanelPortal — tells the core which extension covers the toast region', () => {
  const shownIds = () => [...useShownExtensionViews.getState().shown.values()]

  it('marks the extension shown while its panel is active, and not after', () => {
    const { rerender, unmount } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    expect(shownIds()).toEqual(['com.test.ext'])
    rerender(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={false} />)
    expect(shownIds()).toEqual([])
    rerender(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />)
    unmount()
    expect(shownIds()).toEqual([])
  })

  it('does not mark it while a modal hides the view', () => {
    act(() => useModalStore.getState().push())
    render(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />)
    expect(shownIds()).toEqual([])
    act(() => useModalStore.getState().pop())
    expect(shownIds()).toEqual(['com.test.ext'])
  })
})
