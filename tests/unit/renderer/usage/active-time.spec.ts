import { describe, it, expect } from 'vitest'
import { ActiveTimeTracker, IDLE_LIMIT_MS } from '../../../../src/renderer/usage/active-time'

const SECOND = 1000

function trackerOn(ids: string[], at = 0) {
  const tracker = new ActiveTimeTracker()
  tracker.setFocused(true, at)
  tracker.input(at)
  tracker.setIds(ids, at)
  return tracker
}

describe('ActiveTimeTracker — spans', () => {
  it('flushes the time a surface was active when it stops being active', () => {
    const tracker = trackerOn(['core.home'])
    expect(tracker.setIds([], 30 * SECOND)).toEqual([{ id: 'core.home', activeMs: 30 * SECOND }])
  })

  it('keeps the time of a surface that stays active until a flush', () => {
    const tracker = trackerOn(['core.home'])
    expect(tracker.setIds(['core.home'], 10 * SECOND)).toEqual([])
    expect(tracker.flushAll(20 * SECOND)).toEqual([{ id: 'core.home', activeMs: 20 * SECOND }])
    expect(tracker.flushAll(25 * SECOND)).toEqual([{ id: 'core.home', activeMs: 5 * SECOND }])
  })
})

describe('ActiveTimeTracker — focus', () => {
  it('stops counting when the window loses focus and flushes what it had', () => {
    const tracker = trackerOn(['core.home'])
    expect(tracker.setFocused(false, 12 * SECOND)).toEqual([
      { id: 'core.home', activeMs: 12 * SECOND },
    ])
    expect(tracker.setIds([], 60 * SECOND)).toEqual([])
  })

  it('counts again from the moment the window gets focus back', () => {
    const tracker = trackerOn(['core.home'])
    tracker.setFocused(false, 10 * SECOND)
    tracker.setFocused(true, 100 * SECOND)
    tracker.input(100 * SECOND)
    expect(tracker.flushAll(105 * SECOND)).toEqual([{ id: 'core.home', activeMs: 5 * SECOND }])
  })
})

describe('ActiveTimeTracker — idle and focus', () => {
  it('counts at most the idle limit after the last keydown or pointerdown', () => {
    const tracker = trackerOn(['core.home'])
    const later = IDLE_LIMIT_MS + 10 * 60 * SECOND
    expect(tracker.setIds([], later)).toEqual([{ id: 'core.home', activeMs: IDLE_LIMIT_MS }])
  })

  it('does not count the idle gap between two inputs beyond the limit', () => {
    const tracker = trackerOn(['core.home'])
    const secondInput = IDLE_LIMIT_MS * 3
    tracker.input(secondInput)
    expect(tracker.setIds([], secondInput + 10 * SECOND)).toEqual([
      { id: 'core.home', activeMs: IDLE_LIMIT_MS + 10 * SECOND },
    ])
  })

  it('counts nothing for a surface shown before any input', () => {
    const tracker = new ActiveTimeTracker()
    tracker.setFocused(true, 0)
    tracker.setIds(['core.home'], 0)
    expect(tracker.flushAll(60 * SECOND)).toEqual([])
  })

  it('accrues every active id at once and flushes only the one that left', () => {
    const tracker = trackerOn(['core.app.active', 'core.home'])
    expect(tracker.setIds(['core.app.active'], 8 * SECOND)).toEqual([
      { id: 'core.home', activeMs: 8 * SECOND },
    ])
  })
})
