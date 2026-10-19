import { describe, it, expect } from 'vitest'
import {
  carriedOverRows,
  estimatedReviewMinutes,
  eventTone,
  planSentence,
  reviewLoadShare,
  yesterdayKey,
} from '../../../../src/renderer/home/plan-the-day'
import type { FocusItem } from '../../../../src/renderer/home/focus'
import type { SinceEvent } from '../../../../src/renderer/home/since-you-left'
import type { HomeAsk } from '../../../../src/shared/schemas/home-feed.schema'

const focus = (id: string, patch: Partial<FocusItem> = {}): FocusItem => ({
  id,
  title: `Title ${id}`,
  doneByHand: false,
  ...patch,
})
const event = (kind: SinceEvent['kind']): SinceEvent => ({ id: kind, kind, text: kind, at: 1 })
const review = (facts: string[]): HomeAsk => ({
  id: facts.join(),
  kind: 'review',
  title: 'Review requested',
  detail: '',
  facts,
  workKey: null,
  since: '2026-10-18T09:00:00Z',
  actions: [],
  open: { command: 'x' },
})

describe('yesterdayKey', () => {
  it('is the local day before', () => {
    expect(yesterdayKey(new Date(2026, 9, 18, 8).getTime())).toBe('2026-10-17')
    expect(yesterdayKey(new Date(2026, 10, 1, 8).getTime())).toBe('2026-10-31')
  })
})

describe('planSentence', () => {
  it('counts yesterday focus and what came in overnight', () => {
    const events = [event('agent-finished'), event('agent-finished'), event('review-requested')]
    expect(planSentence({ focusTotal: 3, focusDone: 2, events })).toBe(
      'Yesterday you finished 2 of 3 focus items. Overnight, 2 agents finished and 1 review came in.'
    )
  })

  it('leaves out yesterday when nothing was picked, and says when nothing came in', () => {
    expect(planSentence({ focusTotal: 0, focusDone: 0, events: [] })).toBe(
      'Nothing new came in overnight.'
    )
    expect(planSentence({ focusTotal: 1, focusDone: 1, events: [] })).toBe(
      'Yesterday you finished 1 of 1 focus item. Nothing new came in overnight.'
    )
  })
})

describe('estimatedReviewMinutes', () => {
  it('adds the "about N min" of every review you owe and ignores other asks', () => {
    const fix = { ...review(['about 99 min']), kind: 'fix' as const }
    const asks = [review(['6 files', 'about 15 min']), review(['about 25 min', 'low risk']), fix]
    expect(estimatedReviewMinutes(asks)).toBe(40)
  })

  it('counts a review with no estimate as nothing', () => {
    expect(estimatedReviewMinutes([review(['6 files'])])).toBe(0)
  })
})

describe('carriedOverRows', () => {
  const candidate = (id: string, done = false) => ({ id, title: `Task ${id}`, workKey: null, done })

  it('offers what yesterday left undone, then open tasks, once each', () => {
    const rows = carriedOverRows(
      [focus('a')],
      [candidate('t1'), candidate('t2', true), candidate('a')],
      []
    )
    expect(rows.map((r) => r.id)).toEqual(['a', 't1'])
    expect(rows[0].detail).toBe('focus yesterday, not done')
  })

  it('leaves out what is already in today focus', () => {
    expect(carriedOverRows([focus('a')], [candidate('t1')], [focus('a')]).map((r) => r.id)).toEqual(
      ['t1']
    )
  })
})

describe('eventTone and reviewLoadShare', () => {
  it('tones failures bad, requests as working, the rest good', () => {
    expect(eventTone('checks-failed')).toBe('bad')
    expect(eventTone('review-requested')).toBe('working')
    expect(eventTone('agent-finished')).toBe('good')
  })

  it('fills the bar at an hour of reviews, never past it', () => {
    expect(reviewLoadShare(30)).toBe(50)
    expect(reviewLoadShare(240)).toBe(100)
  })
})
