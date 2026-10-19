import type { HomeAsk, HomeMeasure, ThreadFacet } from '../../shared/schemas/home-feed.schema'
import type { AttentionInterval, TimeWindow } from '../../shared/home/attention-measures'

// What the Insights view says, as functions of the data it is given. Medians and the middle half,
// never averages: one stuck ticket would otherwise swamp a week.

export type InsightsWindow = HomeMeasure['window']

export const INSIGHTS_WINDOWS: ReadonlyArray<{ value: InsightsWindow; label: string }> = [
  { value: 'week', label: 'This week' },
  { value: '30d', label: '30 days' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
]

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS: Record<InsightsWindow, number> = { week: 7, '30d': 30, quarter: 91, year: 365 }
const WEEKS_IN_30_DAYS = 4
/** Fewer merged tickets than this give no honest "middle half". */
const MIN_TICKETS = 3

/** The window's range ending at `now`. */
export function windowRange(window: InsightsWindow, now: number): TimeWindow {
  return { from: now - WINDOW_DAYS[window] * DAY_MS, to: now }
}

/** The range of the same length that ends where `range` starts. */
export function rangeBefore(range: TimeWindow): TimeWindow {
  return { from: range.from - (range.to - range.from), to: range.from }
}

/** What a card reads off one measure for the chosen window. */
export interface MeasureReading {
  value: number
  previous?: number
  series: number[]
  unit: HomeMeasure['unit']
}

const totalOf = (values: number[]): number => values.reduce((total, v) => total + v, 0)

/** A count measure published per week, read for a shorter window than it was published for. */
function fromWeeklySeries(measure: HomeMeasure, window: InsightsWindow): MeasureReading | null {
  const { series } = measure
  const weeks = window === 'week' ? 1 : WEEKS_IN_30_DAYS
  if (measure.unit !== 'count' || series.length < weeks * 2) return null
  return {
    value: totalOf(series.slice(-weeks)),
    previous: totalOf(series.slice(-weeks * 2, -weeks)),
    series,
    unit: 'count',
  }
}

/** The measure for the window: as published, or cut from a quarter's weekly points; else null. */
export function measureReading(
  measures: readonly HomeMeasure[],
  id: string,
  window: InsightsWindow
): MeasureReading | null {
  const measure = measures.find((m) => m.id === id)
  if (measure === undefined) return null
  if (measure.window === window) {
    return {
      value: measure.value,
      previous: measure.previous,
      series: measure.series,
      unit: measure.unit,
    }
  }
  const cut = measure.window === 'quarter' && (window === 'week' || window === '30d')
  return cut ? fromWeeklySeries(measure, window) : null
}

const PREVIOUS_PERIOD: Record<InsightsWindow, string> = {
  week: 'last week',
  '30d': 'the 30 days before',
  quarter: 'the quarter before',
  year: 'the year before',
}

export interface Comparison {
  text: string
  tone: 'up' | 'down' | 'same'
}

/** "2 more than last week"; null when there is nothing to compare with. */
export function compareCount(
  reading: Pick<MeasureReading, 'value' | 'previous'>,
  window: InsightsWindow
): Comparison | null {
  if (reading.previous === undefined) return null
  const difference = reading.value - reading.previous
  const period = PREVIOUS_PERIOD[window]
  if (difference === 0) return { text: `the same as ${period}`, tone: 'same' }
  const words = difference > 0 ? `${difference} more` : `${-difference} fewer`
  return { text: `${words} than ${period}`, tone: difference > 0 ? 'up' : 'down' }
}

export interface DurationSpread {
  medianDays: number
  lowDays: number
  highDays: number
  count: number
}

/** The value at fraction `at` of the sorted list, interpolating between neighbours. */
export function quantile(sorted: readonly number[], at: number): number {
  const position = (sorted.length - 1) * at
  const below = Math.floor(position)
  const above = Math.ceil(position)
  return sorted[below] + (sorted[above] - sorted[below]) * (position - below)
}

/** What the ticket views read: the pull requests that closed, and the attention log's intervals. */
export interface TicketTimeInput {
  facets: readonly ThreadFacet[]
  intervals: readonly AttentionInterval[]
  range: TimeWindow
}

interface TicketMerge {
  key: string
  title: string
  facet: ThreadFacet
  start: number
  closed: number
}

const sameKey = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()

const keyIntervalsOf = (intervals: readonly AttentionInterval[], key: string) =>
  intervals.filter((i) => i.workKey !== null && sameKey(i.workKey, key))

/** The first moment of work on the ticket: its first attention interval, or its pull request's opening. */
function startOf(facet: ThreadFacet, keyIntervals: readonly AttentionInterval[]): number {
  const moments = [...keyIntervals.map((i) => i.start), facet.openedAt ?? '']
    .map((at) => Date.parse(at))
    .filter((at) => !Number.isNaN(at))
  return moments.length === 0 ? NaN : Math.min(...moments)
}

function ticketMergeOf(facet: ThreadFacet, input: TicketTimeInput): TicketMerge[] {
  const closed = facet.closedAt === null ? NaN : Date.parse(facet.closedAt)
  const merged = facet.kind === 'pull-request' && facet.tone === 'good'
  if (!merged || !('tracker' in facet.workKey)) return []
  if (!(closed >= input.range.from && closed < input.range.to)) return []
  const { key } = facet.workKey
  const start = startOf(facet, keyIntervalsOf(input.intervals, key))
  return closed > start ? [{ key, title: facet.title ?? key, facet, start, closed }] : []
}

/** The tickets whose pull request merged in the range, each from its start to its merge. */
function ticketMerges(input: TicketTimeInput): TicketMerge[] {
  return input.facets.flatMap((facet) => ticketMergeOf(facet, input))
}

export type TimeSegment = 'agent' | 'you' | 'review' | 'checks'

const SEGMENT_ORDER: readonly TimeSegment[] = ['agent', 'you', 'review', 'checks']
const MINUTE_MS = 60_000

export interface TicketTime {
  key: string
  title: string
  totalDays: number
  /** Minutes per segment; a segment that could not be measured for the ticket is absent. */
  minutes: Partial<Record<TimeSegment, number>>
}

export interface TimeBreakdown {
  tickets: TicketTime[]
  /** The segments measured for at least one ticket, in legend order. */
  measured: TimeSegment[]
}

/** Minutes the intervals in `state` lasted between the ticket's start and merge. */
function minutesIn(merge: TicketMerge, intervals: readonly AttentionInterval[], state: string) {
  return intervals
    .filter((i) => i.state === state)
    .reduce((total, i) => {
      const start = Math.max(Date.parse(i.start), merge.start)
      const end = Math.min(i.end === null ? merge.closed : Date.parse(i.end), merge.closed)
      return end > start ? total + (end - start) / MINUTE_MS : total
    }, 0)
}

/** Waiting for review: from ready until the first review by someone else, else until the merge. */
function reviewMinutes(merge: TicketMerge): number | undefined {
  const ready = Date.parse(merge.facet.readyAt ?? '')
  if (Number.isNaN(ready)) return undefined
  const reviewed = Date.parse(merge.facet.firstReviewAt ?? '')
  const until = Number.isNaN(reviewed) ? merge.closed : reviewed
  return Math.max(0, (until - ready) / MINUTE_MS)
}

function segmentsOf(merge: TicketMerge, keyIntervals: readonly AttentionInterval[]) {
  const logged = keyIntervals.length > 0
  const checks = merge.facet.checksMinutes
  const parts: Array<[TimeSegment, number | undefined]> = [
    ['agent', logged ? minutesIn(merge, keyIntervals, 'working') : undefined],
    ['you', logged ? minutesIn(merge, keyIntervals, 'awaiting-input') : undefined],
    ['review', reviewMinutes(merge)],
    ['checks', checks ?? undefined],
  ]
  return Object.fromEntries(parts.filter(([, minutes]) => minutes !== undefined))
}

/** Where each ticket's time went, for the tickets merged in the range, latest merge first. */
export function timeBreakdown(input: TicketTimeInput): TimeBreakdown {
  const tickets = ticketMerges(input)
    .sort((a, b) => b.closed - a.closed)
    .map((merge) => ({
      key: merge.key,
      title: merge.title,
      totalDays: (merge.closed - merge.start) / DAY_MS,
      minutes: segmentsOf(merge, keyIntervalsOf(input.intervals, merge.key)),
    }))
  const measured = SEGMENT_ORDER.filter((id) => tickets.some((t) => t.minutes[id] !== undefined))
  return { tickets, measured }
}

/** Days from a ticket's start to the merge of its pull request, for ticket merges in the range.
 * Null when too few tickets merged to say a median and a middle half. */
export function startToMerge(input: TicketTimeInput): DurationSpread | null {
  const days = ticketMerges(input).map((merge) => (merge.closed - merge.start) / DAY_MS)
  if (days.length < MIN_TICKETS) return null
  const sorted = [...days].sort((a, b) => a - b)
  return {
    medianDays: quantile(sorted, 0.5),
    lowDays: quantile(sorted, 0.25),
    highDays: quantile(sorted, 0.75),
    count: sorted.length,
  }
}

/** "1.6" for 1.6 days, "12" for 12: one decimal below ten, none above. */
export function formatNumber(value: number): string {
  return value < 10 ? String(Math.round(value * 10) / 10) : String(Math.round(value))
}

/** "12.4M" for 12 400 000, "850k" for 850 000, "420" below a thousand. */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${formatNumber(count / 1_000_000)}M`
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)
}

/** The oldest review request, or null when none is waiting. */
export function oldestReview<Ask extends HomeAsk>(asks: readonly Ask[]): Ask | null {
  const reviews = asks.filter(
    (ask) => ask.kind === 'review' && !Number.isNaN(Date.parse(ask.since))
  )
  return reviews.reduce<Ask | null>(
    (oldest, ask) => (oldest === null || ask.since < oldest.since ? ask : oldest),
    null
  )
}

/** "3 h" or "40 min" or "2 d" for an age in ms. */
export function formatAge(ageMs: number): string {
  const minutes = Math.max(0, Math.round(ageMs / 60_000))
  if (minutes < 60) return `${minutes} min`
  return minutes < 24 * 60 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} d`
}
