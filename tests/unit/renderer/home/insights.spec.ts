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
  timeBreakdown,
  windowRange,
} from '../../../../src/renderer/home/insights'
import type { AttentionState } from '../../../../src/shared/home/attention-measures'
import type {
  HomeAsk,
  HomeMeasure,
  ThreadFacet,
} from '../../../../src/shared/schemas/home-feed.schema'
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
const isoDaysAgo = (days: number): string => new Date(NOW - days * DAY).toISOString()
const mergedTicket = (key: string, daysAgo: number, overrides: Partial<ThreadFacet> = {}) =>
  facet({
    workKey: link(key),
    tone: 'good',
    stage: 'shipped',
    closedAt: isoDaysAgo(daysAgo),
    ...overrides,
  })
const loggedInterval = (key: string, state: AttentionState, span: [number, number]) => ({
  sessionId: `${key}-${state}-${span[0]}`,
  projectId: null,
  branch: null,
  workKey: key,
  state,
  start: isoDaysAgo(span[0]),
  end: isoDaysAgo(span[1]),
  next: null,
})

describe('startToMerge', () => {
  it('takes the median and the middle half from first work to merge, per ticket', () => {
    const intervals = [
      loggedInterval('TAV-1', 'working', [6, 5.5]),
      loggedInterval('TAV-1', 'working', [9, 8]),
      loggedInterval('TAV-2', 'working', [5, 4]),
      loggedInterval('TAV-3', 'working', [4, 3]),
      loggedInterval('TAV-4', 'working', [3, 2]),
    ]
    const facets = [
      mergedTicket('TAV-1', 5),
      mergedTicket('TAV-2', 3),
      mergedTicket('TAV-3', 1),
      mergedTicket('TAV-4', 1),
    ]
    const spread = startToMerge({ facets, intervals, range })
    // TAV-1 counts from its earliest interval: 9 - 5 = 4 days; the others 2, 3, 2.
    expect(spread).toEqual({ medianDays: 2.5, lowDays: 2, highDays: 3.25, count: 4 })
  })

  it('starts at the pull request opening when that is earlier than any session', () => {
    const facets = ['TAV-1', 'TAV-2', 'TAV-3'].map((key) =>
      mergedTicket(key, 1, { openedAt: isoDaysAgo(5) })
    )
    expect(startToMerge({ facets, intervals: [], range })).toMatchObject({ medianDays: 4 })
  })
})

describe('startToMerge: too little to say', () => {
  const openedAt = isoDaysAgo(6)

  it('has nothing to say below three tickets, or for merges outside the range', () => {
    const two = [mergedTicket('TAV-1', 2, { openedAt }), mergedTicket('TAV-2', 2, { openedAt })]
    expect(startToMerge({ facets: two, intervals: [], range })).toBeNull()
    const old = ['TAV-1', 'TAV-2', 'TAV-3'].map((key) => mergedTicket(key, 20, { openedAt }))
    expect(startToMerge({ facets: old, intervals: [], range })).toBeNull()
  })

  it('skips a pull request closed without merging and one with no known start', () => {
    const unmerged = mergedTicket('TAV-1', 1, { tone: 'neutral', openedAt })
    const facets = [unmerged, mergedTicket('TAV-9', 1)]
    expect(startToMerge({ facets, intervals: [], range })).toBeNull()
  })
})

const full = mergedTicket('TAV-1', 1, {
  openedAt: isoDaysAgo(4),
  readyAt: isoDaysAgo(3),
  firstReviewAt: isoDaysAgo(2),
  checksMinutes: 12,
})
const fullIntervals = [
  loggedInterval('TAV-1', 'working', [4, 3.5]),
  loggedInterval('TAV-1', 'awaiting-input', [3.5, 3.25]),
  loggedInterval('TAV-1', 'working', [3.25, 3]),
]

describe('timeBreakdown', () => {
  it('splits a ticket into agent, you, review and checks, from its start to its merge', () => {
    const { tickets, measured } = timeBreakdown({ facets: [full], intervals: fullIntervals, range })
    expect(measured).toEqual(['agent', 'you', 'review', 'checks'])
    expect(tickets).toEqual([
      {
        key: 'TAV-1',
        title: 'TAV-1',
        totalDays: 3,
        minutes: { agent: 12 * 60 + 6 * 60, you: 6 * 60, review: 24 * 60, checks: 12 },
      },
    ])
  })

  it('waits on review until the merge when nobody reviewed', () => {
    const unreviewed = { ...full, firstReviewAt: null }
    const { tickets } = timeBreakdown({ facets: [unreviewed], intervals: fullIntervals, range })
    expect(tickets[0].minutes.review).toBe(2 * 24 * 60)
  })
})

describe('timeBreakdown: what cannot be measured', () => {
  it('without intervals shows only the review and checks segments', () => {
    const { tickets, measured } = timeBreakdown({ facets: [full], intervals: [], range })
    expect(measured).toEqual(['review', 'checks'])
    expect(tickets[0].minutes).toEqual({ review: 24 * 60, checks: 12 })
  })

  it('leaves out a ticket merged outside the range, and the segments nothing measured', () => {
    const old = mergedTicket('TAV-2', 20, { openedAt: isoDaysAgo(25), readyAt: isoDaysAgo(24) })
    const bare = mergedTicket('TAV-3', 1, { openedAt: isoDaysAgo(2) })
    const result = timeBreakdown({ facets: [old, bare], intervals: [], range })
    expect(result.tickets.map((t) => t.key)).toEqual(['TAV-3'])
    expect(result.measured).toEqual([])
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
