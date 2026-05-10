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
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(usePrReviewStore).mockReturnValue(defaultStoreState as any)
})

const defaultProps = {
  repoRoot: '/repo',
  onOpenPr: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onLoadMore: vi.fn().mockResolvedValue(undefined),
  includeClosedPrs: false,
  onToggleClosedPrs: vi.fn().mockResolvedValue(undefined),
}

describe('ReviewQueue', () => {
  it('shows loading state when queueLoading is true', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      queueLoading: true,
    } as any)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Loading pull requests…')).toBeTruthy()
  })

  it('shows empty state when queue is empty', () => {
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('No open pull requests.')).toBeTruthy()
  })

  it('shows stat cards', () => {
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Awaiting review')).toBeTruthy()
    expect(screen.getByText('High risk — read these first')).toBeTruthy()
    expect(screen.getByText('Total review time')).toBeTruthy()
  })

  it('renders PR rows when queue has PRs', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [makePr({ number: 42, title: 'Add feature' })],
    } as any)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Add feature')).toBeTruthy()
    expect(screen.getByText('#42')).toBeTruthy()
  })

  it('calls onOpenPr when PR row is clicked', () => {
    const pr = makePr({ number: 7, title: 'My PR' })
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [pr],
    } as any)
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

  it('shows filter pills when not searching', () => {
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('All')).toBeTruthy()
    expect(screen.getByText('High risk')).toBeTruthy()
    expect(screen.getByText('Quick wins')).toBeTruthy()
  })

  it('hides filter pills when searching', () => {
    render(<ReviewQueue {...defaultProps} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'feature' } })
    expect(screen.queryByText('All')).toBeNull()
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
    } as any)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText(/Failed to load queue: Network failure/)).toBeTruthy()
  })

  it('shows rate limit banner when rateLimitState is set', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      rateLimitState: { resetAt: Date.now() + 60000 },
    } as any)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText(/GitHub API rate limit reached/)).toBeTruthy()
  })

  it('shows load more button when hasMorePrs is true', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      hasMorePrs: true,
      prQueue: [makePr()],
    } as any)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('Load more pull requests')).toBeTruthy()
  })

  it('renders HIGH label for high-risk PRs', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [makePr({ riskLevel: 'high', number: 10, title: 'Risky PR' })],
    } as any)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getByText('HIGH')).toBeTruthy()
    expect(screen.getByText('Read these first')).toBeTruthy()
  })

  it('shows Draft label for draft PRs', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [makePr({ isDraft: true, number: 11, title: 'Draft PR' })],
    } as any)
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
    } as any)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.getAllByText('Resume Ch 2/3').length).toBeGreaterThan(0)
  })

  it('applies active filter pill when clicked', () => {
    render(<ReviewQueue {...defaultProps} />)
    fireEvent.click(screen.getByText('High risk'))
    const highRiskBtn = screen.getByText('High risk')
    expect(highRiskBtn.className).toContain('pr-filter-pill--active')
  })
})
