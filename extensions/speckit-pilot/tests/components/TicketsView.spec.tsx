import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockTicketList = vi.fn()
const mockCredentialsStatus = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    ticketList: mockTicketList,
    credentialsStatus: mockCredentialsStatus,
    dispatch: vi.fn().mockResolvedValue({ featureDir: '/repo/specs/001', queued: false }),
    onStateChanged: vi.fn().mockReturnValue(vi.fn()),
  }),
}))

import { TicketsView } from '../../src/components/TicketsView.js'

describe('TicketsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCredentialsStatus.mockResolvedValue({ connected: false })
    mockTicketList.mockResolvedValue({ tickets: [] })
  })

  it('renders empty state when no credentials configured', async () => {
    mockCredentialsStatus.mockResolvedValue({ connected: false })
    render(<TicketsView workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByText(/connect linear or jira/i)).toBeTruthy()
    })
  })

  it('renders ticket list with source badges when tickets loaded', async () => {
    mockCredentialsStatus.mockResolvedValue({ connected: true })
    mockTicketList.mockResolvedValue({
      tickets: [
        {
          source: 'linear',
          key: 'ENG-1',
          title: 'Build auth',
          sourceUrl: 'https://l/ENG-1',
          body: '',
          acceptanceCriteria: [],
        },
        {
          source: 'jira',
          key: 'PROJ-1',
          title: 'Fix bug',
          sourceUrl: 'https://j/PROJ-1',
          body: '',
          acceptanceCriteria: [],
        },
      ],
    })
    render(<TicketsView workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByText('Build auth')).toBeTruthy()
      expect(screen.getByText('Fix bug')).toBeTruthy()
      // Source badges (may appear multiple times incl filter pills — use getAllByText)
      expect(screen.getAllByText('linear').length).toBeGreaterThan(0)
      expect(screen.getAllByText('jira').length).toBeGreaterThan(0)
    })
  })

  it('filter pill for linear filters to linear tickets only', async () => {
    mockCredentialsStatus.mockResolvedValue({ connected: true })
    mockTicketList.mockResolvedValue({
      tickets: [
        {
          source: 'linear',
          key: 'ENG-1',
          title: 'Linear ticket',
          sourceUrl: 'https://l/ENG-1',
          body: '',
          acceptanceCriteria: [],
        },
        {
          source: 'jira',
          key: 'PROJ-1',
          title: 'Jira ticket',
          sourceUrl: 'https://j/PROJ-1',
          body: '',
          acceptanceCriteria: [],
        },
      ],
    })
    render(<TicketsView workspacePath="/repo" />)
    await waitFor(() => expect(screen.getByText('Linear ticket')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /linear/i }))
    expect(screen.getByText('Linear ticket')).toBeTruthy()
    expect(screen.queryByText('Jira ticket')).toBeNull()
  })

  it('clicking a ticket shows DispatchSheet', async () => {
    mockCredentialsStatus.mockResolvedValue({ connected: true })
    mockTicketList.mockResolvedValue({
      tickets: [
        {
          source: 'linear',
          key: 'ENG-42',
          title: 'Build the thing',
          sourceUrl: 'https://l/ENG-42',
          body: '',
          acceptanceCriteria: [],
        },
      ],
    })
    render(<TicketsView workspacePath="/repo" />)
    await waitFor(() => expect(screen.getByText('Build the thing')).toBeTruthy())
    fireEvent.click(screen.getByText('Build the thing'))
    // dispatch accordion is collapsed by default — expand it first
    await waitFor(() => expect(screen.getByText(/start a run/i)).toBeTruthy())
    fireEvent.click(screen.getByText(/start a run/i))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start run/i })).toBeTruthy()
    })
  })

  it('shows error message when ticket fetch fails', async () => {
    mockCredentialsStatus.mockResolvedValue({ connected: true })
    mockTicketList.mockResolvedValue({ error: 'Network error' })
    render(<TicketsView workspacePath="/repo" />)
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeTruthy()
    })
  })
})
