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

function makeEntry(rect: {
  x: number
  y: number
  width: number
  height: number
}): ResizeObserverEntry {
  return {
    contentRect: rect,
    target: document.createElement('div'),
  } as unknown as ResizeObserverEntry
}

describe('ExtensionPanelPortal', () => {
  let panelLoadedHandler: ((id: string) => void) | null = null
  const originalElectronAPI = (window as unknown as Record<string, unknown>).electronAPI
  const originalDpr = window.devicePixelRatio

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
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
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
    Object.defineProperty(window, 'devicePixelRatio', { value: originalDpr, configurable: true })
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

  it('fires updatePanelBounds when ResizeObserver fires', () => {
    render(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />)
    act(() => {
      capturedResizeCallback?.([makeEntry({ x: 10, y: 20, width: 400, height: 300 })])
    })
    expect(mockUpdatePanelBounds).toHaveBeenCalledWith({
      extensionId: 'com.test.ext',
      viewParam: 'main',
      bounds: { x: 10, y: 20, width: 400, height: 300 },
      visible: true,
      dpr: 2,
    })
  })

  it('sends visible: false when isActive is false', () => {
    render(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={false} />)
    act(() => {
      capturedResizeCallback?.([makeEntry({ x: 0, y: 0, width: 400, height: 300 })])
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

  it('does not call updatePanelBounds when ResizeObserver fires with empty entries', () => {
    render(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />)
    act(() => {
      capturedResizeCallback?.([])
    })
    expect(mockUpdatePanelBounds).not.toHaveBeenCalled()
  })

  it('does not call updatePanelBounds when entry contentRect is undefined', () => {
    render(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />)
    act(() => {
      capturedResizeCallback?.([
        {
          contentRect: undefined,
          target: document.createElement('div'),
        } as unknown as ResizeObserverEntry,
      ])
    })
    expect(mockUpdatePanelBounds).not.toHaveBeenCalled()
  })
})
