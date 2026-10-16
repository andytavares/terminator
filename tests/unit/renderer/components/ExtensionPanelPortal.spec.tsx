import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'

import { FRAME_PORT_MESSAGE } from '../../../../src/shared/frame-wire'
import { ExtensionPanelPortal } from '../../../../src/renderer/components/ExtensionPanelPortal.js'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useShownExtensionViews } from '../../../../src/renderer/stores/shown-extension-views.store'

const mockOpenFramePort = vi.fn()
let reloadHandler: ((extensionId: string) => void) | null = null
const mockUpdatePanelBounds = vi.fn()
const mockExitExtensionToTerminal = vi.fn()

vi.mock('../../../../src/renderer/lib/focus-terminal', () => ({
  focusActiveTerminal: vi.fn(),
}))

const originalElectronAPI = window.electronAPI

function stubDesktopApi(): void {
  Object.defineProperty(window, 'electronAPI', {
    value: {
      extension: {
        openFramePort: mockOpenFramePort,
        updatePanelBounds: mockUpdatePanelBounds,
      },
      extensionEvents: {
        onExtensionRendererReload: (handler: (extensionId: string) => void) => {
          reloadHandler = handler
          return () => {
            reloadHandler = null
          }
        },
      },
    },
    configurable: true,
    writable: true,
  })
}

function stubRemoteApi(): void {
  Object.defineProperty(window, 'electronAPI', {
    value: { extension: { updatePanelBounds: mockUpdatePanelBounds } },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    value: originalElectronAPI,
    configurable: true,
    writable: true,
  })
})

function firstIframe(container: HTMLElement): HTMLIFrameElement {
  return container.querySelector('iframe') as HTMLIFrameElement
}

function loadFrame(container: HTMLElement): void {
  act(() => {
    fireEvent.load(firstIframe(container))
  })
}

function framePortMessage(frameToken: string, source: MessageEventSource | null = window): void {
  act(() => {
    const event = new MessageEvent('message', {
      data: { type: FRAME_PORT_MESSAGE, frameToken },
      ports: [{} as MessagePort],
    })
    Object.defineProperty(event, 'source', { value: source })
    window.dispatchEvent(event)
  })
}

// createElement rather than JSX: lizard (the clean-gate's parser) misreads JSX with an
// expression attr here and merges every following describe into this function.
function renderPortal(extraProps: Record<string, unknown> = {}): ReturnType<typeof render> {
  return render(
    React.createElement(ExtensionPanelPortal, {
      extensionId: 'com.test.ext',
      viewParam: 'main',
      isActive: true,
      ...extraProps,
    })
  )
}

function panelWrapper(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-extension-panel]') as HTMLElement
}

describe('ExtensionPanelPortal — desktop src and spinner', () => {
  beforeEach(stubDesktopApi)

  it('renders an iframe with the ext:// src including view and repoRoot', () => {
    const { container } = renderPortal({
      repoRoot: '/home/user/repo',
      rendererUrl: 'ext://com.test.ext/renderer/index.html',
    })
    expect(firstIframe(container).src).toBe(
      'ext://com.test.ext/renderer/index.html?view=main&repoRoot=%2Fhome%2Fuser%2Frepo'
    )
  })

  it('falls back to ext://<id>/index.html when no rendererUrl is given', () => {
    const { container } = renderPortal({ viewParam: 'sidebar' })
    expect(firstIframe(container).src).toBe('ext://com.test.ext/index.html?view=sidebar')
  })

  it('shows a spinner until the frame loads', () => {
    const { container } = renderPortal()
    expect(container.querySelector('[data-testid="extension-loading"]')).toBeTruthy()
    loadFrame(container)
    expect(container.querySelector('[data-testid="extension-loading"]')).toBeNull()
  })
})

describe('ExtensionPanelPortal — desktop visibility and bounds', () => {
  beforeEach(stubDesktopApi)

  it('hides the panel with display:none when inactive but keeps the frame mounted', () => {
    const { container } = renderPortal({ isActive: false })
    expect(panelWrapper(container).style.display).toBe('none')
    expect(firstIframe(container)).toBeTruthy()
  })

  it('never calls updatePanelBounds', () => {
    const { container, unmount } = renderPortal()
    loadFrame(container)
    unmount()
    expect(mockUpdatePanelBounds).not.toHaveBeenCalled()
  })
})

/** Renders a loaded desktop frame with its contentWindow's postMessage spied on. */
const renderLoadedDesktopFrame = (): { postMessage: ReturnType<typeof vi.fn> } => {
  const { container } = renderPortal()
  loadFrame(container)
  const postMessage = vi.fn()
  Object.defineProperty(firstIframe(container), 'contentWindow', {
    value: { postMessage },
    configurable: true,
  })
  return { postMessage }
}

const lastOpenFrameRequest = (): { extensionId: string; viewParam: string; frameToken: string } =>
  mockOpenFramePort.mock.calls[0][0]

