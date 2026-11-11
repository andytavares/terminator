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
    state: 'open',
    ciStatus: 'passing',
    headRefName: 'feat',
    baseRefName: 'main',
    sessionStatus: 'not-started',
    approvalCount: 0,
    approvedBy: [],
    requestedReviewers: [],
    assigneeLogins: [],
    viewedFileCount: 0,
    mergeStateStatus: 'unknown',
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
}

function withQueue(prQueue: ReviewQueuePR[], extra: Record<string, unknown> = {}): void {
  vi.mocked(usePrReviewStore).mockReturnValue({
    ...baseStore,
    prQueue,
    ...extra,
  })
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
 * the eye lands on.
 */
describe('review queue rows never lead with approval', () => {
  it("offers reading, not approving, as the row's action", () => {
    withQueue([makePr({ number: 7, title: 'Some change' })])
    render(<ReviewQueue {...props} />)

    const row = screen.getByRole('group', { name: '#7 Some change' })
    expect(within(row).queryByText(/approve/i)).toBeNull()
    expect(within(row).getByRole('button', { name: 'Review' })).toBeTruthy()
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
    expect(screen.getByText('47', { selector: 'b' })).toBeTruthy()
  })
})
