import { describe, it, expect } from 'vitest'
import { parseReviewQueuePR } from '../../src/github/pr-review-service'

const makeRawPr = (overrides: Record<string, unknown> = {}) => ({
  number: 1,
  title: 'feat: add login',
  author: { login: 'alice', avatarUrl: 'https://example.com/avatar.png' },
  createdAt: '2026-05-01T10:00:00Z',
  headRefName: 'feat/login',
  baseRefName: 'main',
  isDraft: false,
  statusCheckRollup: [],
  files: [
    { path: 'src/auth.ts', additions: 80, deletions: 10, status: 'modified' },
    { path: 'src/auth.spec.ts', additions: 40, deletions: 5, status: 'modified' },
  ],
  ...overrides,
})

describe('parseReviewQueuePR()', () => {
  it('maps gh pr list JSON to ReviewQueuePR shape', () => {
    const pr = parseReviewQueuePR(makeRawPr())
    expect(pr.number).toBe(1)
    expect(pr.title).toBe('feat: add login')
    expect(pr.author).toBe('alice')
    expect(pr.authorAvatarUrl).toBe('https://example.com/avatar.png')
    expect(pr.headRefName).toBe('feat/login')
    expect(pr.isDraft).toBe(false)
  })

  it('derives fileCount from files array', () => {
    const pr = parseReviewQueuePR(makeRawPr())
    expect(pr.fileCount).toBe(2)
  })

  it('sums additions and deletions across all files', () => {
    const pr = parseReviewQueuePR(makeRawPr())
    expect(pr.additions).toBe(120)
    expect(pr.deletions).toBe(15)
  })

  it('derives estimatedMinutes as ceil((additions+deletions)/60)', () => {
    const pr = parseReviewQueuePR(makeRawPr())
    // (120 + 15) / 60 = 2.25 → ceil = 3
    expect(pr.estimatedMinutes).toBe(3)
  })

  it('sets estimatedMinutes to at least 1 for tiny PRs', () => {
    const pr = parseReviewQueuePR(
      makeRawPr({
        files: [{ path: 'x.ts', additions: 1, deletions: 0, status: 'added' }],
      })
    )
    expect(pr.estimatedMinutes).toBeGreaterThanOrEqual(1)
  })

  it('defaults sessionStatus to not-started', () => {
    const pr = parseReviewQueuePR(makeRawPr())
    expect(pr.sessionStatus).toBe('not-started')
  })

  it('handles empty files array gracefully', () => {
    const pr = parseReviewQueuePR(makeRawPr({ files: [] }))
    expect(pr.fileCount).toBe(0)
    expect(pr.additions).toBe(0)
    expect(pr.deletions).toBe(0)
    expect(pr.estimatedMinutes).toBeGreaterThanOrEqual(1)
  })

  it('defaults approvalCount to 0 when no reviews present', () => {
    const pr = parseReviewQueuePR(makeRawPr())
    expect(pr.approvalCount).toBe(0)
    expect(pr.approvedBy).toEqual([])
  })

  it('extracts approvals from REST reviews field', () => {
    const pr = parseReviewQueuePR(
      makeRawPr({
        reviews: [
          { author: { login: 'bob' }, state: 'APPROVED', submittedAt: '2026-05-01T10:00:00Z' },
          {
            author: { login: 'carol' },
            state: 'CHANGES_REQUESTED',
            submittedAt: '2026-05-01T11:00:00Z',
          },
        ],
      })
    )
    expect(pr.approvalCount).toBe(1)
    expect(pr.approvedBy).toEqual(['bob'])
  })

  it('extracts approvals from GraphQL latestReviews field', () => {
    const pr = parseReviewQueuePR(
      makeRawPr({
        latestReviews: {
          nodes: [
            {
              author: { login: 'alice', avatarUrl: '' },
              state: 'APPROVED',
              submittedAt: '2026-05-01T10:00:00Z',
            },
            {
              author: { login: 'dave', avatarUrl: '' },
              state: 'APPROVED',
              submittedAt: '2026-05-01T11:00:00Z',
            },
          ],
        },
      })
    )
    expect(pr.approvalCount).toBe(2)
    expect(pr.approvedBy).toContain('alice')
    expect(pr.approvedBy).toContain('dave')
  })

  it('deduplicates approvals from the same author', () => {
    const pr = parseReviewQueuePR(
      makeRawPr({
        reviews: [
          { author: { login: 'bob' }, state: 'APPROVED', submittedAt: '2026-05-01T10:00:00Z' },
          { author: { login: 'bob' }, state: 'APPROVED', submittedAt: '2026-05-01T12:00:00Z' },
        ],
      })
    )
    expect(pr.approvalCount).toBe(1)
    expect(pr.approvedBy).toEqual(['bob'])
  })

  it('defaults requestedReviewers to empty array when not present', () => {
    const pr = parseReviewQueuePR(makeRawPr())
    expect(pr.requestedReviewers).toEqual([])
  })

  it('uses pre-flattened requestedReviewers array from normalizeGraphQLNode', () => {
    const pr = parseReviewQueuePR(makeRawPr({ requestedReviewers: ['alice', 'bob'] }))
    expect(pr.requestedReviewers).toEqual(['alice', 'bob'])
  })
})
