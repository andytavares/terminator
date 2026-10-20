import type { DashboardPR } from '../../../src/schemas/pr-review.schema'

/** A dashboard row for acme/widgets with a local checkout; override what the case is about. */
export function dashboardPrFixture(overrides: Partial<DashboardPR> = {}): DashboardPR {
  return {
    repo: 'acme/widgets',
    localRepoRoot: '/work/widgets',
    headRefName: 'feat/login',
    section: 'mine',
    number: 275,
    title: 'Add login redirect',
    url: 'https://github.com/acme/widgets/pull/275',
    author: 'andrew',
    isDraft: false,
    reviewedByMe: false,
    createdAt: '2026-10-15T09:00:00Z',
    updatedAt: '2026-10-16T09:00:00Z',
    additions: 120,
    deletions: 30,
    fileCount: 6,
    riskLevel: 'medium',
    estimatedMinutes: 3,
    ciStatus: 'passing',
    reviewDecision: 'review-required',
    unresolvedThreads: 0,
    commitsSinceMyReview: 0,
    reviewerCount: 1,
    sessionStatus: 'not-started',
    viewedFileCount: 0,
    ...overrides,
  }
}
