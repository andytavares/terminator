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

describe('ExtensionPanelPortal', () => {
  let panelLoadedHandler: ((id: string) => void) | null = null
  const originalElectronAPI = (window as unknown as Record<string, unknown>).electronAPI

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

  it('attaches a ResizeObserver to the container div on mount', () => {
    render(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />)
    expect(mockObserve).toHaveBeenCalledWith(expect.any(HTMLElement))
  })

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

  it('registers onExtensionPanelLoaded listener on mount', () => {
    render(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />)
    expect(mockOnExtensionPanelLoaded).toHaveBeenCalled()
  })

  it('shows a loading spinner initially', () => {
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    expect(container.querySelector('[data-testid="extension-loading"]')).toBeTruthy()
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

  describe('remote/browser mode (onExtensionPanelLoaded absent)', () => {
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

    it('does not throw on unmount', () => {
      const { unmount } = render(
        <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
      )
      expect(() => unmount()).not.toThrow()
    })

    it('does not call updatePanelBounds (no WebContentsView to position)', () => {
      render(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />)
      expect(mockUpdatePanelBounds).not.toHaveBeenCalled()
    })
  })
})
