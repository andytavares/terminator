import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ReviewQueue } from '../../src/components/pr-review/ReviewQueue'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import type { ReviewQueuePR } from '../../src/schemas/pr-review.schema'

vi.mock('../../src/stores/pr-review.store', () => ({ usePrReviewStore: vi.fn() }))

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

const baseStore = {
  prQueue: [],
  queueLoading: false,
  loadingMorePrs: false,
  queueError: null,
  rateLimitState: null,
  hasMorePrs: false,
  totalPrCount: null,
  currentUserLogin: null,
}

const props = {
  repoRoot: '/repo',
  onOpenPr: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
  onLoadMore: vi.fn().mockResolvedValue(undefined),
  onDismissPr: vi.fn().mockResolvedValue(undefined),
  includeClosedPrs: false,
  onToggleClosedPrs: vi.fn().mockResolvedValue(undefined),
}

function withQueue(prQueue: ReviewQueuePR[], extra: Record<string, unknown> = {}): void {
  vi.mocked(usePrReviewStore).mockReturnValue({
    ...baseStore,
    prQueue,
    ...extra,
  } as unknown as ReturnType<typeof usePrReviewStore>)
}

beforeEach(() => {
  vi.clearAllMocks()
  withQueue([])
})

// FR-036 (file status as a word, never a porcelain code) is asserted in
// StagingArea.spec.tsx against the real component and its store; a second copy
// here would test the same render twice.

/**
 * FR-034a. Approving is the one action in this extension that cannot be undone
 * from inside the app, and the queue row is the surface furthest from having
 * read the diff. Whatever else a row offers, "approve" must not be the thing
 * the eye lands on, and it must not look safer on a PR the tool happens to
 * have scored low-risk — the score is a heuristic and the mistake is permanent.
 */
describe('review queue rows never lead with approval', () => {
  const risks: ReviewQueuePR['riskLevel'][] = ['low', 'medium', 'high']

  for (const riskLevel of risks) {
    it(`offers reading, not approving, as the ${riskLevel}-risk row's action`, () => {
      withQueue([makePr({ number: 7, title: 'Some change', riskLevel })])
      render(<ReviewQueue {...props} />)

      const row = screen.getByRole('button', { name: /Some change/ })
      expect(within(row).queryByText(/approve/i)).toBeNull()
      expect(within(row).getByText('Review')).toBeTruthy()
    })
  }

  it('states risk in words that need no legend', () => {
    withQueue([makePr({ number: 8, title: 'Risky change', riskLevel: 'high' })])
    render(<ReviewQueue {...props} />)
    expect(screen.getByText('High risk')).toBeTruthy()
    expect(screen.queryByText('HIGH')).toBeNull()
  })

  it('drops the six-dot signal strip that never carried a visible label', () => {
    const { container } = render(
      <>
        {(() => {
          withQueue([makePr({ number: 9, title: 'Dotted' })])
          return <ReviewQueue {...props} />
        })()}
      </>
    )
    expect(container.querySelectorAll('.pr-signal-dot')).toHaveLength(0)
  })
})

/**
 * FR-032 / T078. The row count is the number of PRs fetched so far, which is
 * not the number waiting on you. Reporting the page size as the total is the
 * one number on this screen a reader would act on being wrong.
 */
describe('the queue summary reports the real total', () => {
  it('uses the repository total, not the loaded page length', () => {
    withQueue([makePr({ number: 1 }), makePr({ number: 2 })], {
      totalPrCount: 47,
      hasMorePrs: true,
    })
    render(<ReviewQueue {...props} />)
    expect(screen.getByText('47')).toBeTruthy()
  })

  it('has no manual pagination button', () => {
    withQueue([makePr({ number: 1 })], { totalPrCount: 40, hasMorePrs: true })
    render(<ReviewQueue {...props} />)
    expect(screen.queryByText(/load more/i)).toBeNull()
  })
})
