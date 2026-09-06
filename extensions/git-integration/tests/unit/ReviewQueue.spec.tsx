import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReviewQueue } from '../../src/components/pr-review/ReviewQueue'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import type { ReviewQueuePR } from '../../src/schemas/pr-review.schema'

vi.mock('../../src/stores/pr-review.store', () => ({
  usePrReviewStore: vi.fn(),
}))

function makePr(overrides: Partial<ReviewQueuePR> = {}): ReviewQueuePR {
  return {
    number: 1,
    title: 'Fix bug',
    author: 'alice',
    authorAvatarUrl: '',
    openedAt: new Date().toISOString(),
    fileCount: 3,
    additions: 20,
    deletions: 5,
    isDraft: false,
    riskLevel: 'low',
    estimatedMinutes: 10,
    sessionStatus: 'not-started',
    signalDots: {
      tests: 'pass',
      coverage: 'pass',
      ci: 'pass',
      lint: 'pass',
      churn: 'pass',
      blast: 'pass',
    },
    approvalCount: 0,
    approvedBy: [],
    requestedReviewers: [],
    assigneeLogins: [],
    ...overrides,
  }
}

const defaultStoreState = {
  prQueue: [],
  queueLoading: false,
  loadingMorePrs: false,
  queueError: null,
  rateLimitState: null,
  hasMorePrs: false,
  totalPrCount: null,
  currentUserLogin: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(usePrReviewStore).mockReturnValue(
    defaultStoreState as unknown as ReturnType<typeof usePrReviewStore>
  )
})

const defaultProps = {
  repoRoot: '/repo',
  onOpenPr: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onDismissPr: vi.fn().mockResolvedValue(undefined),
  includeClosedPrs: false,
  onToggleClosedPrs: vi.fn().mockResolvedValue(undefined),
}

