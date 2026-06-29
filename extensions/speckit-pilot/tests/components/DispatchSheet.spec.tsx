import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockDispatch = vi.fn()
vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    dispatch: mockDispatch,
    onStateChanged: vi.fn().mockReturnValue(vi.fn()),
  }),
}))

const mockListBranches = vi.fn()

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    git: { listBranches: mockListBranches },
  }
})

import { DispatchSheet } from '../../src/components/DispatchSheet.js'
import type { TicketRef } from '../../src/types/speckit.types.js'

const ticket: TicketRef = {
  source: 'linear',
  key: 'ENG-42',
  title: 'Build the thing',
  sourceUrl: 'https://linear/ENG-42',
}

describe('DispatchSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDispatch.mockResolvedValue({ featureDir: '/repo/specs/001-eng-42', queued: false })
    mockListBranches.mockResolvedValue({
      branches: [
        { name: 'main', isCurrent: true, isRemote: false },
        { name: 'develop', isCurrent: false, isRemote: false },
      ],
    })
  })

  it('renders Guided autonomy option', () => {
    render(<DispatchSheet ticket={ticket} workspacePath="/repo" />)
    expect(screen.getByText(/guided/i)).toBeTruthy()
  })

  it('renders Standard autonomy option', () => {
    render(<DispatchSheet ticket={ticket} workspacePath="/repo" />)
    expect(screen.getByText(/standard/i)).toBeTruthy()
  })

  it('renders Fast autonomy option', () => {
    render(<DispatchSheet ticket={ticket} workspacePath="/repo" />)
    expect(screen.getByText(/fast/i)).toBeTruthy()
  })

  it('renders 10 gate rows', () => {
    render(<DispatchSheet ticket={ticket} workspacePath="/repo" />)
    const rows = screen.getAllByTestId('gate-row')
    expect(rows).toHaveLength(10)
  })

  it('Self-Review gate row is locked on', () => {
    render(<DispatchSheet ticket={ticket} workspacePath="/repo" />)
    const rows = screen.getAllByTestId('gate-row')
    const selfReviewRow = rows.find((r) => r.getAttribute('data-phase') === 'self-review')
    expect(selfReviewRow?.getAttribute('data-locked')).toBe('true')
  })

  it('Open PR gate row is locked on', () => {
    render(<DispatchSheet ticket={ticket} workspacePath="/repo" />)
    const rows = screen.getAllByTestId('gate-row')
    const openPrRow = rows.find((r) => r.getAttribute('data-phase') === 'open-pr')
    expect(openPrRow?.getAttribute('data-locked')).toBe('true')
  })

  it('renders Start run button', () => {
    render(<DispatchSheet ticket={ticket} workspacePath="/repo" />)
    expect(screen.getByRole('button', { name: /start run/i })).toBeTruthy()
  })

  it('renders base branch selector', async () => {
    render(<DispatchSheet ticket={ticket} workspacePath="/repo" />)
    await waitFor(() => expect(screen.getByRole('combobox')).toBeTruthy())
  })

  it('defaults base branch to main when available', async () => {
    render(<DispatchSheet ticket={ticket} workspacePath="/repo" />)
    await waitFor(() => {
      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('main')
    })
  })

  it('calls dispatch with ticket and Standard autonomy on Start run click', async () => {
    render(<DispatchSheet ticket={ticket} workspacePath="/repo" />)
    fireEvent.click(screen.getByRole('button', { name: /start run/i }))
    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ ticket, autonomyLevel: 'standard' })
      )
    )
  })

  it('calls onDispatched when dispatch succeeds', async () => {
    const onDispatched = vi.fn()
    render(<DispatchSheet ticket={ticket} workspacePath="/repo" onDispatched={onDispatched} />)
    fireEvent.click(screen.getByRole('button', { name: /start run/i }))
    await waitFor(() => expect(onDispatched).toHaveBeenCalledWith('/repo/specs/001-eng-42'))
  })

  it('shows loading state while dispatching', async () => {
    let resolve: (v: unknown) => void = () => {}
    mockDispatch.mockReturnValue(
      new Promise((r) => {
        resolve = r
      })
    )
    render(<DispatchSheet ticket={ticket} workspacePath="/repo" />)
    fireEvent.click(screen.getByRole('button', { name: /start run/i }))
    expect(screen.getByRole('button', { name: /starting/i })).toBeTruthy()
    resolve({ featureDir: '/repo/specs/001', queued: false })
  })
})
