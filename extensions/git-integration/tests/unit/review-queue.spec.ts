import { describe, it, expect } from 'vitest'
import { parseReviewQueuePR } from '../../../../src/main/github/pr-review-service'

const makeRawPr = (overrides: Record<string, unknown> = {}) => ({
  number:       1,
  title:        'feat: add login',
  author:       { login: 'alice', avatarUrl: 'https://example.com/avatar.png' },
  createdAt:    '2026-05-01T10:00:00Z',
  headRefName:  'feat/login',
  baseRefName:  'main',
  isDraft:      false,
  statusCheckRollup: [],
  files: [
    { path: 'src/auth.ts',    additions: 80,  deletions: 10, status: 'modified' },
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
    const pr = parseReviewQueuePR(makeRawPr({
      files: [{ path: 'x.ts', additions: 1, deletions: 0, status: 'added' }],
    }))
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
})
