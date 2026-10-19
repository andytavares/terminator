// What the attention log says about how much the agents needed you.
//
// Everything here is a pure function of the log's intervals. Medians, never
// averages: one session left waiting overnight would make an average say
// nothing about a normal day.

export type AttentionState = 'working' | 'awaiting-input'

/** How an interval ended. `null` on the interval itself means it is still going. */
export type AttentionEnd = 'working' | 'awaiting-input' | 'idle' | 'exited'

/** A session's time in one state. */
export interface AttentionInterval {
  sessionId: string
  projectId: string | null
  branch: string | null
  /** The ticket key the session was linked to, when it was. */
  workKey: string | null
  state: AttentionState
  /** ISO time. */
  start: string
  /** ISO time, or null while the interval is still going. */
  end: string | null
  /** The state the session went to, or null while it is still going. */
  next: AttentionEnd | null
}

/** Epoch ms, `from` inclusive. */
export interface TimeWindow {
  from: number
  to: number
}

export interface DayPoint {
  /** Local midnight of the day, epoch ms. */
  dayStart: number
  agentHours: number
  waitMinutes: number
  waits: number
}

export interface AttentionMeasures {
  waitsOnYou: { count: number; medianMinutes: number; over30: number }
  agentHours: number
  runningAtOnceMedian: number
  finishedWithoutHelpRatio: number
  waitedOnYouToday: number
  longestWait: number
  perDay: DayPoint[]
}

export const ATTENTION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const LONG_WAIT_MINUTES = 30

/** The intervals still worth keeping at `now`. An open interval is always kept; a closed one whose
 * end cannot be read is dropped, as in session-records retention. */
export function pruneIntervals(
  intervals: readonly AttentionInterval[],
  now: number
): AttentionInterval[] {
  return intervals.filter((interval) => {
    if (interval.end === null) return true
    const end = Date.parse(interval.end)
    return !Number.isNaN(end) && now - end <= ATTENTION_RETENTION_MS
  })
}

interface Span {
  start: number
  end: number
}

/** The part of the interval inside the window, or null when none is. An open interval runs to the
 * window's end, so a session still waiting counts as waiting. */
function clipToWindow(interval: AttentionInterval, window: TimeWindow): Span | null {
  const start = Math.max(Date.parse(interval.start), window.from)
  const end = Math.min(interval.end === null ? window.to : Date.parse(interval.end), window.to)
  return Number.isNaN(start) || Number.isNaN(end) || end <= start ? null : { start, end }
}

function spansIn(
  intervals: readonly AttentionInterval[],
  state: AttentionState,
  window: TimeWindow
): Span[] {
  return intervals
    .filter((interval) => interval.state === state)
    .map((interval) => clipToWindow(interval, window))
    .filter((span): span is Span => span !== null)
}

const lengthOf = (span: Span): number => span.end - span.start

function medianOf(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function waitsOnYou(
  intervals: readonly AttentionInterval[],
  window: TimeWindow
): AttentionMeasures['waitsOnYou'] {
  const minutes = spansIn(intervals, 'awaiting-input', window).map((s) => lengthOf(s) / MINUTE_MS)
  return {
    count: minutes.length,
    medianMinutes: medianOf(minutes),
    over30: minutes.filter((m) => m > LONG_WAIT_MINUTES).length,
  }
}

export function agentHours(intervals: readonly AttentionInterval[], window: TimeWindow): number {
  return (
    spansIn(intervals, 'working', window).reduce((sum, span) => sum + lengthOf(span), 0) / HOUR_MS
  )
}

/** The medianOf number of sessions working together, over the time at least one was working. */
export function runningAtOnceMedian(
  intervals: readonly AttentionInterval[],
  window: TimeWindow
): number {
  const edges = spansIn(intervals, 'working', window).flatMap((s) => [
    { at: s.start, change: 1 },
    { at: s.end, change: -1 },
  ])
  edges.sort((a, b) => a.at - b.at || a.change - b.change)
  const weighted: Array<{ count: number; length: number }> = []
  let running = 0
  edges.forEach((edge, index) => {
    if (index > 0 && running > 0) {
      weighted.push({ count: running, length: edge.at - edges[index - 1].at })
    }
    running += edge.change
  })
  return weightedMedian(weighted.filter((w) => w.length > 0))
}

function weightedMedian(points: Array<{ count: number; length: number }>): number {
  const total = points.reduce((sum, p) => sum + p.length, 0)
  let seen = 0
  for (const p of [...points].sort((a, b) => a.count - b.count)) {
    seen += p.length
    if (seen * 2 >= total) return p.count
  }
  return 0
}

/** How many runs reached idle, and how many of those never asked. A run is a session's stretch
 * from first working to idle; one that ended because the session closed never finished. */
function runsOf(own: readonly AttentionInterval[]): { finished: number; unaided: number } {
  let tally = { finished: 0, unaided: 0 }
  let asked = false
  for (const interval of [...own].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))) {
    asked ||= interval.state === 'awaiting-input'
    if (interval.next === 'idle') {
      tally = { finished: tally.finished + 1, unaided: tally.unaided + (asked ? 0 : 1) }
    }
    if (interval.next === 'idle' || interval.next === 'exited') asked = false
  }
  return tally
}

