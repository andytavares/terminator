import { describe, it, expect } from 'vitest'
import {
  insightsPending,
  overviewSignals,
  overviewTotals,
} from '../../src/components/pr-review/overview-signals'
import type { PrReviewDetail, PrInsights } from '../../src/schemas/pr-review.schema'
import {
  baseInsights,
  buildPr,
  makeFile,
  secondChapter,
  shardingChapter,
} from './overview-fixtures'

const pickSignal = (pr: PrReviewDetail, kind: string) =>
  overviewSignals(pr).find((signal) => signal.kind === kind)

const twoChapterPr = (overrides: Partial<PrReviewDetail> = {}) =>
  buildPr({ chapters: [shardingChapter(), secondChapter()], ...overrides })

const withInsights = (patch: Partial<PrInsights>) =>
  twoChapterPr({ insights: { ...baseInsights, ...patch } })

describe('overviewTotals', () => {
  it('sums files, lines and minutes across every chapter', () => {
    expect(overviewTotals(twoChapterPr())).toEqual({
      fileCount: 4,
      additions: 40,
      deletions: 20,
      minutes: 25,
    })
  })
})

describe('overviewSignals risk', () => {
  it('picks the high file and its dominant driver', () => {
    expect(pickSignal(twoChapterPr(), 'risk')).toMatchObject({
      value: 'High',
      tone: 'danger',
      detail: 'playwright.config.ts (Wide blast radius — 41 importers)',
    })
  })
})

describe('overviewSignals risk edge cases', () => {
  it('shortens deep paths in the hotspot', () => {
    const deep = buildPr({
      chapters: [
        {
          ...shardingChapter(),
          files: [
            makeFile('a/b/c/deep.ts', { level: 'medium', composite: 55, dominantDriver: 'Churn' }),
          ],
        },
      ],
    })
    expect(pickSignal(deep, 'risk')).toMatchObject({
      value: 'Medium',
      tone: 'warning',
      detail: '…/c/deep.ts (Churn)',
    })
  })
})

describe('overviewSignals risk without scores', () => {
  it('says Not measured when no file has a score', () => {
    const unmeasured = buildPr({
      chapters: [
        {
          ...shardingChapter(),
          files: [makeFile('a.ts', { level: 'low', composite: null, dominantDriver: 'none' })],
        },
      ],
    })
    expect(pickSignal(unmeasured, 'risk')).toMatchObject({
      value: 'Not measured',
      tone: 'neutral',
      detail: null,
    })
  })

  it('is neutral Low with no detail when nothing stands out', () => {
    const calm = buildPr({ chapters: [secondChapter()] })
    expect(pickSignal(calm, 'risk')).toMatchObject({ value: 'Low', tone: 'neutral', detail: null })
  })
})

describe('overviewSignals tests', () => {
  it('lists untested functions and warns', () => {
    expect(pickSignal(twoChapterPr(), 'tests')).toMatchObject({
      value: '5 of 7 functions',
      tone: 'warning',
      detail: 'No test: shardByDuration, readBurnIn',
    })
  })
})

describe('overviewSignals tests edge cases', () => {
  it('truncates the untested list with +N more', () => {
    const pr = withInsights({
      coverage: {
        ...baseInsights.coverage,
        untestedFunctions: ['a', 'b', 'c', 'd', 'e'],
      },
    })
    expect(pickSignal(pr, 'tests')?.detail).toBe('No test: a, b, c, +2 more')
  })
})

describe('overviewSignals tests when clean', () => {
  it('is success when every function is tested', () => {
    const pr = withInsights({
      coverage: { ...baseInsights.coverage, testedFunctions: 7, untestedFunctions: [] },
    })
    expect(pickSignal(pr, 'tests')).toMatchObject({
      value: '7 of 7 functions',
      tone: 'success',
      detail: null,
    })
  })

  it('is neutral when no function changed', () => {
    const pr = withInsights({
      coverage: {
        ...baseInsights.coverage,
        changedFunctions: 0,
        testedFunctions: 0,
        untestedFunctions: [],
      },
    })
    expect(pickSignal(pr, 'tests')).toMatchObject({
      value: 'No functions changed',
      tone: 'neutral',
    })
  })
})

describe('overviewSignals complexity, reading and health', () => {
  it('names the branch change and the largest riser', () => {
    expect(pickSignal(twoChapterPr(), 'complexity')).toMatchObject({
      value: '+23 branches',
      detail: 'Largest: selectSpecs +9',
      tone: 'neutral',
    })
  })
})

describe('overviewSignals complexity without risers', () => {
  it('has no largest riser when no function gained branches', () => {
    const pr = withInsights({
      complexity: { ...baseInsights.complexity, branchDelta: 0, functions: [] },
    })
    expect(pickSignal(pr, 'complexity')).toMatchObject({ value: 'No change', detail: null })
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
      detail: '1 function over 80 lines, 1 new eslint-disable, 1 block duplicated in 2 files',
    })
  })

  it('omits health when there are no flags', () => {
    const pr = withInsights({ health: { ...baseInsights.health, flags: [] } })
    expect(pickSignal(pr, 'health')).toBeUndefined()
  })
})

describe('insights still loading', () => {
  it('returns only the risk signal and reports pending', () => {
    const pr = twoChapterPr({ insights: null })
    expect(overviewSignals(pr).map((signal) => signal.kind)).toEqual(['risk'])
    expect(insightsPending(pr)).toBe(true)
    expect(insightsPending(twoChapterPr())).toBe(false)
  })
})
