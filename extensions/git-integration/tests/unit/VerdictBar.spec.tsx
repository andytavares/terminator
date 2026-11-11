import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import { VerdictBar } from '../../src/components/pr-review/VerdictBar'

const mockPrReviewSubmit = vi.fn()
const mockRecordUsage = vi.fn()

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    prReviewSubmit: (...args: unknown[]) => mockPrReviewSubmit(...args),
    // Submitting clears the drafts, which saves the session.
    sessionSet: async () => ({}),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { electronAPI: { usage: { record: mockRecordUsage } } })
  usePrReviewStore.setState({ drafts: [] })
})

const defaultProps = { repoRoot: '/repo', prNumber: 42, headSHA: 'abc123' }

const draft = {
  id: 'd1',
  path: 'src/hardware.py',
  line: 62,
  startLine: null,
  side: 'RIGHT' as const,
  body: 'Good catch. I will reuse one timer.\nAnd reset its deadline.',
  fromFindingId: null,
}

const summaryBox = () => screen.getByRole('textbox', { name: 'Review summary' })

describe('VerdictBar — draft count and own PR', () => {
  it('shows how many draft comments are pending', () => {
    usePrReviewStore.setState({ drafts: [draft, { ...draft, id: 'd2' }, { ...draft, id: 'd3' }] })
    render(<VerdictBar {...defaultProps} />)
    expect(screen.getByText('3 draft comments')).toBeTruthy()
  })

  it('says one draft comment in the singular', () => {
    usePrReviewStore.setState({ drafts: [draft] })
    render(<VerdictBar {...defaultProps} />)
    expect(screen.getByText('1 draft comment')).toBeTruthy()
  })

  it('blocks Approve and Request changes on your own pull request, and leaves Comment', () => {
    render(<VerdictBar {...defaultProps} isOwnPr />)
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(true)
    const requestChanges = screen.getByRole('button', { name: 'Request changes' })
    expect(requestChanges.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Comment' }).hasAttribute('disabled')).toBe(false)
  })

  it('offers Approve on somebody else’s pull request', () => {
    render(<VerdictBar {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('VerdictBar — submitting a verdict', () => {
  it('sends a comment review with the summary', async () => {
    const user = userEvent.setup()
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    render(<VerdictBar {...defaultProps} />)
    await user.type(summaryBox(), 'LGTM')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    await screen.findByText('Review submitted.')
    expect(mockPrReviewSubmit).toHaveBeenCalledWith({
      repoRoot: '/repo',
      prNumber: 42,
      event: 'COMMENT',
      body: 'LGTM',
      comments: [],
    })
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith('review-comment')
  })
})

describe('VerdictBar — requesting changes', () => {
  it('sends each pending comment with a changes request', async () => {
    const user = userEvent.setup()
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    usePrReviewStore.setState({ drafts: [draft] })
    render(<VerdictBar {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: 'Request changes' }))
    await waitFor(() =>
      expect(mockPrReviewSubmit).toHaveBeenCalledWith({
        repoRoot: '/repo',
        prNumber: 42,
        event: 'REQUEST_CHANGES',
        body: '',
        comments: [
          { path: 'src/hardware.py', line: 62, startLine: null, side: 'RIGHT', body: draft.body },
        ],
      })
    )
    expect(usePrReviewStore.getState().drafts).toEqual([])
  })
})

describe('VerdictBar — approving', () => {
  it('hands back to the caller once an approval lands', async () => {
    const user = userEvent.setup()
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    const onApproved = vi.fn()
    render(<VerdictBar {...defaultProps} onApproved={onApproved} />)
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(onApproved).toHaveBeenCalledTimes(1))
    expect(mockPrReviewSubmit).toHaveBeenCalledWith(expect.objectContaining({ event: 'APPROVE' }))
  })
})

describe('VerdictBar — problems', () => {
  it('asks for a summary before a comment review with nothing in it', async () => {
    const user = userEvent.setup()
    render(<VerdictBar {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    await screen.findByText(/A comment body is required/)
    expect(mockPrReviewSubmit).not.toHaveBeenCalled()
  })

  it('shows the error GitHub returns, and records the failure', async () => {
    const user = userEvent.setup()
    mockPrReviewSubmit.mockResolvedValue({ error: 'UNAUTHORIZED' })
    render(<VerdictBar {...defaultProps} />)
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect((await screen.findByText('UNAUTHORIZED')).getAttribute('role')).toBe('alert')
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith('review-comment', { failed: true })
  })
})

describe('VerdictBar — Cmd+Enter in the summary', () => {
  it('submits a comment review when the summary has text', async () => {
    const user = userEvent.setup()
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    render(<VerdictBar {...defaultProps} />)
    await user.type(summaryBox(), 'Ship it')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    await waitFor(() =>
      expect(mockPrReviewSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'COMMENT', body: 'Ship it' })
      )
    )
  })

  it('does nothing when the summary is empty and there are no drafts', async () => {
    const user = userEvent.setup()
    render(<VerdictBar {...defaultProps} />)
    await user.click(summaryBox())
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(mockPrReviewSubmit).not.toHaveBeenCalled()
    expect(screen.queryByText(/A comment body is required/)).toBeNull()
  })
})
