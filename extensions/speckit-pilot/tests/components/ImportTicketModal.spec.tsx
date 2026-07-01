import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockTicketList = vi.fn()
const mockCardCreate = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    ticketList: mockTicketList,
    cardCreate: mockCardCreate,
  }),
}))

import { ImportTicketModal } from '../../src/components/ImportTicketModal.js'

describe('ImportTicketModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCardCreate.mockResolvedValue({ featureDir: '/repo/specs/001-eng-1' })
  })

  it('lists assigned tickets', async () => {
    mockTicketList.mockResolvedValue({
      tickets: [
        { source: 'linear', key: 'ENG-1', title: 'Build auth', sourceUrl: 'https://l/ENG-1' },
      ],
    })
    render(<ImportTicketModal repoRoot="/repo" onClose={vi.fn()} onImported={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Build auth')).toBeTruthy())
    expect(screen.getByText('ENG-1')).toBeTruthy()
  })

  it('shows an empty state when no tickets', async () => {
    mockTicketList.mockResolvedValue({ tickets: [] })
    render(<ImportTicketModal repoRoot="/repo" onClose={vi.fn()} onImported={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/no assigned tickets/i)).toBeTruthy())
  })

  it('surfaces a load error', async () => {
    mockTicketList.mockResolvedValue({ error: 'no creds' })
    render(<ImportTicketModal repoRoot="/repo" onClose={vi.fn()} onImported={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('no creds'))
  })

  it('imports a ticket as a backlog card and calls onImported', async () => {
    mockTicketList.mockResolvedValue({
      tickets: [
        {
          source: 'linear',
          key: 'ENG-1',
          title: 'Build auth',
          sourceUrl: 'https://l/ENG-1',
          body: 'the body',
        },
      ],
    })
    const onImported = vi.fn()
    render(<ImportTicketModal repoRoot="/repo" onClose={vi.fn()} onImported={onImported} />)
    await waitFor(() => screen.getByText('Build auth'))
    fireEvent.click(screen.getByText('Build auth'))
    await waitFor(() =>
      expect(mockCardCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          repoRoot: '/repo',
          brief: expect.objectContaining({ title: 'Build auth', source: 'linear' }),
          ticket: expect.objectContaining({ key: 'ENG-1' }),
        })
      )
    )
    expect(onImported).toHaveBeenCalledWith('/repo/specs/001-eng-1')
  })

  it('closes via the close button', async () => {
    mockTicketList.mockResolvedValue({ tickets: [] })
    const onClose = vi.fn()
    render(<ImportTicketModal repoRoot="/repo" onClose={onClose} onImported={vi.fn()} />)
    await waitFor(() => screen.getByLabelText('Close'))
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})
