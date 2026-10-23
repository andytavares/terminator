import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import { ReviewSubmitPanel } from '../../src/components/pr-review/ReviewSubmitPanel'

const mockPrReviewSubmit = vi.fn()

vi.mock('../../src/api/github', () => ({
  githubAPI: {
    prReviewSubmit: (...args: unknown[]) => mockPrReviewSubmit(...args),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
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
})

describe('ReviewSubmitPanel — changes radio selection when clicking Approve', () => {
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

  it('renders Cancel and a submit button named for the chosen verdict', () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    expect(screen.getByText('Cancel')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit comment' })).toBeTruthy()
  })
})

describe('ReviewSubmitPanel — calls onClose when Cancel is clicked', () => {
  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(<ReviewSubmitPanel {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows success state after successful submission', async () => {
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    render(<ReviewSubmitPanel {...defaultProps} />)
    // Switch to APPROVE so no body is required
    fireEvent.click(screen.getByText('Approve').closest('label')!)
    const submitBtn = screen.getByRole('button', { name: 'Submit approval' })
    fireEvent.click(submitBtn)
    await screen.findByText('Review submitted successfully.')
  })

  it('hands back to the caller once an approval lands', async () => {
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    const onApproved = vi.fn()
    render(<ReviewSubmitPanel {...defaultProps} onApproved={onApproved} />)
    fireEvent.click(screen.getByText('Approve').closest('label')!)
    fireEvent.click(screen.getByRole('button', { name: 'Submit approval' }))
    await waitFor(() => expect(onApproved).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Review submitted successfully.')).toBeNull()
  })
})

describe('ReviewSubmitPanel — stays on the success screen after a comment review', () => {
  it('stays on the success screen after a comment review', async () => {
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    const onApproved = vi.fn()
    render(<ReviewSubmitPanel {...defaultProps} onApproved={onApproved} />)
    fireEvent.change(screen.getByPlaceholderText(/Leave a summary comment/), {
      target: { value: 'looks fine' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit comment' }))
    await screen.findByText('Review submitted successfully.')
    expect(onApproved).not.toHaveBeenCalled()
  })

  it('shows close button after successful submission', async () => {
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    const onClose = vi.fn()
    render(<ReviewSubmitPanel {...defaultProps} onClose={onClose} />)
    fireEvent.click(screen.getByText('Approve').closest('label')!)
    const submitBtn = screen.getByRole('button', { name: 'Submit approval' })
    fireEvent.click(submitBtn)
    fireEvent.click(await screen.findByText('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('ReviewSubmitPanel — shows error when submission fails', () => {
  it('shows error when submission fails', async () => {
    mockPrReviewSubmit.mockRejectedValue(new Error('API error'))
    render(<ReviewSubmitPanel {...defaultProps} />)
    fireEvent.click(screen.getByText('Approve').closest('label')!)
    const submitBtn = screen.getByRole('button', { name: 'Submit approval' })
    fireEvent.click(submitBtn)
    await screen.findByText(/API error/)
    expect(screen.getByText(/API error/)).toBeTruthy()
  })

  it('shows error when result contains error field', async () => {
    mockPrReviewSubmit.mockResolvedValue({ error: 'UNAUTHORIZED' })
    render(<ReviewSubmitPanel {...defaultProps} />)
    fireEvent.click(screen.getByText('Approve').closest('label')!)
    const submitBtn = screen.getByRole('button', { name: 'Submit approval' })
    fireEvent.click(submitBtn)
    await screen.findByText(/UNAUTHORIZED/)
    expect(screen.getByText(/UNAUTHORIZED/)).toBeTruthy()
  })
})

describe('ReviewSubmitPanel — shows validation error when submitting COMMENT with empty body', () => {
  it('shows validation error when submitting COMMENT with empty body', async () => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    // COMMENT is the default event
    const submitBtn = screen.getByRole('button', { name: 'Submit comment' })
    fireEvent.click(submitBtn)
    await screen.findByText(/A comment body is required/)
    expect(mockPrReviewSubmit).not.toHaveBeenCalled()
  })

  it('calls prReviewSubmit with correct args', async () => {
    mockPrReviewSubmit.mockResolvedValue({ success: true })
    render(<ReviewSubmitPanel {...defaultProps} />)
    const textarea = screen.getByPlaceholderText(/Leave a summary comment/)
    fireEvent.change(textarea, { target: { value: 'LGTM' } })
    const submitBtn = screen.getByRole('button', { name: 'Submit comment' })
    fireEvent.click(submitBtn)
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
  ])('names the submit button after the %s verdict', (verdict, buttonName) => {
    render(<ReviewSubmitPanel {...defaultProps} />)
    fireEvent.click(screen.getByLabelText(verdict))
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