describe('ReviewQueue', () => {
  it('shows loading state when queueLoading is true', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      queueLoading: true,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Loading pull requests…')).toBeTruthy()
  })

  it('shows empty state when queue is empty', () => {
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('No open pull requests.')).toBeTruthy()
  })

  it('summarises the queue in one line instead of four tiles', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [makePr({ number: 1, riskLevel: 'high' })],
      totalPrCount: 1,
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText(/waiting on you/)).toBeTruthy()
    expect(screen.getByText(/of reading/)).toBeTruthy()
    // Two of the old tile labels told the reader what to do rather than naming
    // a metric; the grouping below already does that.
    expect(screen.queryByText('High risk — read these first')).toBeNull()
  })

  it('renders PR rows when queue has PRs', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [makePr({ number: 42, title: 'Add feature' })],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Add feature')).toBeTruthy()
    expect(screen.getByText('#42')).toBeTruthy()
  })

  it('calls onOpenPr when PR row is clicked', () => {
    const pr = makePr({ number: 7, title: 'My PR' })
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [pr],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    const onOpenPr = vi.fn()
    render(<ReviewQueue {...defaultProps} onOpenPr={onOpenPr} />)
    fireEvent.click(screen.getByText('My PR'))
    expect(onOpenPr).toHaveBeenCalledWith(pr)
  })

  it('shows refresh button', () => {
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'Refresh pull requests' })).toBeTruthy()
  })

  it('calls onRefresh when refresh button is clicked', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    render(<ReviewQueue {...defaultProps} onRefresh={onRefresh} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh pull requests' }))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('shows search input', () => {
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByRole('searchbox')).toBeTruthy()
  })

  it('keeps only the filter the section headings cannot express', () => {
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Open more than 3 days')).toBeTruthy()
    // "High risk", "Quick wins" and "In progress" were each a heading in the
    // list below, so the pill only hid the rest of the page to reach them.
    expect(screen.queryByText('Quick wins')).toBeNull()
  })

  it('hides filter pills when searching', () => {
    render(<ReviewQueue {...defaultProps} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'feature' } })
    expect(screen.queryByText('Open more than 3 days')).toBeNull()
  })

  it('shows "Open only" button by default', () => {
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Open only')).toBeTruthy()
  })

  it('shows "Open + Closed" when includeClosedPrs is true', () => {
    render(<ReviewQueue {...defaultProps} includeClosedPrs={true} />)
    expect(screen.getByText('Open + Closed')).toBeTruthy()
  })

  it('calls onToggleClosedPrs when toggle button is clicked', () => {
    const onToggleClosedPrs = vi.fn().mockResolvedValue(undefined)
    render(<ReviewQueue {...defaultProps} onToggleClosedPrs={onToggleClosedPrs} />)
    fireEvent.click(screen.getByText('Open only'))
    expect(onToggleClosedPrs).toHaveBeenCalledWith(true)
  })

  it('shows error state when queueError is set', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      queueError: 'Network failure',
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText(/Failed to load queue: Network failure/)).toBeTruthy()
  })

  it('shows rate limit banner when rateLimitState is set', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      rateLimitState: { resetAt: Date.now() + 60000 },
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText(/GitHub API rate limit reached/)).toBeTruthy()
  })

  it('says a page is on its way rather than asking for a click', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      hasMorePrs: true,
      loadingMorePrs: true,
      prQueue: [makePr()],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Loading the rest…')).toBeTruthy()
    expect(screen.queryByText('Load more pull requests')).toBeNull()
  })

  it('renders the risk in words for high-risk PRs', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [makePr({ riskLevel: 'high', number: 10, title: 'Risky PR' })],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('High risk')).toBeTruthy()
    expect(screen.getByText('Read these first')).toBeTruthy()
  })

  it('shows Draft label for draft PRs', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [makePr({ isDraft: true, number: 11, title: 'Draft PR' })],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('shows Resume action for paused PRs', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [
        makePr({
          sessionStatus: 'paused',
          resumeChapter: 2,
          resumeChapterTotal: 3,
          number: 12,
          title: 'Paused PR',
        }),
      ],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getAllByText('Resume').length).toBeGreaterThan(0)
  })

  it('applies active filter pill when clicked', () => {
    render(<ReviewQueue {...defaultProps} />)
    const staleBtn = screen.getByText('Open more than 3 days')
    fireEvent.click(staleBtn)
    expect(staleBtn.className).toContain('pr-filter-pill--active')
    // Pressing it again returns to the whole queue, so there is no state the
    // control cannot leave.
    fireEvent.click(staleBtn)
    expect(staleBtn.className).not.toContain('pr-filter-pill--active')
  })

  it('shows approval chip when PR has approvals', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [
        makePr({
          number: 99,
          title: 'Approved PR',
          approvalCount: 2,
          approvedBy: ['bob', 'carol'],
        }),
      ],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText(/2 approved/)).toBeTruthy()
  })

  it('does not show approval chip when PR has no approvals', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [
        makePr({ number: 100, title: 'No approvals PR', approvalCount: 0, approvedBy: [] }),
      ],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.queryByText(/approved/)).toBeNull()
  })

  it('shows Needs your review section when current user is a requested reviewer', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      currentUserLogin: 'me',
      prQueue: [makePr({ number: 55, title: 'Review me', requestedReviewers: ['me', 'other'] })],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Needs your review')).toBeTruthy()
    expect(screen.getByText('Review me')).toBeTruthy()
  })

  it('shows Needs your review section when current user is an assignee', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      currentUserLogin: 'me',
      prQueue: [makePr({ number: 58, title: 'Assigned to me', assigneeLogins: ['me'] })],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Needs your review')).toBeTruthy()
    expect(screen.getByText('Assigned to me')).toBeTruthy()
  })

  it('does not show Needs your review section when current user is not a requested reviewer', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      currentUserLogin: 'me',
      prQueue: [makePr({ number: 56, title: 'Not for me', requestedReviewers: ['other'] })],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.queryByText('Needs your review')).toBeNull()
  })

  it('does not show Needs your review section when currentUserLogin is null', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      currentUserLogin: null,
      prQueue: [makePr({ number: 57, title: 'No user', requestedReviewers: ['anyone'] })],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.queryByText('Needs your review')).toBeNull()
  })
})
