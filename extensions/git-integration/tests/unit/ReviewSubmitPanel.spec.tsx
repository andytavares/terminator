import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ReviewSubmitPanel } from '../../src/components/pr-review/ReviewSubmitPanel'

const mockPrReviewSubmit = vi.fn()

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    prReviewSubmit: (...args: unknown[]) => mockPrReviewSubmit(...args),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ReviewSubmitPanel', () => {
  const defaultProps = {
    repoRoot: '/repo',
    prNumber: 42,
    commitId: 'abc123',
    onClose: vi.fn(),
  }

  it('renders submit review heading', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    expect(screen.getAllByText('Submit review').length).toBeGreaterThanOrEqual(1)
  })

  it('renders three radio options', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    expect(screen.getByText('Approve')).toBeTruthy()
    expect(screen.getByText('Request changes')).toBeTruthy()
    expect(screen.getByText('Comment')).toBeTruthy()
  })

  it('defaults to Comment radio option', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    const radios = screen.getAllByRole('radio')
    const commentRadio = radios.find((r) => r.getAttribute('value') === 'COMMENT')
    expect((commentRadio as HTMLInputElement).checked).toBe(true)
  })

  it('changes radio selection when clicking Approve', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    const approveLabel = screen.getByText('Approve')
    fireEvent.click(approveLabel.closest('label')!)
    const radios = screen.getAllByRole('radio')
    const approveRadio = radios.find((r) => r.getAttribute('value') === 'APPROVE')
    expect((approveRadio as HTMLInputElement).checked).toBe(true)
  })

  it('renders a textarea for review body', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    expect(screen.getByPlaceholderText(/Leave a summary comment/)).toBeTruthy()
  })

  it('renders Cancel and Submit review buttons', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    expect(screen.getByText('Cancel')).toBeTruthy()
    const submitBtns = screen.getAllByText('Submit review')
    expect(submitBtns.length).toBeGreaterThanOrEqual(2) // heading + button
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<ReviewSubmitPanel {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows success state after successful submission', async () => {
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    render(<ReviewSubmitPanel {...defaultProps} />)
    const submitBtn = screen.getByRole('button', { name: 'Submit review' })
    fireEvent.click(submitBtn)
    await waitFor(() => expect(screen.getByText('Review submitted successfully.')).toBeTruthy())
  })

  it('shows close button after successful submission', async () => {
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    const onClose = vi.fn()
    render(<ReviewSubmitPanel {...defaultProps} onClose={onClose} />)
    const submitBtn = screen.getByRole('button', { name: 'Submit review' })
    fireEvent.click(submitBtn)
    await waitFor(() => screen.getByText('Close'))
    fireEvent.click(screen.getByText('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows error when submission fails', async () => {
    mockPrReviewSubmit.mockRejectedValue(new Error('API error'))
    render(<ReviewSubmitPanel {...defaultProps} />)
    const submitBtn = screen.getByRole('button', { name: 'Submit review' })
    fireEvent.click(submitBtn)
    await waitFor(() => screen.getByText(/API error/))
    expect(screen.getByText(/API error/)).toBeTruthy()
  })

  it('shows error when result contains error field', async () => {
    mockPrReviewSubmit.mockResolvedValue({ error: 'UNAUTHORIZED' })
    render(<ReviewSubmitPanel {...defaultProps} />)
    const submitBtn = screen.getByRole('button', { name: 'Submit review' })
    fireEvent.click(submitBtn)
    await waitFor(() => screen.getByText(/UNAUTHORIZED/))
    expect(screen.getByText(/UNAUTHORIZED/)).toBeTruthy()
  })

  it('calls prReviewSubmit with correct args', async () => {
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    render(<ReviewSubmitPanel {...defaultProps} />)
    const textarea = screen.getByPlaceholderText(/Leave a summary comment/)
    fireEvent.change(textarea, { target: { value: 'LGTM' } })
    const submitBtn = screen.getByRole('button', { name: 'Submit review' })
    fireEvent.click(submitBtn)
    await waitFor(() =>
      expect(mockPrReviewSubmit).toHaveBeenCalledWith({
        repoRoot: '/repo',
        prNumber: 42,
        commitId: 'abc123',
        event: 'COMMENT',
        body: 'LGTM',
      })
    )
  })
})
