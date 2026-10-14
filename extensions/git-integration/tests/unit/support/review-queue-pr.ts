import type { ReviewQueuePR } from '../../../src/schemas/pr-review.schema'

const UNKNOWN_DOTS: ReviewQueuePR['signalDots'] = {
  tests: 'unknown',
  coverage: 'unknown',
  ci: 'unknown',
  lint: 'unknown',
  churn: 'unknown',
  blast: 'unknown',
}

/** A queue row as the review view holds it, which is what it saves as an active review. */
export function reviewQueuePr(number: number): ReviewQueuePR {
  return {
    number,
    title: `PR ${number}`,
    author: 'alice',
    authorAvatarUrl: '',
    openedAt: '2025-01-01T00:00:00Z',
    headRefName: 'feat',
    baseRefName: 'main',
    state: 'open',
    isDraft: false,
    ciStatus: 'none',
    fileCount: 1,
    additions: 5,
    deletions: 2,
    estimatedMinutes: 5,
    riskLevel: 'low',
    signalDots: UNKNOWN_DOTS,
    sessionStatus: 'in-progress',
    viewedFileCount: 0,
    approvalCount: 0,
    approvedBy: [],
    requestedReviewers: [],
    assigneeLogins: [],
    mergeStateStatus: 'unknown',
  }
}
