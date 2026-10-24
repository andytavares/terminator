import { describe, it, expect } from 'vitest'
import {
  carriedOverRows,
  estimatedReviewMinutes,
  planSentence,
  reviewLoadShare,
  yesterdayKey,
} from '../../../../src/renderer/home/plan-the-day'
import type { FocusItem } from '../../../../src/renderer/home/focus'
import type { HomeAsk } from '../../../../src/shared/schemas/home-feed.schema'

const focus = (id: string, patch: Partial<FocusItem> = {}): FocusItem => ({
  id,
  title: `Title ${id}`,
  doneByHand: false,
  ...patch,
})
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
  it('counts yesterday focus and what waits on the operator', () => {
    expect(
      planSentence({
        focusTotal: 3,
        focusDone: 2,
        waiting: { questions: 0, agents: 2, reviews: 1 },
      })
    ).toBe(
      'Yesterday you finished 2 of 3 focus items. Waiting on you: 2 agents finished and 1 review.'
    )
  })

  it('leaves out yesterday when nothing was picked, and says when nothing waits', () => {
    expect(
      planSentence({
        focusTotal: 0,
        focusDone: 0,
        waiting: { questions: 0, agents: 0, reviews: 0 },
      })
    ).toBe('Nothing is waiting on you.')
    expect(
      planSentence({
        focusTotal: 1,
        focusDone: 1,
        waiting: { questions: 0, agents: 0, reviews: 0 },
      })
    ).toBe('Yesterday you finished 1 of 1 focus item. Nothing is waiting on you.')
  })
})

describe('planSentence — questions', () => {
  it('counts an agent asking as waiting on you, and names only what is there', () => {
    expect(
      planSentence({
        focusTotal: 0,
        focusDone: 0,
        waiting: { questions: 1, agents: 0, reviews: 0 },
      })
    ).toBe('Waiting on you: 1 question.')
    expect(
      planSentence({
        focusTotal: 0,
        focusDone: 0,
        waiting: { questions: 2, agents: 1, reviews: 1 },
      })
    ).toBe('Waiting on you: 2 questions, 1 agent finished and 1 review.')
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

describe('reviewLoadShare', () => {
  it('fills the bar at an hour of reviews, never past it', () => {
    expect(reviewLoadShare(30)).toBe(50)
    expect(reviewLoadShare(240)).toBe(100)
  })
})
