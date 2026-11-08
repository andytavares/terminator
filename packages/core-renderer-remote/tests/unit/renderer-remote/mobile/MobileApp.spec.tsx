import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React, { type ComponentProps } from 'react'
import type { MobileTerminalList } from '../../../../src/components/MobileTerminalList'

const mockListWorkspaces = vi.fn()
const mockListTerminals = vi.fn()
const mockGetWsTicket = vi.fn()

const mockAssignTerminalWorkspace = vi.fn()

vi.mock('../../../../src/api/remote-client', () => ({
  listWorkspaces: mockListWorkspaces,
  listTerminals: mockListTerminals,
  getWsTicket: mockGetWsTicket,
  createTerminal: vi.fn(),
  assignTerminalWorkspace: mockAssignTerminalWorkspace,
}))

vi.mock('../../../../src/components/MobileTerminalList', () => ({
  MobileTerminalList: ({
    workspaces,
    terminals,
    onSelectTerminal,
    onCreateTerminal,
    onAssignWorkspace,
  }: ComponentProps<typeof MobileTerminalList>) => (
    <div>
      <ul aria-label="workspaces">
        {workspaces.map((w) => (
          <li key={w.name}>{w.name}</li>
        ))}
      </ul>
      <ul aria-label="terminals">
        {terminals.map((t) => (
          <li key={t.sessionId}>{t.sessionId}</li>
        ))}
      </ul>
      <button onClick={() => onSelectTerminal({ sessionId: 's1', cwd: '/tmp' })}>
        open terminal
      </button>
      <button onClick={() => onCreateTerminal('w1', '/workspace')}>new terminal</button>
      <button onClick={() => onAssignWorkspace('s1', 'w1')}>assign workspace</button>
    </div>
  ),
}))

vi.mock('../../../../src/components/MobileTerminalView', () => ({
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

const terminal = (sessionId: string) => ({ sessionId, cwd: '/tmp', createdAt: '2026-01-01' })
const workspace = { id: 'w1', name: 'Home', folderPath: '/home', color: '#000', tags: [] }

beforeEach(() => {
  mockListWorkspaces.mockResolvedValue([])
  mockListTerminals.mockResolvedValue([])
  mockGetWsTicket.mockResolvedValue('ticket-xyz')
  mockAssignTerminalWorkspace.mockResolvedValue(undefined)
  vi.clearAllMocks()
})

describe('MobileApp', () => {
  it('switches to MobileTerminalView when a terminal is chosen, and back to the list on onBack', async () => {
    const user = userEvent.setup()
    const { MobileApp } = await import('../../../../src/MobileApp')
    render(<MobileApp />)
    await user.click(await screen.findByRole('button', { name: 'open terminal' }))
    expect(screen.getByText('terminal:s1').textContent).toBe('terminal:s1')
    await user.click(screen.getByRole('button', { name: 'back' }))
    expect(screen.queryByText('terminal:s1')).toBeNull()
    expect(screen.getByRole('button', { name: 'open terminal' }).textContent).toBe('open terminal')
  })
})

describe('MobileApp — lists the workspaces and terminals the server reports on mount', () => {
  it('lists the workspaces and terminals the server reports on mount', async () => {
    mockListWorkspaces.mockResolvedValue([workspace])
    mockListTerminals.mockResolvedValue([terminal('t-9')])
    const { MobileApp } = await import('../../../../src/MobileApp')
    render(<MobileApp />)
    const terminals = await screen.findByRole('list', { name: 'terminals' })
    await waitFor(() => expect(terminals.textContent).toBe('t-9'))
    expect(screen.getByRole('list', { name: 'workspaces' }).textContent).toBe('Home')
  })

  it('assigns the terminal to the workspace and shows the refreshed terminals', async () => {
    const user = userEvent.setup()
    mockListTerminals.mockResolvedValueOnce([terminal('s1')]).mockResolvedValue([terminal('s2')])
    const { MobileApp } = await import('../../../../src/MobileApp')
    render(<MobileApp />)
    await screen.findByText('s1')
    await user.click(screen.getByRole('button', { name: 'assign workspace' }))
    await screen.findByText('s2')
    expect(mockAssignTerminalWorkspace).toHaveBeenCalledWith('s1', 'w1')
  })
})

describe('MobileApp — onCreateTerminal calls createTerminal and navigates to terminal view', () => {
  it('onCreateTerminal calls createTerminal and navigates to terminal view', async () => {
    const user = userEvent.setup()
    const { createTerminal } = await import('../../../../src/api/remote-client')
    vi.mocked(createTerminal).mockResolvedValue({ sessionId: 'new-s1' })
    const { MobileApp } = await import('../../../../src/MobileApp')
    render(<MobileApp />)
    await user.click(await screen.findByRole('button', { name: 'new terminal' }))
    await screen.findByText('terminal:new-s1')
    expect(createTerminal).toHaveBeenCalledWith({ cwd: '/workspace', tabTitle: 'Remote' })
  })
})

describe('MobileApp when the server fails', () => {
  it('still shows the list when the first listings fail', async () => {
    mockListWorkspaces.mockRejectedValue(new Error('offline'))
    mockListTerminals.mockRejectedValue(new Error('offline'))
    const { MobileApp } = await import('../../../../src/MobileApp')
    render(<MobileApp />)
    await waitFor(() => expect(mockListTerminals).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('list', { name: 'terminals' }).textContent).toBe('')
    expect(screen.getByRole('button', { name: 'open terminal' }).textContent).toBe('open terminal')
  })

  it('stays on the list when a new terminal cannot be made', async () => {
    const user = userEvent.setup()
    const { createTerminal } = await import('../../../../src/api/remote-client')
    vi.mocked(createTerminal).mockRejectedValue(new Error('refused'))
    const { MobileApp } = await import('../../../../src/MobileApp')
    render(<MobileApp />)
    await user.click(screen.getByRole('button', { name: 'new terminal' }))
    expect(createTerminal).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/^terminal:/)).toBeNull()
    expect(screen.getByRole('button', { name: 'open terminal' }).textContent).toBe('open terminal')
  })
})

describe('MobileApp when the server fails — refreshes the terminals after a failed assignment and on the way back', () => {
  it('refreshes the terminals after a failed assignment and on the way back', async () => {
    const user = userEvent.setup()
    mockAssignTerminalWorkspace.mockRejectedValue(new Error('refused'))
    mockListTerminals.mockRejectedValue(new Error('offline'))
    const { MobileApp } = await import('../../../../src/MobileApp')
    render(<MobileApp />)
    await user.click(screen.getByRole('button', { name: 'assign workspace' }))
    await waitFor(() => expect(mockListTerminals).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'open terminal' }))
    await user.click(screen.getByRole('button', { name: 'back' }))
    expect(mockListTerminals).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: 'open terminal' }).textContent).toBe('open terminal')
  })
})
