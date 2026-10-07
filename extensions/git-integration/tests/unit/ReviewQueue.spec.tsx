import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReviewQueue } from '../../src/components/pr-review/ReviewQueue'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import { useReviewUiStore } from '../../src/stores/review-ui.store'
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
    state: 'open',
    ciStatus: 'passing',
    headRefName: 'feat',
    baseRefName: 'main',
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
  useReviewUiStore.setState({ queueSort: 'newest' })
  vi.mocked(usePrReviewStore).mockReturnValue(
    defaultStoreState as unknown as ReturnType<typeof usePrReviewStore>
  )
})

const defaultProps = {
  repoRoot: '/repo',
  onOpenPr: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onDismissPr: vi.fn().mockResolvedValue(undefined),
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
  })

  it('says nothing about medium or low risk', () => {
    vi.mocked(usePrReviewStore).mockReturnValue({
      ...defaultStoreState,
      prQueue: [
        makePr({ riskLevel: 'medium', number: 1, title: 'Medium PR' }),
        makePr({ riskLevel: 'low', number: 2, title: 'Low PR' }),
      ],
    } as unknown as ReturnType<typeof usePrReviewStore>)
    render(<ReviewQueue {...defaultProps} />)
    expect(screen.queryByText(/risk/i)).toBeNull()
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

  describe('one list, two lines per row', () => {
    function renderMany(prs: ReviewQueuePR[], extra: Record<string, unknown> = {}) {
      vi.mocked(usePrReviewStore).mockReturnValue({
        ...defaultStoreState,
        prQueue: prs,
        ...extra,
      } as unknown as ReturnType<typeof usePrReviewStore>)
      return render(<ReviewQueue {...defaultProps} />)
    }
    const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
    const titles = (container: HTMLElement) =>
      [...container.querySelectorAll('.rd-ti')].map((t) => t.textContent ?? '')

    it('has no open/closed toggle', () => {
      renderMany([])
      expect(screen.queryByRole('button', { name: /open only|open \+ closed/i })).toBeNull()
      expect(screen.queryByText('Open only')).toBeNull()
    })

    it('tells the search how to find merged pull requests', () => {
      renderMany([])
      expect(screen.getByPlaceholderText('Search open PRs · is:merged for merged')).toBeTruthy()
    })

    it('shows Merged first on the second line of a merged row', () => {
      const { container } = renderMany([makePr({ state: 'merged', title: 'Shipped' })])
      expect(container.querySelector('.rd-ti small')!.textContent!.startsWith('Merged')).toBe(true)
    })

    it('shows Closed first on the second line of a closed row', () => {
      const { container } = renderMany([makePr({ state: 'closed', title: 'Dropped' })])
      expect(container.querySelector('.rd-ti small')!.textContent!.startsWith('Closed')).toBe(true)
    })

    it('has one heading with the total, and none of the old groups', () => {
      renderMany([makePr({ number: 1 }), makePr({ number: 2, riskLevel: 'high' })], {
        totalPrCount: 47,
      })
      const headings = screen.getAllByRole('heading', { level: 3 })
      expect(headings).toHaveLength(1)
      expect(headings[0].textContent).toContain('Open pull requests')
      expect(headings[0].textContent).toContain('47')
      for (const old of [
        'In progress',
        'Needs your review',
        'Read these first',
        'Quick wins',
        'Larger reviews',
      ]) {
        expect(screen.queryByText(old)).toBeNull()
      }
      expect(screen.queryByText(/Open more than/)).toBeNull()
    })

    it('sorts newest first by default', () => {
      const { container } = renderMany([
        makePr({ number: 1, title: 'Older', openedAt: days(9) }),
        makePr({ number: 2, title: 'Newer', openedAt: days(1) }),
      ])
      expect(titles(container)[0]).toContain('Newer')
      expect((screen.getByRole('combobox', { name: 'Sort' }) as HTMLSelectElement).value).toBe(
        'newest'
      )
    })

    it('offers the three sorts by name', () => {
      renderMany([])
      const select = screen.getByRole('combobox', { name: 'Sort' })
      expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
        'Newest first',
        'Closest to merging',
        'Started by you',
      ])
    })

    it('puts approved, passing pull requests first under Closest to merging', () => {
      const { container } = renderMany([
        makePr({ number: 1, title: 'Waiting', openedAt: days(9) }),
        makePr({
          number: 2,
          title: 'Ready',
          openedAt: days(1),
          approvalCount: 1,
          approvedBy: ['bo'],
        }),
      ])
      fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
        target: { value: 'closest' },
      })
      expect(titles(container)[0]).toContain('Ready')
      expect(useReviewUiStore.getState().queueSort).toBe('closest')
    })

    it('puts a paused pull request first under Started by you', () => {
      const { container } = renderMany([
        makePr({ number: 1, title: 'Untouched', openedAt: days(9) }),
        makePr({ number: 2, title: 'Paused one', openedAt: days(1), sessionStatus: 'paused' }),
      ])
      fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), {
        target: { value: 'started' },
      })
      expect(titles(container)[0]).toContain('Paused one')
    })

    it('lays the second line out as attention states only', () => {
      const { container } = renderMany(
        [
          makePr({
            number: 212,
            title: 'ci: split shards',
            openedAt: days(139),
            isDraft: true,
            mergeStateStatus: 'dirty',
            approvalCount: 2,
            approvedBy: ['a', 'b'],
            riskLevel: 'high',
            ciStatus: 'failing',
            requestedReviewers: ['me'],
            sessionStatus: 'in-progress',
            viewedFileCount: 1,
            fileCount: 3,
          }),
        ],
        { currentUserLogin: 'me' }
      )
      expect(container.querySelector('.rd-ti small')!.textContent).toBe(
        'Draft · Conflicts · alice · 139d · 2 approved · High risk · CI failing · Your review requested · 1 of 3 viewed'
      )
    })

    it('leaves a quiet row with only the author and age', () => {
      const { container } = renderMany([makePr({ openedAt: days(2) })])
      expect(container.querySelector('.rd-ti small')!.textContent).toBe('alice · 2d')
    })

    it('shows the size and the reading time in the right column, with no risk chip', () => {
      const { container } = renderMany([
        makePr({ additions: 1234, deletions: 3, fileCount: 1, estimatedMinutes: 7 }),
      ])
      const row = container.querySelector('.rd-row')!
      expect(row.querySelector('.rd-size')!.textContent).toBe('+1,234 −3 · 1 file')
      expect(row.querySelector('.rd-num:not(.rd-size)')!.textContent).toBe('~7 min')
      expect(row.querySelector('.rd-chip')).toBeNull()
    })

    it('opens a row on Enter', () => {
      const pr = makePr({ title: 'Keyboard' })
      const onOpenPr = vi.fn()
      vi.mocked(usePrReviewStore).mockReturnValue({
        ...defaultStoreState,
        prQueue: [pr],
      } as unknown as ReturnType<typeof usePrReviewStore>)
      const { container } = render(<ReviewQueue {...defaultProps} onOpenPr={onOpenPr} />)
      fireEvent.keyDown(container.querySelector('.rd-row')!, { key: 'Enter' })
      expect(onOpenPr).toHaveBeenCalledWith(pr)
    })

    it('colours additions green and removals red', () => {
      renderMany([makePr({ additions: 1234, deletions: 3 })])
      expect(screen.getByText('+1,234').className).toBe('rd-add')
      expect(screen.getByText('−3').className).toBe('rd-del')
    })

    it('names conflicts in the second line as text, with no icon', () => {
      const { container } = renderMany([makePr({ mergeStateStatus: 'dirty' })])
      expect(screen.getByText('Conflicts').closest('small')).toBeTruthy()
      expect(container.querySelector('.rd-row svg')).toBeNull()
    })
  })
})
