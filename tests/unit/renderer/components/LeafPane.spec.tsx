import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))

import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { LeafPane } from '../../../../src/renderer/components/terminal/LeafPane'

const mockGetTerminalInstance = vi.fn()
const mockGetFocusedSession = vi.fn(() => null)
const mockSetFocusedSession = vi.fn()
const mockClearBellCount = vi.fn()
const mockTerminalInput = vi.fn()
const mockSessions = new Map([['sess-1', { id: 'sess-1', tabTitle: 'Terminal 1' }]])

function makeInstance() {
  return {
    mount: vi.fn(),
    unmount: vi.fn(),
    terminal: {
      focus: vi.fn(),
      scrollToBottom: vi.fn(),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSessionStore).mockReturnValue({
    getTerminalInstance: mockGetTerminalInstance,
    getFocusedSession: mockGetFocusedSession,
    setFocusedSession: mockSetFocusedSession,
    clearBellCount: mockClearBellCount,
    sessions: mockSessions,
  } as unknown as ReturnType<typeof useSessionStore>)

  mockGetTerminalInstance.mockReturnValue(undefined)
  mockGetFocusedSession.mockReturnValue(null)
  ;(globalThis as unknown as Record<string, unknown>).electronAPI = {
    terminal: { input: mockTerminalInput },
  }
})

describe('LeafPane', () => {
  it('renders without crashing when no terminal instance', () => {
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(container.querySelector('.leaf-pane')).toBeTruthy()
  })

  it('shows the session tab title in the title bar', () => {
    const { getByText } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(getByText('Terminal 1')).toBeTruthy()
  })

  it('falls back to sessionId in title bar when session not found', () => {
    const { getByText } = render(<LeafPane sessionId="unknown-sess" projectId="proj-1" />)
    expect(getByText('unknown-sess')).toBeTruthy()
  })

  it('adds focused class when session is focused', () => {
    mockGetFocusedSession.mockReturnValue('sess-1')
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(container.querySelector('.leaf-pane--focused')).toBeTruthy()
  })

  it('does not add focused class when session is not focused', () => {
    mockGetFocusedSession.mockReturnValue('other-sess')
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(container.querySelector('.leaf-pane--focused')).toBeNull()
  })

  it('calls setFocusedSession and terminal focus on click', () => {
    const instance = makeInstance()
    mockGetTerminalInstance.mockReturnValue(instance)
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    fireEvent.click(container.querySelector('.leaf-pane')!)
    expect(mockSetFocusedSession).toHaveBeenCalledWith('proj-1', 'sess-1')
    expect(instance.terminal.focus).toHaveBeenCalled()
  })

  it('calls clearBellCount on click', () => {
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    fireEvent.click(container.querySelector('.leaf-pane')!)
    expect(mockClearBellCount).toHaveBeenCalledWith('sess-1')
  })

  it('does not throw on click when no terminal instance', () => {
    mockGetTerminalInstance.mockReturnValue(undefined)
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(() => fireEvent.click(container.querySelector('.leaf-pane')!)).not.toThrow()
  })

  it('sends file paths to terminal on drop', () => {
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const file = Object.assign(new File([], 'report.pdf'), { path: '/Users/me/report.pdf' })
    fireEvent.drop(container.querySelector('.leaf-pane')!, {
      dataTransfer: { files: [file], types: ['Files'] },
    })
    expect(mockTerminalInput).toHaveBeenCalledWith('sess-1', '/Users/me/report.pdf')
  })

  it('quotes paths with spaces on drop', () => {
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const file = Object.assign(new File([], 'my file.txt'), { path: '/my file.txt' })
    fireEvent.drop(container.querySelector('.leaf-pane')!, {
      dataTransfer: { files: [file], types: ['Files'] },
    })
    expect(mockTerminalInput).toHaveBeenCalledWith('sess-1', "'/my file.txt'")
  })

  it('prevents default on dragover when files are dragged', () => {
    const { container } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } })
    const spy = vi.spyOn(event, 'preventDefault')
    container.querySelector('.leaf-pane')!.dispatchEvent(event)
    expect(spy).toHaveBeenCalled()
  })

  it('mounts the terminal instance on mount', () => {
    const instance = makeInstance()
    mockGetTerminalInstance.mockReturnValue(instance)
    render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    expect(instance.mount).toHaveBeenCalled()
  })

  it('unmounts the terminal instance on unmount', () => {
    const instance = makeInstance()
    mockGetTerminalInstance.mockReturnValue(instance)
    const { unmount } = render(<LeafPane sessionId="sess-1" projectId="proj-1" />)
    unmount()
    expect(instance.unmount).toHaveBeenCalled()
  })
})
