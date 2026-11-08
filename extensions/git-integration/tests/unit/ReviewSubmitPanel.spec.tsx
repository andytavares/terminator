import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import { ReviewSubmitPanel } from '../../src/components/pr-review/ReviewSubmitPanel'

const mockPrReviewSubmit = vi.fn()
const mockRecordUsage = vi.fn()

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    prReviewSubmit: (...args: unknown[]) => mockPrReviewSubmit(...args),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { electronAPI: { usage: { record: mockRecordUsage } } })
  usePrReviewStore.setState({ drafts: [] })
})

const defaultProps = {
  repoRoot: '/repo',
  prNumber: 42,
  headSHA: 'abc123',
  onClose: vi.fn(),
}

describe('ReviewSubmitPanel', () => {
  it('renders submit review heading', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Submit review')
  })

  it('defaults to Comment radio option', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    const radios = screen.getAllByRole('radio')
    const commentRadio = radios.find((r) => r.getAttribute('value') === 'COMMENT')
    expect((commentRadio as HTMLInputElement).checked).toBe(true)
  })
})

describe('ReviewSubmitPanel — changes radio selection when clicking Approve', () => {
  it('changes radio selection when clicking Approve', async () => {
    const user = userEvent.setup()
    render(<ReviewSubmitPanel {...defaultProps} />)
    await user.click(screen.getByLabelText('Approve'))
    expect(screen.getByRole('radio', { name: 'Approve' })).toHaveProperty('checked', true)
  })

  it('renders a textarea for review body', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    expect(screen.getByPlaceholderText(/Leave a summary comment/)).toBeTruthy()
  })

  it('renders Cancel and a submit button named for the chosen verdict', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    expect(screen.getByText('Cancel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit comment' })).toBeTruthy()
  })
})

describe('ReviewSubmitPanel — calls onClose when Cancel is clicked', () => {
  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ReviewSubmitPanel {...defaultProps} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows success state after successful submission', async () => {
    const user = userEvent.setup()
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    render(<ReviewSubmitPanel {...defaultProps} />)
    // Switch to APPROVE so no body is required
    await user.click(screen.getByLabelText('Approve'))
    await user.click(screen.getByRole('button', { name: 'Submit approval' }))
    await screen.findByText('Review submitted successfully.')
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith('review-comment')
  })

  it('hands back to the caller once an approval lands', async () => {
    const user = userEvent.setup()
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    const onApproved = vi.fn()
    render(<ReviewSubmitPanel {...defaultProps} onApproved={onApproved} />)
    await user.click(screen.getByLabelText('Approve'))
    await user.click(screen.getByRole('button', { name: 'Submit approval' }))
    await waitFor(() => expect(onApproved).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Review submitted successfully.')).toBeNull()
  })
})

