import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

const mockListWorkspaces = vi.fn()
const mockListTerminals = vi.fn()
const mockGetWsTicket = vi.fn()

vi.mock('../../../../src/renderer-remote/api/remote-client', () => ({
  listWorkspaces: mockListWorkspaces,
  listTerminals: mockListTerminals,
  getWsTicket: mockGetWsTicket,
  createTerminal: vi.fn(),
}))

vi.mock('../../../../src/renderer-remote/components/MobileTerminalList', () => ({
  MobileTerminalList: ({
    onSelectTerminal,
    onCreateTerminal,
  }: {
    onSelectTerminal: (t: { sessionId: string; cwd: string }) => void
    onCreateTerminal: (workspaceId: string, folderPath: string) => void
  }) => (
    <div>
      <button onClick={() => onSelectTerminal({ sessionId: 's1', cwd: '/tmp' })}>
        open terminal
      </button>
      <button onClick={() => onCreateTerminal('w1', '/workspace')}>new terminal</button>
    </div>
  ),
}))

vi.mock('../../../../src/renderer-remote/components/MobileTerminalView', () => ({
  MobileTerminalView: ({
    sessionId,
    onBack,
  }: {
    sessionId: string
    cwd: string
    onBack: () => void
  }) => (
    <div>
      <span>terminal:{sessionId}</span>
      <button onClick={onBack}>back</button>
    </div>
  ),
}))

beforeEach(() => {
  mockListWorkspaces.mockResolvedValue([])
  mockListTerminals.mockResolvedValue([])
  mockGetWsTicket.mockResolvedValue('ticket-xyz')
  vi.clearAllMocks()
})

describe('MobileApp', () => {
  it('renders MobileTerminalList by default', async () => {
    mockListWorkspaces.mockResolvedValue([])
    mockListTerminals.mockResolvedValue([])
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    await waitFor(() => expect(screen.getByText('open terminal')).toBeTruthy())
  })

  it('switches to MobileTerminalView when onSelectTerminal is called', async () => {
    mockListWorkspaces.mockResolvedValue([])
    mockListTerminals.mockResolvedValue([])
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    await waitFor(() => screen.getByText('open terminal'))
    fireEvent.click(screen.getByText('open terminal'))
    expect(screen.getByText('terminal:s1')).toBeTruthy()
  })

  it('returns to list view when onBack is called from MobileTerminalView', async () => {
    mockListWorkspaces.mockResolvedValue([])
    mockListTerminals.mockResolvedValue([])
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    await waitFor(() => screen.getByText('open terminal'))
    fireEvent.click(screen.getByText('open terminal'))
    expect(screen.getByText('terminal:s1')).toBeTruthy()
    fireEvent.click(screen.getByText('back'))
    expect(screen.getByText('open terminal')).toBeTruthy()
  })

  it('calls listWorkspaces and listTerminals on mount', async () => {
    mockListWorkspaces.mockResolvedValue([])
    mockListTerminals.mockResolvedValue([])
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    await waitFor(() => {
      expect(mockListWorkspaces).toHaveBeenCalledTimes(1)
      expect(mockListTerminals).toHaveBeenCalledTimes(1)
    })
  })

  it('onCreateTerminal calls createTerminal and navigates to terminal view', async () => {
    const { createTerminal } = await import('../../../../src/renderer-remote/api/remote-client')
    vi.mocked(createTerminal).mockResolvedValue({ sessionId: 'new-s1' })
    mockListWorkspaces.mockResolvedValue([])
    mockListTerminals.mockResolvedValue([])
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    await waitFor(() => screen.getByText('new terminal'))
    await act(async () => {
      fireEvent.click(screen.getByText('new terminal'))
    })
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith({ cwd: '/workspace', tabTitle: 'Remote' })
      expect(screen.getByText('terminal:new-s1')).toBeTruthy()
    })
  })
})
