import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

const mockGetWsTicket = vi.fn()
const mockResizeTerminal = vi.fn()

vi.mock('../../../../src/renderer-remote/api/remote-client', () => ({
  getWsTicket: mockGetWsTicket,
  resizeTerminal: mockResizeTerminal,
}))

// Shared mutable terminal mock — lets tests inspect write/scrollToLine calls and mutate buffer
const mockTermBuffer = { baseY: 0, length: 100 }
let capturedOnDataHandler: ((data: string) => void) | null = null
const mockTerm = {
  open: vi.fn(),
  dispose: vi.fn(),
  loadAddon: vi.fn(),
  onResize: vi.fn(),
  onData: vi.fn((handler: (data: string) => void) => {
    capturedOnDataHandler = handler
  }),
  focus: vi.fn(),
  element: null,
  write: vi.fn((_data: unknown, cb?: () => void) => {
    cb?.()
  }),
  scrollToLine: vi.fn(),
  rows: 24,
  buffer: { active: mockTermBuffer },
}

// Mock xterm — it does not work in jsdom
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function () {
    return mockTerm
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return {
      fit: vi.fn(),
      activate: vi.fn(),
    }
  }),
}))

vi.mock('@xterm/addon-attach', () => ({
  AttachAddon: vi.fn().mockImplementation(function () {
    return {
      activate: vi.fn(),
    }
  }),
}))

vi.mock('../../../../src/renderer-remote/hooks/useReconnect', () => ({
  useReconnect: vi
    .fn()
    .mockReturnValue({ status: 'connected', retry: vi.fn(), onOpenWsFailed: vi.fn() }),
}))

vi.mock('../../../../src/renderer-remote/components/MobileControlToolbar', () => ({
  MobileControlToolbar: ({ onKey }: { onKey: (seq: string) => void }) => (
    <div>
      <button onClick={() => onKey('\x03')}>ctrl-c</button>
    </div>
  ),
}))

// Capture message handlers attached to the WebSocket mock
let capturedMessageHandler: ((event: MessageEvent) => void) | null = null

// Mock WebSocket with static OPEN constant
const mockWs = {
  close: vi.fn(),
  readyState: 1, // OPEN
  send: vi.fn(),
  addEventListener: vi.fn((event: string, handler: (e: MessageEvent) => void) => {
    if (event === 'message') capturedMessageHandler = handler
  }),
}
const WsMockCtor = vi.fn(function () {
  return mockWs
}) as unknown as typeof WebSocket
;(WsMockCtor as unknown as { OPEN: number }).OPEN = 1
vi.stubGlobal('WebSocket', WsMockCtor)

beforeEach(() => {
  capturedMessageHandler = null
  capturedOnDataHandler = null
  mockTermBuffer.baseY = 76 // default: at bottom (76 + 24 >= 100)
  mockTermBuffer.length = 100
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
    vi.mocked(useReconnect).mockReturnValue({
      status: 'reconnecting',
      retry: vi.fn(),
      onOpenWsFailed: vi.fn(),
    })
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    expect(screen.getByText(/reconnecting/i)).toBeTruthy()
  })

  it('shows error state with retry button when status is disconnected', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    vi.mocked(useReconnect).mockReturnValue({
      status: 'disconnected',
      retry: vi.fn(),
      onOpenWsFailed: vi.fn(),
    })
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('renders MobileControlToolbar', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    vi.mocked(useReconnect).mockReturnValue({
      status: 'connected',
      retry: vi.fn(),
      onOpenWsFailed: vi.fn(),
    })
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    expect(screen.getByText('ctrl-c')).toBeTruthy()
  })

  it('sends key sequence to WebSocket when toolbar key is pressed', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    vi.mocked(useReconnect).mockReturnValue({
      status: 'connected',
      retry: vi.fn(),
      onOpenWsFailed: vi.fn(),
    })
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

  it('writes incoming message data to terminal when at bottom (no scrollToLine)', async () => {
    mockTermBuffer.baseY = 76 // 76 + 24 >= 100 → at bottom
    mockGetWsTicket.mockResolvedValue('ticket-abc')
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    await act(async () => {})
    expect(capturedMessageHandler).not.toBeNull()
    capturedMessageHandler!(new MessageEvent('message', { data: 'hello' }))
    expect(mockTerm.write).toHaveBeenCalledWith('hello', expect.any(Function))
    expect(mockTerm.scrollToLine).not.toHaveBeenCalled()
  })

  it('preserves scroll position when not at bottom (calls scrollToLine)', async () => {
    mockTermBuffer.baseY = 0 // 0 + 24 < 100 → not at bottom
    mockTermBuffer.length = 100
    mockGetWsTicket.mockResolvedValue('ticket-abc')
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s3" cwd="/tmp" onBack={vi.fn()} />)
    await act(async () => {})
    expect(capturedMessageHandler).not.toBeNull()
    capturedMessageHandler!(new MessageEvent('message', { data: 'output' }))
    expect(mockTerm.write).toHaveBeenCalled()
    expect(mockTerm.scrollToLine).toHaveBeenCalledWith(0)
  })

  it('forwards xterm onData keystrokes to WebSocket', async () => {
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    await act(async () => {})
    expect(capturedOnDataHandler).not.toBeNull()
    capturedOnDataHandler!('ls\r')
    expect(mockWs.send).toHaveBeenCalledWith('ls\r')
  })

  it('does not send keystroke when WebSocket readyState is not OPEN', async () => {
    const { MobileTerminalView } = await import(
      '../../../../src/renderer-remote/components/MobileTerminalView'
    )
    render(<MobileTerminalView sessionId="s1" cwd="/tmp" onBack={vi.fn()} />)
    await act(async () => {})
    expect(capturedOnDataHandler).not.toBeNull()
    // Simulate socket not yet open
    mockWs.readyState = 0 // CONNECTING
    capturedOnDataHandler!('should not send')
    expect(mockWs.send).not.toHaveBeenCalled()
    // Restore OPEN and confirm send works again
    mockWs.readyState = 1
    capturedOnDataHandler!('should send')
    expect(mockWs.send).toHaveBeenCalledWith('should send')
  })
})