describe('ReviewSubmitPanel — stays on the success screen after a comment review', () => {
  it('stays on the success screen after a comment review', async () => {
    const user = userEvent.setup()
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    const onApproved = vi.fn()
    render(<ReviewSubmitPanel {...defaultProps} onApproved={onApproved} />)
    await user.type(screen.getByPlaceholderText(/Leave a summary comment/), 'looks fine')
    await user.click(screen.getByRole('button', { name: 'Submit comment' }))
    await screen.findByText('Review submitted successfully.')
    expect(onApproved).not.toHaveBeenCalled()
  })

  it('shows close button after successful submission', async () => {
    const user = userEvent.setup()
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    const onClose = vi.fn()
    render(<ReviewSubmitPanel {...defaultProps} onClose={onClose} />)
    await user.click(screen.getByLabelText('Approve'))
    await user.click(screen.getByRole('button', { name: 'Submit approval' }))
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('ReviewSubmitPanel — shows error when submission fails', () => {
  it('shows error when submission fails', async () => {
    const user = userEvent.setup()
    mockPrReviewSubmit.mockRejectedValue(new Error('API error'))
    render(<ReviewSubmitPanel {...defaultProps} />)
    await user.click(screen.getByLabelText('Approve'))
    await user.click(screen.getByRole('button', { name: 'Submit approval' }))
    expect((await screen.findByText(/API error/)).className).toBe('rs-error')
  })

  it('shows error when result contains error field', async () => {
    const user = userEvent.setup()
    mockPrReviewSubmit.mockResolvedValue({ error: 'UNAUTHORIZED' })
    render(<ReviewSubmitPanel {...defaultProps} />)
    await user.click(screen.getByLabelText('Approve'))
    await user.click(screen.getByRole('button', { name: 'Submit approval' }))
    await screen.findByText(/UNAUTHORIZED/)
    expect(mockRecordUsage).toHaveBeenCalledExactlyOnceWith('review-comment', { failed: true })
    expect(screen.getByText(/UNAUTHORIZED/)).toBeTruthy()
  })
})

describe('ReviewSubmitPanel — shows validation error when submitting COMMENT with empty body', () => {
  it('shows validation error when submitting COMMENT with empty body', async () => {
    const user = userEvent.setup()
    render(<ReviewSubmitPanel {...defaultProps} />)
    // COMMENT is the default event
    await user.click(screen.getByRole('button', { name: 'Submit comment' }))
    await screen.findByText(/A comment body is required/)
    expect(mockPrReviewSubmit).not.toHaveBeenCalled()
  })

  it('calls prReviewSubmit with correct args', async () => {
    const user = userEvent.setup()
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    render(<ReviewSubmitPanel {...defaultProps} />)
    await user.type(screen.getByPlaceholderText(/Leave a summary comment/), 'LGTM')
    await user.click(screen.getByRole('button', { name: 'Submit comment' }))
    await waitFor(() =>
      expect(mockPrReviewSubmit).toHaveBeenCalledWith({
        repoRoot: '/repo',
        prNumber: 42,
        event: 'COMMENT',
        body: 'LGTM',
        comments: [],
      })
    )
  })
})

const draft = {
  id: 'd1',
  path: 'src/hardware.py',
  line: 62,
  startLine: null,
  side: 'RIGHT' as const,
  body: 'Good catch. I will reuse one timer.\nAnd reset its deadline.',
  fromFindingId: null,
}

describe('ReviewSubmitPanel — pending drafts', () => {
  it('lists each draft as path:line with the first line of its body', () => {
    usePrReviewStore.setState({ drafts: [draft] })
    render(<ReviewSubmitPanel {...defaultProps} />)
    expect(screen.getByText('Pending · 1')).toBeTruthy()
    expect(screen.getByText('src/hardware.py:62')).toBeTruthy()
    expect(screen.getByText('Good catch. I will reuse one timer.')).toBeTruthy()
    expect(screen.queryByText(/And reset its deadline/)).toBeNull()
  })

  it('shows no pending list without drafts', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    expect(screen.queryByText(/^Pending/)).toBeNull()
  })
})

describe('ReviewSubmitPanel — verdict cards', () => {
  it('offers three verdicts, each with a one-line description', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    expect(screen.getByLabelText('Comment')).toBeTruthy()
    expect(screen.getByLabelText('Approve')).toBeTruthy()
    expect(screen.getByLabelText('Request changes')).toBeTruthy()
    expect(screen.getByText('Ready to merge')).toBeTruthy()
    expect(screen.getByText('Blocks merge')).toBeTruthy()
  })

  it.each([
    ['Comment', 'Submit comment'],
    ['Approve', 'Submit approval'],
    ['Request changes', 'Submit changes request'],
  ])('names the submit button after the %s verdict', async (verdict, buttonName) => {
    const user = userEvent.setup()
    render(<ReviewSubmitPanel {...defaultProps} />)
    await user.click(screen.getByLabelText(verdict))
    expect(screen.getByRole('button', { name: buttonName })).toBeTruthy()
  })
})

describe('ReviewSubmitPanel — unviewed files', () => {
  it('warns, without blocking, when files are still unviewed', () => {
    render(<ReviewSubmitPanel {...defaultProps} viewedCount={4} totalFiles={23} />)
    expect(screen.getByText('You have viewed 4 of 23 files')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit comment' }).hasAttribute('disabled')).toBe(
      false
    )
  })

  it('stays quiet once every file is viewed', () => {
    render(<ReviewSubmitPanel {...defaultProps} viewedCount={23} totalFiles={23} />)
    expect(screen.queryByText(/You have viewed/)).toBeNull()
  })
})
