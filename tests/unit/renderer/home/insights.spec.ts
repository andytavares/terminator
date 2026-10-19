import { describe, it, expect } from 'vitest'
import {
  compareCount,
  formatAge,
  formatNumber,
  formatTokens,
  measureReading,
  oldestReview,
  quantile,
  rangeBefore,
  startToMerge,
  windowRange,
  type SessionStart,
} from '../../../../src/renderer/home/insights'
import type { HomeAsk, HomeMeasure } from '../../../../src/shared/schemas/home-feed.schema'
import { facet } from './fixtures'

const NOW = Date.parse('2026-10-18T12:00:00.000Z')
const DAY = 86_400_000

const merged: HomeMeasure = {
  id: 'merged',
  question: 'How much shipped?',
  value: 28,
  unit: 'count',
  window: 'quarter',
  series: [1, 2, 3, 2, 3, 4, 2, 1, 2, 3, 1, 3, 4],
  previous: 20,
}

describe('windowRange and rangeBefore', () => {
  it('ends at now and reaches back the window length', () => {
    expect(windowRange('week', NOW)).toEqual({ from: NOW - 7 * DAY, to: NOW })
    expect(windowRange('30d', NOW).from).toBe(NOW - 30 * DAY)
  })

  it('puts the previous range directly before, with the same length', () => {
    expect(rangeBefore({ from: NOW - 7 * DAY, to: NOW })).toEqual({
      from: NOW - 14 * DAY,
      to: NOW - 7 * DAY,
    })
  })
})

describe('measureReading', () => {
  it('reads a measure as published when its window is the chosen one', () => {
    expect(measureReading([merged], 'merged', 'quarter')).toMatchObject({ value: 28, previous: 20 })
  })

  it('cuts a quarter of weekly points down to the last week and the one before', () => {
    expect(measureReading([merged], 'merged', 'week')).toMatchObject({ value: 4, previous: 3 })
  })

  it('cuts 30 days from the last four weeks against the four before', () => {
    expect(measureReading([merged], 'merged', '30d')).toMatchObject({ value: 11, previous: 9 })
  })

  it('has no reading for a window it cannot be cut to, or a measure nobody published', () => {
    expect(measureReading([merged], 'merged', 'year')).toBeNull()
    expect(measureReading([merged], 'foundry-shipped', 'week')).toBeNull()
  })

  it('does not stretch a percent measure to another window', () => {
    const firstPass: HomeMeasure = { ...merged, id: 'p', unit: 'percent', window: '30d' }
    expect(measureReading([firstPass], 'p', 'week')).toBeNull()
  })
})

describe('compareCount', () => {
  it('says how many more or fewer than the period before', () => {
    expect(compareCount({ value: 9, previous: 7 }, 'week')).toEqual({
      text: '2 more than last week',
      tone: 'up',
    })
    expect(compareCount({ value: 5, previous: 7 }, 'quarter')).toEqual({
      text: '2 fewer than the quarter before',
      tone: 'down',
    })
  })

  it('says so when nothing changed, and nothing when there is nothing to compare with', () => {
    expect(compareCount({ value: 7, previous: 7 }, 'week')?.tone).toBe('same')
    expect(compareCount({ value: 7 }, 'week')).toBeNull()
  })
})

describe('quantile', () => {
  it('interpolates between neighbours', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2)
  })
})

const range = { from: NOW - 7 * DAY, to: NOW }
const link = (key: string) => ({ tracker: 'linear' as const, key })
const startedDaysAgo = (key: string, days: number): SessionStart => ({
  link: link(key),
  startedAt: new Date(NOW - days * DAY).toISOString(),
})
const mergedTicket = (key: string, daysAgo: number) =>
  facet({
    workKey: link(key),
    tone: 'good',
    stage: 'shipped',
    closedAt: new Date(NOW - daysAgo * DAY).toISOString(),
  })

describe('startToMerge', () => {
  it('takes the median and the middle half from first session to merge, per ticket', () => {
    const records = [
      startedDaysAgo('TAV-1', 6),
      startedDaysAgo('TAV-1', 9),
      startedDaysAgo('TAV-2', 5),
      startedDaysAgo('TAV-3', 4),
      startedDaysAgo('TAV-4', 3),
    ]
    const facets = [
      mergedTicket('TAV-1', 5),
      mergedTicket('TAV-2', 3),
      mergedTicket('TAV-3', 1),
      mergedTicket('TAV-4', 1),
    ]
    const spread = startToMerge(records, facets, range)
    // TAV-1 counts from its earliest session: 9 - 5 = 4 days; the others 2, 3, 2.
    expect(spread).toEqual({ medianDays: 2.5, lowDays: 2, highDays: 3.25, count: 4 })
  })
})

describe('startToMerge: too little to say', () => {
  it('has nothing to say below three tickets, or for merges outside the range', () => {
    const records = [startedDaysAgo('TAV-1', 6), startedDaysAgo('TAV-2', 6)]
    expect(
      startToMerge(records, [mergedTicket('TAV-1', 2), mergedTicket('TAV-2', 2)], range)
    ).toBeNull()
    const old = [mergedTicket('TAV-1', 20), mergedTicket('TAV-2', 20), mergedTicket('TAV-3', 20)]
    expect(startToMerge(records, old, range)).toBeNull()
  })

  it('skips a pull request closed without merging and one with no recorded session', () => {
    const open = facet({ workKey: link('TAV-1'), closedAt: new Date(NOW - DAY).toISOString() })
    expect(
      startToMerge([startedDaysAgo('TAV-1', 6)], [open, mergedTicket('TAV-9', 1)], range)
    ).toBeNull()
  })
})

describe('formatting', () => {
  it('shows one decimal below ten and none above', () => {
    expect(formatNumber(1.64)).toBe('1.6')
    expect(formatNumber(21.4)).toBe('21')
  })

  it('shortens token counts', () => {
    expect(formatTokens(420)).toBe('420')
    expect(formatTokens(850_000)).toBe('850k')
    expect(formatTokens(12_400_000)).toBe('12M')
    expect(formatTokens(2_450_000)).toBe('2.5M')
  })

  it('writes an age in minutes, hours or days', () => {
    expect(formatAge(40 * 60_000)).toBe('40 min')
    expect(formatAge(3 * 3_600_000)).toBe('3 h')
    expect(formatAge(2 * DAY)).toBe('2 d')
  })
})

describe('oldestReview', () => {
  const ask = (id: string, kind: HomeAsk['kind'], since: string): HomeAsk => ({
    id,
    kind,
    title: id,
    detail: '',
    facts: [],
    workKey: null,
    since,
    actions: [],
    open: { command: 'x' },
  })

  it('is the review request that has waited longest, ignoring other asks', () => {
    const asks = [
      ask('a', 'review', '2026-10-18T09:00:00Z'),
      ask('b', 'review', '2026-10-17T09:00:00Z'),
      ask('c', 'fix', '2026-10-01T09:00:00Z'),
    ]
    expect(oldestReview(asks)?.id).toBe('b')
    expect(oldestReview([ask('c', 'fix', '2026-10-01T09:00:00Z')])).toBeNull()
  })
})
