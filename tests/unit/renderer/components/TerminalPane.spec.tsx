import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { TerminalPane } from '../../../../src/renderer/components/terminal/TerminalPane'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/components/terminal/SplitContainer', () => ({
  SplitContainer: ({
    splitId,
    direction,
    onRatioChange,
    children,
  }: {
    splitId: string
    direction: string
    ratio: number
    onRatioChange: (id: string, r: number) => void
    children: React.ReactNode[]
  }) => {
    const containerRef = React.useRef<HTMLDivElement>(null)
    return (
      <div ref={containerRef} className={`split-container split-container--${direction}`}>
        <div className="split-container__child">{(children as React.ReactNode[])[0]}</div>
        <div
          className={`split-container__divider split-container__divider--${direction}`}
          onMouseDown={(e) => {
            e.preventDefault()
            const onMove = (ev: MouseEvent) => {
              const rect = containerRef.current?.getBoundingClientRect() ?? {
                left: 0,
                top: 0,
                width: 400,
                height: 300,
              }
              const pos = direction === 'vertical' ? ev.clientX : ev.clientY
              const start = direction === 'vertical' ? rect.left : rect.top
              const size = direction === 'vertical' ? rect.width : rect.height
              onRatioChange(splitId, Math.max(0.1, Math.min(0.9, (pos - start) / size)))
            }
            const onUp = () => {
              document.removeEventListener('mousemove', onMove)
              document.removeEventListener('mouseup', onUp)
            }
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
          }}
        />
        <div className="split-container__child">{(children as React.ReactNode[])[1]}</div>
      </div>
    )
  },
}))
vi.mock('../../../../src/renderer/components/terminal/LeafPane', () => ({
  LeafPane: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`leaf-${sessionId}`}>{sessionId}</div>
  ),
}))

