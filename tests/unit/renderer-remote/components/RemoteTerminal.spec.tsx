import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'

const mocks = vi.hoisted(() => {
  const mockTerminalWrite = vi.fn()
  const mockTerminalDispose = vi.fn()
  const mockTerminalOpen = vi.fn()
  const mockTerminalLoadAddon = vi.fn()
  const mockFitAddonFit = vi.fn()
  const mockGetWsTicket = vi.fn()
  const mockResizeTerminal = vi.fn()

  return {
    mockTerminalWrite,
    mockTerminalDispose,
    mockTerminalOpen,
    mockTerminalLoadAddon,
    mockFitAddonFit,
    mockGetWsTicket,
    mockResizeTerminal,
  }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: class FakeTerminal {
    cols = 80
    rows = 24
    write = mocks.mockTerminalWrite
    dispose = mocks.mockTerminalDispose
    open = mocks.mockTerminalOpen
    loadAddon = mocks.mockTerminalLoadAddon
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FakeFitAddon {
    fit = mocks.mockFitAddonFit
  },
}))

vi.mock('@xterm/addon-attach', () => ({
  AttachAddon: class FakeAttachAddon {
    constructor(public ws: unknown) {}
  },
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('../../../../src/renderer-remote/api/remote-client', () => ({
  getWsTicket: mocks.mockGetWsTicket,
  resizeTerminal: mocks.mockResizeTerminal,
}))

const mockWsClose = vi.fn()
const mockWsAddEventListener = vi.fn()

class FakeWebSocket {
  addEventListener = mockWsAddEventListener
  close = mockWsClose
}
global.WebSocket = FakeWebSocket as unknown as typeof WebSocket

class FakeResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
}
global.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver

beforeEach(() => {
  mocks.mockGetWsTicket.mockReset()
  mocks.mockResizeTerminal.mockReset()
  mocks.mockTerminalWrite.mockReset()
  mockWsClose.mockReset()
  mockWsAddEventListener.mockReset()
})

import { RemoteTerminal } from '../../../../src/renderer-remote/components/RemoteTerminal'

describe('RemoteTerminal', () => {
  it('renders a div container', () => {
    mocks.mockGetWsTicket.mockResolvedValueOnce('ticket-123')
    const { container } = render(<RemoteTerminal sessionId="s1" />)
    expect(container.querySelector('div')).toBeTruthy()
  })

  it('calls getWsTicket with the sessionId', async () => {
    mocks.mockGetWsTicket.mockResolvedValueOnce('ticket-abc')
    render(<RemoteTerminal sessionId="s1" />)
    await vi.waitFor(() => expect(mocks.mockGetWsTicket).toHaveBeenCalledWith('s1'))
  })

  it('writes error to terminal when getWsTicket fails', async () => {
    mocks.mockGetWsTicket.mockRejectedValueOnce(new Error('unauthorized'))
    render(<RemoteTerminal sessionId="s1" />)
    await vi.waitFor(() =>
      expect(mocks.mockTerminalWrite).toHaveBeenCalledWith(
        expect.stringContaining('Failed to connect')
      )
    )
  })

  it('opens xterm on the container element', () => {
    mocks.mockGetWsTicket.mockResolvedValueOnce('ticket-abc')
    render(<RemoteTerminal sessionId="s1" />)
    expect(mocks.mockTerminalOpen).toHaveBeenCalled()
  })

  it('calls fitAddon.fit() after opening', () => {
    mocks.mockGetWsTicket.mockResolvedValueOnce('ticket-abc')
    render(<RemoteTerminal sessionId="s1" />)
    expect(mocks.mockFitAddonFit).toHaveBeenCalled()
  })

  it('disposes terminal on unmount', () => {
    mocks.mockGetWsTicket.mockResolvedValueOnce('ticket-abc')
    const { unmount } = render(<RemoteTerminal sessionId="s1" />)
    unmount()
    expect(mocks.mockTerminalDispose).toHaveBeenCalled()
  })
})
