import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockCheckinDecision = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    checkinDecision: mockCheckinDecision,
  }),
}))

import { BatchCheckIn } from '../../src/components/BatchCheckIn.js'

describe('BatchCheckIn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckinDecision.mockResolvedValue({ ok: true })
  })

  it('renders batch label showing section number', () => {
    render(
      <BatchCheckIn featureDir="/repo/specs/001" batchIndex={0} diffSummary="3 files changed" />
    )
    expect(screen.getByText(/batch/i)).toBeTruthy()
  })

  it('renders diff summary text', () => {
    render(
      <BatchCheckIn
        featureDir="/repo/specs/001"
        batchIndex={1}
        diffSummary="5 files changed, +120 -30"
      />
    )
    expect(screen.getByText(/5 files changed/)).toBeTruthy()
  })

  it('renders Continue button', () => {
    render(<BatchCheckIn featureDir="/repo/specs/001" batchIndex={0} diffSummary="" />)
    expect(screen.getByRole('button', { name: /continue/i })).toBeTruthy()
  })

  it('renders Pause button', () => {
    render(<BatchCheckIn featureDir="/repo/specs/001" batchIndex={0} diffSummary="" />)
    expect(screen.getByRole('button', { name: /pause/i })).toBeTruthy()
  })

  it('renders Split to follow-up button', () => {
    render(<BatchCheckIn featureDir="/repo/specs/001" batchIndex={0} diffSummary="" />)
    expect(screen.getByRole('button', { name: /split/i })).toBeTruthy()
  })

  it('calls checkinDecision with continue on Continue click', async () => {
    render(<BatchCheckIn featureDir="/repo/specs/001" batchIndex={2} diffSummary="" />)
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() =>
      expect(mockCheckinDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          featureDir: '/repo/specs/001',
          decision: 'continue',
          batchIndex: 2,
        })
      )
    )
  })

  it('calls checkinDecision with pause on Pause click', async () => {
    render(<BatchCheckIn featureDir="/repo/specs/001" batchIndex={1} diffSummary="" />)
    fireEvent.click(screen.getByRole('button', { name: /pause/i }))
    await waitFor(() =>
      expect(mockCheckinDecision).toHaveBeenCalledWith(
        expect.objectContaining({ featureDir: '/repo/specs/001', decision: 'pause', batchIndex: 1 })
      )
    )
  })

  it('calls checkinDecision with split on Split click', async () => {
    render(<BatchCheckIn featureDir="/repo/specs/001" batchIndex={0} diffSummary="" />)
    fireEvent.click(screen.getByRole('button', { name: /split/i }))
    await waitFor(() =>
      expect(mockCheckinDecision).toHaveBeenCalledWith(
        expect.objectContaining({ featureDir: '/repo/specs/001', decision: 'split', batchIndex: 0 })
      )
    )
  })
})