/** The share of finished runs that needed no help from you. */
export function finishedWithoutHelpRatio(intervals: readonly AttentionInterval[]): number {
  const bySession = new Map<string, AttentionInterval[]>()
  for (const interval of intervals) {
    bySession.set(interval.sessionId, [...(bySession.get(interval.sessionId) ?? []), interval])
  }
  const runs = [...bySession.values()].map(runsOf)
  const finished = runs.reduce((sum, r) => sum + r.finished, 0)
  const unaided = runs.reduce((sum, r) => sum + r.unaided, 0)
  return finished === 0 ? 0 : unaided / finished
}

/** Minutes spent waiting on you since local midnight of `now`. */
export function waitedOnYouToday(intervals: readonly AttentionInterval[], now: number): number {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const spans = spansIn(intervals, 'awaiting-input', { from: midnight.getTime(), to: now })
  return spans.reduce((sum, span) => sum + lengthOf(span), 0) / MINUTE_MS
}

export function longestWait(intervals: readonly AttentionInterval[], window: TimeWindow): number {
  const lengths = spansIn(intervals, 'awaiting-input', window).map(lengthOf)
  return lengths.length === 0 ? 0 : Math.max(...lengths) / MINUTE_MS
}

/** One point per local day the window touches, oldest first. */
export function perDay(intervals: readonly AttentionInterval[], window: TimeWindow): DayPoint[] {
  const first = new Date(window.from)
  first.setHours(0, 0, 0, 0)
  const days: DayPoint[] = []
  for (const day = new Date(first); day.getTime() < window.to; day.setDate(day.getDate() + 1)) {
    const start = day.getTime()
    const next = new Date(day)
    next.setDate(next.getDate() + 1)
    const slice = { from: Math.max(start, window.from), to: Math.min(next.getTime(), window.to) }
    const waits = waitsOnYou(intervals, slice)
    days.push({
      dayStart: start,
      agentHours: agentHours(intervals, slice),
      waitMinutes: spansIn(intervals, 'awaiting-input', slice).reduce(
        (sum, span) => sum + lengthOf(span) / MINUTE_MS,
        0
      ),
      waits: waits.count,
    })
  }
  return days
}

export function attentionMeasures(
  intervals: readonly AttentionInterval[],
  window: TimeWindow,
  now: number
): AttentionMeasures {
  const inWindow = intervals.filter((i) => clipToWindow(i, window) !== null)
  return {
    waitsOnYou: waitsOnYou(intervals, window),
    agentHours: agentHours(intervals, window),
    runningAtOnceMedian: runningAtOnceMedian(intervals, window),
    finishedWithoutHelpRatio: finishedWithoutHelpRatio(inWindow),
    waitedOnYouToday: waitedOnYouToday(intervals, now),
    longestWait: longestWait(intervals, window),
    perDay: perDay(intervals, window),
  }
}