const mockGetSessions = vi.fn()
const mockGetActive = vi.fn()
const mockGetInstance = vi.fn()
const mockClearBell = vi.fn()
const mockTerminalInput = vi.fn()
const mockGetPaneLayout = vi.fn(() => null)
const mockSetSplitRatio = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSessionStore).mockReturnValue({
    getSessionsForProject: mockGetSessions,
    getActiveSessionForProject: mockGetActive,
    getTerminalInstance: mockGetInstance,
    clearBellCount: mockClearBell,
    getPaneLayout: mockGetPaneLayout,
    setSplitRatio: mockSetSplitRatio,
    setFocusedSession: vi.fn(),
  } as unknown as ReturnType<typeof useSessionStore>)
  mockGetSessions.mockReturnValue([])
  mockGetActive.mockReturnValue(null)
  mockGetInstance.mockReturnValue(undefined)
  mockGetPaneLayout.mockReturnValue(null)
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    terminal: { input: mockTerminalInput },
  }
})

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('TerminalPane', () => {
  it('shows empty state when no sessions', () => {
    render(<TerminalPane projectId="proj-1" />)
    expect(screen.getByText('Open a terminal tab to get started')).toBeTruthy()
  })

  it('renders container when sessions exist', () => {
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'Terminal', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    const { container } = render(<TerminalPane projectId="proj-1" />)
    expect(container.querySelector('.terminal-pane')).toBeTruthy()
    expect(container.querySelector('.terminal-pane__container')).toBeTruthy()
  })

  it('clears bell count when active session changes', () => {
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    render(<TerminalPane projectId="proj-1" />)
    expect(mockClearBell).toHaveBeenCalledWith('ses-1')
  })

  it('does not crash when terminal instance is undefined', () => {
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockReturnValue(undefined)
    expect(() => render(<TerminalPane projectId="proj-1" />)).not.toThrow()
  })

  it('calls terminal focus when pane is clicked with an active session', () => {
    const mockFocus = vi.fn()
    const mockScrollToBottom = vi.fn()
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockReturnValue({
      terminal: { focus: mockFocus, scrollToBottom: mockScrollToBottom },
      mount: vi.fn(),
      unmount: vi.fn(),
    })
    const { container } = render(<TerminalPane projectId="proj-1" />)
    fireEvent.mouseDown(container.querySelector('.terminal-pane')!, { button: 0 })
    expect(mockFocus).toHaveBeenCalled()
  })

  it('pastes dropped file paths into the active terminal session', () => {
    const mockPaste = vi.fn()
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockReturnValue({
      terminal: { paste: mockPaste, focus: vi.fn(), scrollToBottom: vi.fn() },
      mount: vi.fn(),
      unmount: vi.fn(),
    })
    const { container } = render(<TerminalPane projectId="proj-1" />)
    const pane = container.querySelector('.terminal-pane')!
    const file = Object.assign(new File([], 'report.pdf'), { path: '/Users/me/report.pdf' })
    fireEvent.drop(pane, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(mockPaste).toHaveBeenCalledWith('/Users/me/report.pdf')
  })

  it('quotes paths with spaces when dropping files', () => {
    const mockPaste = vi.fn()
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockReturnValue({
      terminal: { paste: mockPaste, focus: vi.fn(), scrollToBottom: vi.fn() },
      mount: vi.fn(),
      unmount: vi.fn(),
    })
    const { container } = render(<TerminalPane projectId="proj-1" />)
    const pane = container.querySelector('.terminal-pane')!
    const file = Object.assign(new File([], 'my file.png'), { path: '/Users/me/my file.png' })
    fireEvent.drop(pane, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(mockPaste).toHaveBeenCalledWith("'/Users/me/my file.png'")
  })

  it('joins multiple dropped files with spaces', () => {
    const mockPaste = vi.fn()
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockReturnValue({
      terminal: { paste: mockPaste, focus: vi.fn(), scrollToBottom: vi.fn() },
      mount: vi.fn(),
      unmount: vi.fn(),
    })
    const { container } = render(<TerminalPane projectId="proj-1" />)
    const pane = container.querySelector('.terminal-pane')!
    const f1 = Object.assign(new File([], 'a.txt'), { path: '/a.txt' })
    const f2 = Object.assign(new File([], 'b.txt'), { path: '/b.txt' })
    fireEvent.drop(pane, { dataTransfer: { files: [f1, f2], types: ['Files'] } })
    expect(mockPaste).toHaveBeenCalledWith('/a.txt /b.txt')
  })

  it('does not call paste when no active session on drop', () => {
    const mockPaste = vi.fn()
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue(null)
    mockGetInstance.mockReturnValue({
      terminal: { paste: mockPaste, focus: vi.fn(), scrollToBottom: vi.fn() },
      mount: vi.fn(),
      unmount: vi.fn(),
    })
    const { container } = render(<TerminalPane projectId="proj-1" />)
    const pane = container.querySelector('.terminal-pane')!
    const file = Object.assign(new File([], 'x.txt'), { path: '/x.txt' })
    fireEvent.drop(pane, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(mockPaste).not.toHaveBeenCalled()
  })

  it('handleDragOver prevents default when Files type is included', () => {
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    const { container } = render(<TerminalPane projectId="proj-1" />)
    const pane = container.querySelector('.terminal-pane')!

    // Build a real DragEvent and spy on preventDefault
    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'] },
    })
    const spy = vi.spyOn(event, 'preventDefault')
    pane.dispatchEvent(event)
    expect(spy).toHaveBeenCalled()
  })

  it('handleDragOver does not prevent default when Files type is not included', () => {
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    const { container } = render(<TerminalPane projectId="proj-1" />)
    const pane = container.querySelector('.terminal-pane')!

    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['text/plain'] },
    })
    const spy = vi.spyOn(event, 'preventDefault')
    pane.dispatchEvent(event)
    expect(spy).not.toHaveBeenCalled()
  })

  it('unmounts previous session instance when active session changes', () => {
    const mockUnmount = vi.fn()
    const mockMount = vi.fn()
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'T1', type: 'human' },
      { id: 'ses-2', tabTitle: 'T2', type: 'human' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockImplementation((id: string) => {
      if (id === 'ses-1')
        return {
          terminal: { focus: vi.fn(), scrollToBottom: vi.fn() },
          mount: mockMount,
          unmount: mockUnmount,
        }
      return {
        terminal: { focus: vi.fn(), scrollToBottom: vi.fn() },
        mount: mockMount,
        unmount: mockUnmount,
      }
    })
    const { rerender } = render(<TerminalPane projectId="proj-1" />)
    mockGetActive.mockReturnValue('ses-2')
    rerender(<TerminalPane projectId="proj-1" />)
    expect(mockUnmount).toHaveBeenCalled()
  })

  describe('split mode (layout present)', () => {
    it('renders split container instead of single pane when layout exists', () => {
      const layout = {
        type: 'split',
        id: 'split-1',
        direction: 'vertical',
        ratio: 0.5,
        first: { type: 'leaf', sessionId: 'ses-1' },
        second: { type: 'leaf', sessionId: 'ses-2' },
      }
      mockGetPaneLayout.mockReturnValue(layout)
      mockGetSessions.mockReturnValue([
        { id: 'ses-1', tabTitle: 'T1', type: 'human' },
        { id: 'ses-2', tabTitle: 'T2', type: 'human' },
      ])
      mockGetActive.mockReturnValue('ses-1')
      const { container } = render(<TerminalPane projectId="proj-1" />)
      expect(container.querySelector('.terminal-pane--split')).toBeTruthy()
    })

    it('calls setSplitRatio when ratio changes in split mode', () => {
      const mockSetSplitRatio = vi.fn()
      vi.mocked(useSessionStore).mockReturnValue({
        getSessionsForProject: mockGetSessions,
        getActiveSessionForProject: mockGetActive,
        getTerminalInstance: mockGetInstance,
        clearBellCount: mockClearBell,
        getPaneLayout: mockGetPaneLayout,
        setSplitRatio: mockSetSplitRatio,
        setFocusedSession: vi.fn(),
      } as unknown as ReturnType<typeof useSessionStore>)
      const layout = {
        type: 'split',
        id: 'split-1',
        direction: 'vertical',
        ratio: 0.5,
        first: { type: 'leaf', sessionId: 'ses-1' },
        second: { type: 'leaf', sessionId: 'ses-2' },
      }
      mockGetPaneLayout.mockReturnValue(layout)
      mockGetSessions.mockReturnValue([
        { id: 'ses-1', tabTitle: 'T1', type: 'human' },
        { id: 'ses-2', tabTitle: 'T2', type: 'human' },
      ])
      mockGetActive.mockReturnValue('ses-1')
      const { container } = render(<TerminalPane projectId="proj-1" />)
      const divider = container.querySelector('.split-container__divider') as HTMLElement
      const outerContainer = container.querySelector('.split-container') as HTMLElement
      if (outerContainer) {
        outerContainer.getBoundingClientRect = vi.fn(() => ({
          left: 0,
          top: 0,
          width: 400,
          height: 300,
          right: 400,
          bottom: 300,
          x: 0,
          y: 0,
          toJSON: vi.fn(),
        }))
        fireEvent.mouseDown(divider, { clientX: 200 })
        fireEvent.mouseMove(document, { clientX: 300 })
        fireEvent.mouseUp(document)
        expect(mockSetSplitRatio).toHaveBeenCalledWith('proj-1', 'split-1', expect.any(Number))
      }
    })
  })
})
