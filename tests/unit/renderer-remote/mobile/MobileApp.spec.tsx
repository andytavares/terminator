import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import React from 'react'

const mockListWorkspaces = vi.fn()
const mockListTerminals = vi.fn()
const mockGetWsTicket = vi.fn()

const mockAssignTerminalWorkspace = vi.fn()

vi.mock('../../../../src/renderer-remote/api/remote-client', () => ({
  listWorkspaces: mockListWorkspaces,
  listTerminals: mockListTerminals,
  getWsTicket: mockGetWsTicket,
  createTerminal: vi.fn(),
  assignTerminalWorkspace: mockAssignTerminalWorkspace,
}))

vi.mock('../../../../src/renderer-remote/components/MobileTerminalList', () => ({
  MobileTerminalList: ({
    onSelectTerminal,
    onCreateTerminal,
    onAssignWorkspace,
  }: {
    onSelectTerminal: (t: { sessionId: string; cwd: string }) => void
    onCreateTerminal: (workspaceId: string, folderPath: string) => void
    onAssignWorkspace: (sessionId: string, workspaceId: string | null) => void
  }) => (
    <div>
      <button onClick={() => onSelectTerminal({ sessionId: 's1', cwd: '/tmp' })}>
        open terminal
      </button>
      <button onClick={() => onCreateTerminal('w1', '/workspace')}>new terminal</button>
      <button onClick={() => onAssignWorkspace('s1', 'w1')}>assign workspace</button>
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
  mockAssignTerminalWorkspace.mockResolvedValue(undefined)
  vi.clearAllMocks()
})

describe('MobileApp', () => {
  it('renders MobileTerminalList by default', async () => {
    mockListWorkspaces.mockResolvedValue([])
    mockListTerminals.mockResolvedValue([])
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    expect(await screen.findByText('open terminal')).toBeTruthy()
  })

  it('switches to MobileTerminalView when onSelectTerminal is called', async () => {
    mockListWorkspaces.mockResolvedValue([])
    mockListTerminals.mockResolvedValue([])
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    await screen.findByText('open terminal')
    fireEvent.click(screen.getByText('open terminal'))
    expect(screen.getByText('terminal:s1')).toBeTruthy()
  })

  it('returns to list view when onBack is called from MobileTerminalView', async () => {
    mockListWorkspaces.mockResolvedValue([])
    mockListTerminals.mockResolvedValue([])
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    await screen.findByText('open terminal')
    fireEvent.click(screen.getByText('open terminal'))
    expect(screen.getByText('terminal:s1')).toBeTruthy()
    fireEvent.click(screen.getByText('back'))
    expect(screen.getByText('open terminal')).toBeTruthy()
  })
})

describe('MobileApp — calls listWorkspaces and listTerminals on mount', () => {
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

  it('onAssignWorkspace calls assignTerminalWorkspace and refreshes terminals', async () => {
    mockListWorkspaces.mockResolvedValue([])
    mockListTerminals.mockResolvedValue([])
    mockAssignTerminalWorkspace.mockResolvedValue(undefined)
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    await screen.findByText('assign workspace')
    await act(async () => {
      fireEvent.click(screen.getByText('assign workspace'))
    })
    await waitFor(() => {
      expect(mockAssignTerminalWorkspace).toHaveBeenCalledWith('s1', 'w1')
      expect(mockListTerminals).toHaveBeenCalledTimes(2) // once on mount, once after assign
    })
  })
})

describe('MobileApp — onCreateTerminal calls createTerminal and navigates to terminal view', () => {
  it('onCreateTerminal calls createTerminal and navigates to terminal view', async () => {
    const { createTerminal } = await import('../../../../src/renderer-remote/api/remote-client')
    vi.mocked(createTerminal).mockResolvedValue({ sessionId: 'new-s1' })
    mockListWorkspaces.mockResolvedValue([])
    mockListTerminals.mockResolvedValue([])
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    await screen.findByText('new terminal')
    await act(async () => {
      fireEvent.click(screen.getByText('new terminal'))
    })
    await waitFor(() => {
      expect(createTerminal).toHaveBeenCalledWith({ cwd: '/workspace', tabTitle: 'Remote' })
      expect(screen.getByText('terminal:new-s1')).toBeTruthy()
    })
  })
})

describe('MobileApp when the server fails', () => {
  it('still shows the list when the first listings fail', async () => {
    mockListWorkspaces.mockRejectedValue(new Error('offline'))
    mockListTerminals.mockRejectedValue(new Error('offline'))
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    await waitFor(() => expect(mockListTerminals).toHaveBeenCalledTimes(1))
    expect(screen.getByText('open terminal')).toBeTruthy()
  })

  it('stays on the list when a new terminal cannot be made', async () => {
    const { createTerminal } = await import('../../../../src/renderer-remote/api/remote-client')
    vi.mocked(createTerminal).mockRejectedValue(new Error('refused'))
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    await act(async () => {
      fireEvent.click(screen.getByText('new terminal'))
    })
    expect(createTerminal).toHaveBeenCalledTimes(1)
    expect(screen.getByText('open terminal')).toBeTruthy()
  })
})

describe('MobileApp when the server fails — refreshes the terminals after a failed assignment and on the way back', () => {
  it('refreshes the terminals after a failed assignment and on the way back', async () => {
    mockAssignTerminalWorkspace.mockRejectedValue(new Error('refused'))
    mockListTerminals.mockRejectedValue(new Error('offline'))
    const { MobileApp } = await import('../../../../src/renderer-remote/MobileApp')
    render(<MobileApp />)
    await act(async () => {
      fireEvent.click(screen.getByText('assign workspace'))
    })
    await waitFor(() => expect(mockListTerminals).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByText('open terminal'))
    fireEvent.click(screen.getByText('back'))
    expect(mockListTerminals).toHaveBeenCalledTimes(3)
    expect(screen.getByText('open terminal')).toBeTruthy()
  })
})
