import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

const mockGetWsTicket = vi.fn()
const mockResizeTerminal = vi.fn()

vi.mock('../../../../src/renderer-remote/api/remote-client', () => ({
  getWsTicket: mockGetWsTicket,
  resizeTerminal: mockResizeTerminal,
}))

// Mock xterm — it does not work in jsdom
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    onResize: vi.fn(),
    focus: vi.fn(),
    element: null,
  })),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    activate: vi.fn(),
  })),
}))

vi.mock('@xterm/addon-attach', () => ({
  AttachAddon: vi.fn().mockImplementation(() => ({
    activate: vi.fn(),
  })),
}))

vi.mock('../../../../src/renderer-remote/hooks/useReconnect', () => ({
  useReconnect: vi.fn().mockReturnValue({ status: 'connected', retry: vi.fn() }),
}))

vi.mock('../../../../src/renderer-remote/components/MobileControlToolbar', () => ({
  MobileControlToolbar: ({ onKey }: { onKey: (seq: string) => void }) => (
    <div>
      <button onClick={() => onKey('\x03')}>ctrl-c</button>
    </div>
  ),
}))

// Mock WebSocket with static OPEN constant
const mockWs = {
  close: vi.fn(),
  readyState: 1, // OPEN
  send: vi.fn(),
}
const WsMockCtor = vi.fn(() => mockWs) as unknown as typeof WebSocket
;(WsMockCtor as unknown as { OPEN: number }).OPEN = 1
vi.stubGlobal('WebSocket', WsMockCtor)

beforeEach(() => {
  mockGetWsTicket.mockResolvedValue('ticket-abc')
  mockWs.close.mockReset()
  vi.clearAllMocks()
})

describe('MobileTerminalView', () => {
  it('renders a container div for xterm', async () => {
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    const { container } = render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    // Should have a div that xterm mounts into
    expect(container.querySelector('.mobile-terminal-container')).toBeTruthy()
  })

  it('renders a back button', async () => {
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: /back/i })).toBeTruthy()
  })

  it('calls onBack when back button is clicked', async () => {
    const onBack = vi.fn()
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('shows reconnecting banner when status is reconnecting', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    vi.mocked(useReconnect).mockReturnValue({ status: 'reconnecting', retry: vi.fn() })
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    expect(screen.getByText(/reconnecting/i)).toBeTruthy()
  })

  it('shows error state with retry button when status is disconnected', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    vi.mocked(useReconnect).mockReturnValue({ status: 'disconnected', retry: vi.fn() })
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('renders MobileControlToolbar', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    vi.mocked(useReconnect).mockReturnValue({ status: 'connected', retry: vi.fn() })
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    expect(screen.getByText('ctrl-c')).toBeTruthy()
  })

  it('sends key sequence to WebSocket when toolbar key is pressed', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    vi.mocked(useReconnect).mockReturnValue({ status: 'connected', retry: vi.fn() })
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    // Flush microtasks so openWs async chain completes and wsRef.current is set
    await act(async () => {})
    fireEvent.click(screen.getByText('ctrl-c'))
    expect(mockWs.send).toHaveBeenCalledWith('\x03')
  })

  it('does not crash when getWsTicket rejects', async () => {
    mockGetWsTicket.mockRejectedValue(new Error('network error'))
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    expect(() =>
      render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    ).not.toThrow()
  })

  it('closes previous WebSocket when openWs is called a second time', async () => {
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    const { rerender } = render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    // Let first openWs complete so wsRef.current is set
    await act(async () => {})
    // Re-render with a different sessionId — triggers a new openWs call while prev socket exists
    rerender(<MobileTerminalView sessionId="s2" cwd="/tmp" onBack={vi.fn()} />)
    await act(async () => {})
    expect(mockWs.close).toHaveBeenCalled()
  })
})
