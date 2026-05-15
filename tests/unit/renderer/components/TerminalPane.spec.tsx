import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { TerminalPane } from '../../../../src/renderer/components/terminal/TerminalPane'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))

const mockGetSessions = vi.fn()
const mockGetActive = vi.fn()
const mockGetInstance = vi.fn()
const mockClearBell = vi.fn()
const mockTerminalInput = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useSessionStore).mockReturnValue({
    getSessionsForProject: mockGetSessions,
    getActiveSessionForProject: mockGetActive,
    getTerminalInstance: mockGetInstance,
    clearBellCount: mockClearBell,
  } as unknown as ReturnType<typeof useSessionStore>)
  mockGetSessions.mockReturnValue([])
  mockGetActive.mockReturnValue(null)
  mockGetInstance.mockReturnValue(undefined)
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
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    mockGetInstance.mockReturnValue({
      terminal: { focus: mockFocus },
      mount: vi.fn(),
      unmount: vi.fn(),
    })
    const { container } = render(<TerminalPane projectId="proj-1" />)
    fireEvent.click(container.querySelector('.terminal-pane')!)
    expect(mockFocus).toHaveBeenCalled()
  })

  it('writes dropped file paths to the active terminal session', () => {
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    const { container } = render(<TerminalPane projectId="proj-1" />)
    const pane = container.querySelector('.terminal-pane')!
    const file = Object.assign(new File([], 'report.pdf'), { path: '/Users/me/report.pdf' })
    fireEvent.drop(pane, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(mockTerminalInput).toHaveBeenCalledWith('ses-1', '/Users/me/report.pdf')
  })

  it('quotes paths with spaces when dropping files', () => {
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    const { container } = render(<TerminalPane projectId="proj-1" />)
    const pane = container.querySelector('.terminal-pane')!
    const file = Object.assign(new File([], 'my file.png'), { path: '/Users/me/my file.png' })
    fireEvent.drop(pane, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(mockTerminalInput).toHaveBeenCalledWith('ses-1', "'/Users/me/my file.png'")
  })

  it('joins multiple dropped files with spaces', () => {
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue('ses-1')
    const { container } = render(<TerminalPane projectId="proj-1" />)
    const pane = container.querySelector('.terminal-pane')!
    const f1 = Object.assign(new File([], 'a.txt'), { path: '/a.txt' })
    const f2 = Object.assign(new File([], 'b.txt'), { path: '/b.txt' })
    fireEvent.drop(pane, { dataTransfer: { files: [f1, f2], types: ['Files'] } })
    expect(mockTerminalInput).toHaveBeenCalledWith('ses-1', '/a.txt /b.txt')
  })

  it('does not call input when no active session on drop', () => {
    mockGetSessions.mockReturnValue([{ id: 'ses-1', tabTitle: 'T', type: 'human' }])
    mockGetActive.mockReturnValue(null)
    const { container } = render(<TerminalPane projectId="proj-1" />)
    const pane = container.querySelector('.terminal-pane')!
    const file = Object.assign(new File([], 'x.txt'), { path: '/x.txt' })
    fireEvent.drop(pane, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(mockTerminalInput).not.toHaveBeenCalled()
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
        return { terminal: { focus: vi.fn() }, mount: mockMount, unmount: mockUnmount }
      return { terminal: { focus: vi.fn() }, mount: mockMount, unmount: mockUnmount }
    })
    const { rerender } = render(<TerminalPane projectId="proj-1" />)
    mockGetActive.mockReturnValue('ses-2')
    rerender(<TerminalPane projectId="proj-1" />)
    expect(mockUnmount).toHaveBeenCalled()
  })
})
