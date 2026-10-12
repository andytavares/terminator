import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useTerminalOpenErrorStore } from '../../../../src/renderer/stores/terminal-open-error.store'
import { TerminalPane } from '../../../../src/renderer/components/terminal/TerminalPane'
import { useModalStore } from '../../../../src/renderer/stores/modal.store'
import { seedStore } from '../../../support/renderer-stores'
import type { PaneNode } from '../../../../src/shared/types/index'

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
const mockGetPaneLayout = vi.fn<(projectId: string) => PaneNode | null>(() => null)
const mockSetSplitRatio = vi.fn()

const mockSetFocusedSession = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  useModalStore.setState({ depth: 0 })
  seedStore(useSessionStore, {
    getSessionsForProject: mockGetSessions,
    getActiveSessionForProject: mockGetActive,
    getTerminalInstance: mockGetInstance,
    clearBellCount: mockClearBell,
    getPaneLayout: mockGetPaneLayout,
    setSplitRatio: mockSetSplitRatio,
    setFocusedSession: mockSetFocusedSession,
    focusRequest: null,
  })
  mockGetSessions.mockReturnValue([])
  mockGetActive.mockReturnValue(null)
  mockGetInstance.mockReturnValue(undefined)
  mockGetPaneLayout.mockReturnValue(null)
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    terminal: { input: mockTerminalInput },
    getFilePath: (f: File) => (f as unknown as { path: string }).path,
  }
})

afterEach(() => {
  useTerminalOpenErrorStore.setState({ errors: {}, retries: {} })
  delete (globalThis as unknown as Record<string, unknown>).electronAPI
})