describe('ExtensionPanelPortal — desktop port request', () => {
  beforeEach(stubDesktopApi)

  it('asks main for a port with a fresh token on load', () => {
    const { container } = renderPortal()
    loadFrame(container)
    expect(mockOpenFramePort).toHaveBeenCalledTimes(1)
    const request = lastOpenFrameRequest()
    expect(request.extensionId).toBe('com.test.ext')
    expect(request.viewParam).toBe('main')
    expect(request.frameToken).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('uses a fresh token when the frame reloads', () => {
    const { container } = renderPortal()
    loadFrame(container)
    loadFrame(container)
    const [first, second] = mockOpenFramePort.mock.calls.map(([r]) => r.frameToken)
    expect(first).not.toBe(second)
  })
})

describe('ExtensionPanelPortal — desktop port forwarding', () => {
  beforeEach(stubDesktopApi)

  it('forwards a matching port message into the frame at the extension origin', () => {
    const { postMessage } = renderLoadedDesktopFrame()
    framePortMessage(lastOpenFrameRequest().frameToken)
    expect(postMessage).toHaveBeenCalledWith({ type: FRAME_PORT_MESSAGE }, 'ext://com.test.ext', [
      expect.anything(),
    ])
  })

  it('ignores a message with a stale token or from another source', () => {
    const { postMessage } = renderLoadedDesktopFrame()
    framePortMessage('stale-token')
    framePortMessage(lastOpenFrameRequest().frameToken, null)
    expect(postMessage).not.toHaveBeenCalled()
  })
})

describe('ExtensionPanelPortal — an extension reload', () => {
  beforeEach(stubDesktopApi)

  function loadedFrame(extensionId = 'com.test.ext') {
    const { container } = renderPortal({ extensionId })
    loadFrame(container)
    const iframe = firstIframe(container)
    const assigned = vi.spyOn(iframe, 'setAttribute')
    return assigned
  }

  it('reloads the frame of the extension that reloaded, so it gets a port to its new backend', () => {
    const assigned = loadedFrame()
    act(() => reloadHandler?.('com.test.ext'))
    expect(assigned).toHaveBeenCalledWith('src', 'ext://com.test.ext/index.html?view=main')
  })

  it("leaves another extension's frame alone", () => {
    const assigned = loadedFrame()
    act(() => reloadHandler?.('com.other.ext'))
    expect(assigned).not.toHaveBeenCalled()
  })

  it('stops listening when the frame unmounts', () => {
    const { unmount } = renderPortal()
    unmount()
    expect(reloadHandler).toBeNull()
  })
})

describe('ExtensionPanelPortal — remote/browser (openFramePort absent)', () => {
  beforeEach(stubRemoteApi)

  it('renders an iframe pointing at /ext/<id>/ with viewParam and repoRoot', () => {
    const { container } = render(
      <ExtensionPanelPortal
        extensionId="com.test.ext"
        viewParam="pr-review"
        isActive={true}
        repoRoot="/home/user/repo"
      />
    )
    const iframe = firstIframe(container)
    expect(iframe.src).toContain('/ext/com.test.ext/')
    expect(iframe.src).toContain('viewParam=pr-review')
    expect(iframe.src).toContain('repoRoot=%2Fhome%2Fuser%2Frepo')
  })

  it('does not ask main for a port', () => {
    render(<ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />)
    expect(mockOpenFramePort).not.toHaveBeenCalled()
  })

  it('hides the wrapper when inactive but keeps the frame mounted', () => {
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={false} />
    )
    const wrapper = container.querySelector('[data-extension-panel]') as HTMLElement
    expect(wrapper.style.display).toBe('none')
    expect(firstIframe(container)).toBeTruthy()
  })
})

function pressEscapeInIframe(iframe: HTMLIFrameElement, times: number): void {
  act(() => {
    for (let i = 0; i < times; i++) {
      iframe.contentWindow?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    }
  })
}

/** The beforeEach every double-Escape describe registers. */
function stubRemoteEscape(): void {
  stubRemoteApi()
  mockExitExtensionToTerminal.mockReturnValue(true)
  useExtensionRegistry.setState({
    sidebarPanels: new Map(),
    exitExtensionToTerminal: mockExitExtensionToTerminal,
  })
}

describe('ExtensionPanelPortal — remote/browser — double-Escape exit', () => {
  beforeEach(stubRemoteEscape)

  it('ignores a single Escape and exits on the second', () => {
    const { container } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    pressEscapeInIframe(firstIframe(container), 1)
    expect(mockExitExtensionToTerminal).not.toHaveBeenCalled()
    pressEscapeInIframe(firstIframe(container), 1)
    expect(mockExitExtensionToTerminal).toHaveBeenCalledWith(undefined)
  })

  it('stops listening after unmount', () => {
    const { container, unmount } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    const win = firstIframe(container).contentWindow
    unmount()
    act(() => {
      win?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      win?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(mockExitExtensionToTerminal).not.toHaveBeenCalled()
  })
})

describe('ExtensionPanelPortal — remote/browser — double-Escape in the sidebar surface', () => {
  beforeEach(stubRemoteEscape)

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
    pressEscapeInIframe(firstIframe(container), 2)
    expect(mockExitExtensionToTerminal).toHaveBeenCalledWith('com.test.ext')
  })
})

describe('ExtensionPanelPortal — shown views', () => {
  const shownIds = () => [...useShownExtensionViews.getState().shown.values()]

  it('marks the extension shown while active, and not after', () => {
    stubDesktopApi()
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

  it('marks remote frames shown too', () => {
    stubRemoteApi()
    const { unmount } = render(
      <ExtensionPanelPortal extensionId="com.test.ext" viewParam="main" isActive={true} />
    )
    expect(shownIds()).toEqual(['com.test.ext'])
    unmount()
    expect(shownIds()).toEqual([])
  })
})
