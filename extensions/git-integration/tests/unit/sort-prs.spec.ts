import { describe, it, expect } from 'vitest'
import {
  mergeReadiness,
  sortPrs,
  dashboardToSortable,
  type SortablePr,
} from '../../src/review/sort-prs'

function pr(id: number, overrides: Partial<SortablePr> = {}): SortablePr & { id: number } {
  return {
    id,
    openedAt: `2026-01-0${id}T00:00:00Z`,
    isDraft: false,
    ciStatus: 'passing',
    fileCount: 10,
    ...overrides,
  }
}
const ids = (prs: Array<{ id: number }>) => prs.map((p) => p.id)

describe('mergeReadiness', () => {
  it('ranks approved with passing CI and no conflict as 0', () => {
    expect(mergeReadiness(pr(1, { reviewDecision: 'approved', mergeStateStatus: 'clean' }))).toBe(0)
  })
  it('treats no CI as passing', () => {
    expect(mergeReadiness(pr(1, { reviewDecision: 'approved', ciStatus: 'none' }))).toBe(0)
  })
  it('counts an approvalCount as approved', () => {
    expect(mergeReadiness(pr(1, { approvalCount: 1 }))).toBe(0)
  })
  it('ranks approved with failing or pending CI, or a conflict, as 1', () => {
    expect(mergeReadiness(pr(1, { reviewDecision: 'approved', ciStatus: 'failing' }))).toBe(1)
    expect(mergeReadiness(pr(1, { reviewDecision: 'approved', ciStatus: 'pending' }))).toBe(1)
    expect(mergeReadiness(pr(1, { approvalCount: 2, mergeStateStatus: 'dirty' }))).toBe(1)
  })
  it('ranks review-required and none as 2', () => {
    expect(mergeReadiness(pr(1, { reviewDecision: 'review-required' }))).toBe(2)
    expect(mergeReadiness(pr(1, { reviewDecision: 'none' }))).toBe(2)
    expect(mergeReadiness(pr(1))).toBe(2)
  })
  it('ranks changes requested as 3, even with an approval', () => {
    expect(mergeReadiness(pr(1, { reviewDecision: 'changes-requested', approvalCount: 1 }))).toBe(3)
  })
  it('ranks a draft as 4 whatever else is true', () => {
    expect(mergeReadiness(pr(1, { isDraft: true, reviewDecision: 'approved' }))).toBe(4)
  })
})

describe('sortPrs', () => {
  it('newest puts the latest opened first', () => {
    expect(ids(sortPrs([pr(1), pr(3), pr(2)], 'newest'))).toEqual([3, 2, 1])
  })

  it('closest orders by readiness, then newest', () => {
    const list = [
      pr(1, { isDraft: true }),
      pr(2, { reviewDecision: 'changes-requested' }),
      pr(3),
      pr(4, { reviewDecision: 'approved', ciStatus: 'failing' }),
      pr(5, { reviewDecision: 'approved' }),
      pr(6, { reviewDecision: 'approved' }),
    ]
    expect(ids(sortPrs(list, 'closest'))).toEqual([6, 5, 4, 3, 2, 1])
  })

  it('started puts sessions first, then viewed fraction descending, then newest', () => {
    const list = [
      pr(1),
      pr(2, { sessionStatus: 'in-progress', viewedFileCount: 2, fileCount: 10 }),
      pr(3, { sessionStatus: 'paused', viewedFileCount: 9, fileCount: 10 }),
      pr(4, { sessionStatus: 'in-progress', viewedFileCount: 1, fileCount: 2 }),
      pr(5, { sessionStatus: 'paused', viewedFileCount: 1, fileCount: 2 }),
      pr(6, { sessionStatus: 'not-started' }),
    ]
    expect(ids(sortPrs(list, 'started'))).toEqual([3, 5, 4, 2, 6, 1])
  })

  it('started does not divide by zero for an empty PR', () => {
    const list = [
      pr(1, { sessionStatus: 'in-progress', viewedFileCount: 0, fileCount: 0 }),
      pr(2, { sessionStatus: 'in-progress', viewedFileCount: 0, fileCount: 0 }),
    ]
    expect(ids(sortPrs(list, 'started'))).toEqual([2, 1])
  })

  it('never mutates the input', () => {
    const list = [pr(3), pr(1), pr(2)]
    const copy = [...list]
    const sorted = sortPrs(list, 'newest')
    expect(list).toEqual(copy)
    expect(sorted).not.toBe(list)
  })

  it('sorts rows that name their age createdAt through dashboardToSortable', () => {
    const rows = [
      { id: 2, createdAt: '2026-02-01T00:00:00Z', ...pr(2) },
      { id: 1, createdAt: '2026-01-01T00:00:00Z', ...pr(1) },
    ].map(({ openedAt: _o, ...rest }) => rest)
    const sorted = sortPrs(rows as never[], 'newest', dashboardToSortable as never)
    expect((sorted as Array<{ id: number }>).map((r) => r.id)).toEqual([2, 1])
  })
})