describe('TerminalPane', () => {
  it('shows empty state when no sessions', () => {
    render(<TerminalPane projectId="proj-1" />)
    expect(screen.getByText('Open a terminal tab to get started')).toBeTruthy()
  })

  it('shows why the terminal failed to open, and Try again asks the app to open it again', () => {
    useTerminalOpenErrorStore.getState().setError('proj-1', 'spawn EBADF')
    render(<TerminalPane projectId="proj-1" />)
    expect(screen.getByRole('alert').textContent).toContain("Couldn't open a terminal: spawn EBADF")
    expect(screen.queryByText('Open a terminal tab to get started')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(useTerminalOpenErrorStore.getState().retries['proj-1']).toBe(1)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Open a terminal tab to get started')).toBeTruthy()
  })

  it('shows only the error of its own project', () => {
    useTerminalOpenErrorStore.getState().setError('proj-2', 'spawn EBADF')
    render(<TerminalPane projectId="proj-1" />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears the error once a session exists', () => {
    useTerminalOpenErrorStore.getState().setError('proj-1', 'spawn EBADF')
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'Terminal', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    render(<TerminalPane projectId="proj-1" />)
    expect(useTerminalOpenErrorStore.getState().errors['proj-1']).toBeUndefined()
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
    const mockMount = vi.fn()
    mockGetSessions.mockReturnValue([
      { id: 'ses-1', tabTitle: 'T1', type: 'human' },
      { id: 'ses-2', tabTitle: 'T2', type: 'human' },
    ])
    mockGetActive.mockReturnValue('ses-1')
    const unmountFirst = vi.fn()
    const unmountSecond = vi.fn()
    const instances = new Map([
      [
        'ses-1',
        {
          terminal: { focus: vi.fn(), scrollToBottom: vi.fn() },
          mount: mockMount,
          unmount: unmountFirst,
        },
      ],
      [
        'ses-2',
        {
          terminal: { focus: vi.fn(), scrollToBottom: vi.fn() },
          mount: mockMount,
          unmount: unmountSecond,
        },
      ],
    ])
    mockGetInstance.mockImplementation((id: string) => instances.get(id))
    const { rerender } = render(<TerminalPane projectId="proj-1" />)
    mockGetActive.mockReturnValue('ses-2')
    rerender(<TerminalPane projectId="proj-1" />)
    expect(unmountFirst).toHaveBeenCalled()
    expect(unmountSecond).not.toHaveBeenCalled()
  })

  describe('focusRequest', () => {
    function withRaf(): void {
      vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
        ;(cb as FrameRequestCallback)(0)
        return 0
      })
    }

    it('focuses the requested instance in single-pane mode', () => {
      withRaf()
      const mockFocus = vi.fn()
      mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
      mockGetActive.mockReturnValue('ses-1')
      mockGetInstance.mockReturnValue({
        terminal: { focus: mockFocus, scrollToBottom: vi.fn() },
        mount: vi.fn(),
        unmount: vi.fn(),
      })
      seedStore(useSessionStore, {
        getSessionsForProject: mockGetSessions,
        getActiveSessionForProject: mockGetActive,
        getTerminalInstance: mockGetInstance,
        clearBellCount: mockClearBell,
        getPaneLayout: mockGetPaneLayout,
        setSplitRatio: mockSetSplitRatio,
        setFocusedSession: mockSetFocusedSession,
        focusRequest: { sessionId: 'ses-1', nonce: 1 },
      })
      render(<TerminalPane projectId="proj-1" />)
      expect(mockFocus).toHaveBeenCalled()
    })

    it('sets the focused leaf and focuses its instance in split mode', () => {
      withRaf()
      const mockFocus = vi.fn()
      const layout: PaneNode = {
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
      mockGetInstance.mockReturnValue({
        terminal: { focus: mockFocus, scrollToBottom: vi.fn() },
        mount: vi.fn(),
        unmount: vi.fn(),
      })
      seedStore(useSessionStore, {
        getSessionsForProject: mockGetSessions,
        getActiveSessionForProject: mockGetActive,
        getTerminalInstance: mockGetInstance,
        clearBellCount: mockClearBell,
        getPaneLayout: mockGetPaneLayout,
        setSplitRatio: mockSetSplitRatio,
        setFocusedSession: mockSetFocusedSession,
        focusRequest: { sessionId: 'ses-2', nonce: 1 },
      })
      render(<TerminalPane projectId="proj-1" />)
      expect(mockSetFocusedSession).toHaveBeenCalledWith('proj-1', 'ses-2')
      expect(mockFocus).toHaveBeenCalled()
    })

    it('does not focus while a modal is open', () => {
      withRaf()
      useModalStore.setState({ depth: 1 })
      const mockFocus = vi.fn()
      mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
      mockGetActive.mockReturnValue('ses-1')
      mockGetInstance.mockReturnValue({
        terminal: { focus: mockFocus, scrollToBottom: vi.fn() },
        mount: vi.fn(),
        unmount: vi.fn(),
      })
      seedStore(useSessionStore, {
        getSessionsForProject: mockGetSessions,
        getActiveSessionForProject: mockGetActive,
        getTerminalInstance: mockGetInstance,
        clearBellCount: mockClearBell,
        getPaneLayout: mockGetPaneLayout,
        setSplitRatio: mockSetSplitRatio,
        setFocusedSession: mockSetFocusedSession,
        focusRequest: { sessionId: 'ses-1', nonce: 1 },
      })
      render(<TerminalPane projectId="proj-1" />)
      expect(mockFocus).not.toHaveBeenCalled()
    })
    it('does not take focus from a modal that opened before the frame ran', () => {
      let frame: FrameRequestCallback | undefined
      vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
        frame = cb as FrameRequestCallback
        return 0
      })
      const mockFocus = vi.fn()
      mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
      mockGetActive.mockReturnValue('ses-1')
      mockGetInstance.mockReturnValue({
        terminal: { focus: mockFocus, scrollToBottom: vi.fn() },
        mount: vi.fn(),
        unmount: vi.fn(),
      })
      seedStore(useSessionStore, {
        getSessionsForProject: mockGetSessions,
        getActiveSessionForProject: mockGetActive,
        getTerminalInstance: mockGetInstance,
        clearBellCount: mockClearBell,
        getPaneLayout: mockGetPaneLayout,
        setSplitRatio: mockSetSplitRatio,
        setFocusedSession: mockSetFocusedSession,
        focusRequest: { sessionId: 'ses-1', nonce: 1 },
      })
      render(<TerminalPane projectId="proj-1" />)
      mockFocus.mockClear()
      useModalStore.setState({ depth: 1 })
      frame?.(0)
      expect(mockFocus).not.toHaveBeenCalled()
    })
  })

  describe('split mode (layout present)', () => {
    it('renders split container instead of single pane when layout exists', () => {
      const layout: PaneNode = {
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
      seedStore(useSessionStore, {
        getSessionsForProject: mockGetSessions,
        getActiveSessionForProject: mockGetActive,
        getTerminalInstance: mockGetInstance,
        clearBellCount: mockClearBell,
        getPaneLayout: mockGetPaneLayout,
        setSplitRatio: mockSetSplitRatio,
        setFocusedSession: vi.fn(),
      })
      const layout: PaneNode = {
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
      outerContainer.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300)
      fireEvent.mouseDown(divider, { clientX: 200 })
      fireEvent.mouseMove(document, { clientX: 300 })
      fireEvent.mouseUp(document)
      expect(mockSetSplitRatio).toHaveBeenCalledWith('proj-1', 'split-1', 0.75)
    })
  })
})
