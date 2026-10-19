import { describe, it, expect } from 'vitest'
import {
  agentHours,
  attentionMeasures,
  finishedWithoutHelpRatio,
  longestWait,
  pruneIntervals,
  runningAtOnceMedian,
  waitedOnYouToday,
  waitsOnYou,
  type AttentionEnd,
  type AttentionInterval,
  type AttentionState,
} from '../../../../src/shared/home/attention-measures'

const at = (hour: number, minute = 0): string => new Date(2026, 9, 18, hour, minute).toISOString()
const NOW = new Date(2026, 9, 18, 18, 0).getTime()
const DAY: { from: number; to: number } = {
  from: new Date(2026, 9, 18, 0, 0).getTime(),
  to: NOW,
}

/** An attentionInterval from `start` to `end` (null while open) that went on to `next`. */
function attentionInterval(
  sessionId: string,
  state: AttentionState,
  span: [start: string, end: string | null, next: AttentionEnd | null]
): AttentionInterval {
  const [start, end, next] = span
  return { sessionId, projectId: 'p', branch: 'main', workKey: null, state, start, end, next }
}

describe('waitsOnYou', () => {
  it('counts, takes the median, and flags waits over thirty minutes', () => {
    const intervals = [
      attentionInterval('a', 'awaiting-input', [at(9), at(9, 10), 'working']),
      attentionInterval('b', 'awaiting-input', [at(10), at(10, 20), 'working']),
      attentionInterval('c', 'awaiting-input', [at(11), at(12), 'working']),
    ]
    expect(waitsOnYou(intervals, DAY)).toEqual({ count: 3, medianMinutes: 20, over30: 1 })
  })

  it('counts an ask never answered because the session closed, to the close', () => {
    const intervals = [attentionInterval('a', 'awaiting-input', [at(9), at(9, 45), 'exited'])]
    expect(waitsOnYou(intervals, DAY)).toEqual({ count: 1, medianMinutes: 45, over30: 1 })
  })

  it('counts a wait still going up to the end of the window', () => {
    const open = [attentionInterval('a', 'awaiting-input', [at(17), null, null])]
    expect(waitsOnYou(open, DAY).medianMinutes).toBe(60)
  })

  it('returns zeros, not NaN, for an empty window', () => {
    expect(waitsOnYou([], DAY)).toEqual({ count: 0, medianMinutes: 0, over30: 0 })
    expect(longestWait([], DAY)).toBe(0)
    expect(agentHours([], DAY)).toBe(0)
    expect(runningAtOnceMedian([], DAY)).toBe(0)
    expect(finishedWithoutHelpRatio([])).toBe(0)
  })
})

describe('agentHours and longestWait', () => {
  it('clips an interval to the window', () => {
    const intervals = [attentionInterval('a', 'working', [at(8), at(10), 'idle'])]
    expect(agentHours(intervals, { from: new Date(2026, 9, 18, 9).getTime(), to: NOW })).toBe(1)
  })

  it('finds the longest wait', () => {
    const intervals = [
      attentionInterval('a', 'awaiting-input', [at(9), at(9, 5), 'working']),
      attentionInterval('b', 'awaiting-input', [at(9), at(9, 40), 'working']),
    ]
    expect(longestWait(intervals, DAY)).toBe(40)
  })
})

describe('runningAtOnceMedian', () => {
  it('weights by time, over only the time something was working', () => {
    // a: 9:00-11:00 alone; b: 10:00-11:00 overlapping. 1 for 1h, 2 for 1h; idle time ignored.
    const intervals = [
      attentionInterval('a', 'working', [at(9), at(11), 'idle']),
      attentionInterval('b', 'working', [at(10), at(11), 'idle']),
      attentionInterval('c', 'working', [at(15), at(15, 30), 'idle']),
    ]
    // Weighted: 1 for 1.5h, 2 for 1h => median is 1.
    expect(runningAtOnceMedian(intervals, DAY)).toBe(1)
  })

  it('is two when two sessions overlap for most of the time', () => {
    const intervals = [
      attentionInterval('a', 'working', [at(9), at(12), 'idle']),
      attentionInterval('b', 'working', [at(9), at(12), 'idle']),
    ]
    expect(runningAtOnceMedian(intervals, DAY)).toBe(2)
  })
})

describe('finishedWithoutHelpRatio', () => {
  it('counts runs that reached idle without asking, over all that reached idle', () => {
    const intervals = [
      attentionInterval('a', 'working', [at(9), at(10), 'idle']),
      attentionInterval('b', 'working', [at(9), at(10), 'awaiting-input']),
      attentionInterval('b', 'awaiting-input', [at(10), at(10, 5), 'working']),
      attentionInterval('b', 'working', [at(10, 5), at(11), 'idle']),
      // Closed mid-run: never finished, so it is in neither count.
      attentionInterval('c', 'working', [at(9), at(9, 30), 'exited']),
    ]
    expect(finishedWithoutHelpRatio(intervals)).toBe(0.5)
  })

  it('starts a fresh run after an idle', () => {
    const intervals = [
      attentionInterval('a', 'working', [at(9), at(10), 'awaiting-input']),
      attentionInterval('a', 'awaiting-input', [at(10), at(10, 5), 'working']),
      attentionInterval('a', 'working', [at(10, 5), at(11), 'idle']),
      attentionInterval('a', 'working', [at(12), at(13), 'idle']),
    ]
    expect(finishedWithoutHelpRatio(intervals)).toBe(0.5)
  })
})

describe('waitedOnYouToday', () => {
  it('counts only the time since local midnight', () => {
    const yesterdayLate = new Date(2026, 9, 17, 23, 30).toISOString()
    const intervals = [
      attentionInterval('a', 'awaiting-input', [yesterdayLate, at(0, 20), 'working']),
    ]
    expect(waitedOnYouToday(intervals, NOW)).toBe(20)
  })
})

describe('attentionMeasures', () => {
  it('gives one point per day, and zeros for an empty log', () => {
    const week = { from: new Date(2026, 9, 12).getTime(), to: NOW }
    const empty = attentionMeasures([], week, NOW)
    expect(empty.perDay).toHaveLength(7)
    expect(JSON.stringify(empty)).not.toContain('null')
    expect(empty.waitsOnYou.count).toBe(0)
    const one = attentionMeasures(
      [attentionInterval('a', 'working', [at(9), at(10), 'idle'])],
      week,
      NOW
    )
    expect(one.perDay[6].agentHours).toBe(1)
    expect(one.perDay[0].agentHours).toBe(0)
  })
})

describe('pruneIntervals', () => {
  const daysAgoIso = (days: number): string => new Date(NOW - days * 86_400_000).toISOString()

  it('drops an interval that ended 91 days ago and keeps one 89 days old or still open', () => {
    const kept = pruneIntervals(
      [
        attentionInterval('old', 'working', [daysAgoIso(92), daysAgoIso(91), 'idle']),
        attentionInterval('recent', 'working', [daysAgoIso(90), daysAgoIso(89), 'idle']),
        attentionInterval('open', 'working', [daysAgoIso(200), null, null]),
        attentionInterval('garbled', 'working', [daysAgoIso(1), 'not a date', 'idle']),
      ],
      NOW
    )
    expect(kept.map((i) => i.sessionId)).toEqual(['recent', 'open'])
  })
})
