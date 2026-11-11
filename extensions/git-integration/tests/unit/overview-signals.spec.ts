import { describe, it, expect } from 'vitest'
import {
  insightsPending,
  overviewSignals,
  overviewTotals,
} from '../../src/components/pr-review/overview-signals'
import type { PrReviewDetail, PrInsights } from '../../src/schemas/pr-review.schema'
import { baseInsights, buildPr, secondChapter, shardingChapter } from './overview-fixtures'

const pickSignal = (pr: PrReviewDetail, kind: string) =>
  overviewSignals(pr).find((signal) => signal.kind === kind)

const twoChapterPr = (overrides: Partial<PrReviewDetail> = {}) =>
  buildPr({ chapters: [shardingChapter(), secondChapter()], ...overrides })

const withInsights = (patch: Partial<PrInsights>) =>
  twoChapterPr({ insights: { ...baseInsights, ...patch } })

describe('overviewTotals', () => {
  it('sums files and lines across every chapter', () => {
    expect(overviewTotals(twoChapterPr())).toEqual({
      fileCount: 4,
      additions: 40,
      deletions: 20,
    })
  })
})

describe('overviewSignals complexity, reading and health', () => {
  it('names the branch change and the largest riser, and flags the rise', () => {
    expect(pickSignal(twoChapterPr(), 'complexity')).toMatchObject({
      value: '+23 branches',
      detail: 'Largest: selectSpecs +9',
      tone: 'warning',
    })
  })
})

describe('overviewSignals complexity without risers', () => {
  it('has no largest riser when no function gained branches', () => {
    const pr = withInsights({
      complexity: { ...baseInsights.complexity, branchDelta: 0, functions: [] },
    })
    expect(pickSignal(pr, 'complexity')).toMatchObject({
      value: 'No change',
      detail: null,
      tone: 'neutral',
    })
  })
})

describe('overviewSignals reading and health', () => {
  it.each([
    ['easy', 'Easy', 'success'],
    ['moderate', 'Moderate', 'warning'],
    ['hard', 'Hard', 'danger'],
  ] as const)('reads %s as %s with tone %s', (level, value, tone) => {
    const pr = withInsights({
      understandability: {
        ...baseInsights.understandability,
        level,
        linesToRead: 1140,
        newExports: 6,
      },
    })
    expect(pickSignal(pr, 'reading')).toMatchObject({
      value,
      tone,
      detail: '1,140 lines, 6 new exports',
    })
  })
})

describe('overviewSignals health', () => {
  it('groups health flags by kind', () => {
    expect(pickSignal(twoChapterPr(), 'health')).toMatchObject({
      value: '3 flags',
      tone: 'warning',
      detail: '1 function over 80 lines, 1 New TODO/FIXME, 1 block duplicated in 2 files',
    })
  })

  it('omits health when there are no flags', () => {
    const pr = withInsights({ health: { ...baseInsights.health, flags: [] } })
    expect(pickSignal(pr, 'health')).toBeUndefined()
  })
})

describe('insights still loading', () => {
  it('returns no signals and reports pending', () => {
    const pr = twoChapterPr({ insights: null })
    expect(overviewSignals(pr)).toEqual([])
    expect(insightsPending(pr)).toBe(true)
    expect(insightsPending(twoChapterPr())).toBe(false)
  })
})
