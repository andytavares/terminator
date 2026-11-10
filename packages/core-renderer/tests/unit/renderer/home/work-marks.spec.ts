// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  INBOX_PINNED_KEY,
  INBOX_SETTLED_KEY,
  INBOX_SNOOZED_KEY,
  useWorkMarks,
} from '../../../../src/home/work-marks'

const DAY_MS = 24 * 60 * 60 * 1000
const stored = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? 'null')

beforeEach(() => {
  localStorage.clear()
  useWorkMarks.setState({ settled: {}, pinned: {}, snoozed: {} })
})

describe('useWorkMarks', () => {
  it('settles a thread, unpins it, and keeps both in storage', () => {
    useWorkMarks.getState().togglePin('a', 5)
    expect(stored(INBOX_PINNED_KEY)).toEqual({ a: 5 })
    useWorkMarks.getState().settle('a', 10)
    expect(useWorkMarks.getState()).toMatchObject({ settled: { a: 10 }, pinned: {} })
    expect(stored(INBOX_SETTLED_KEY)).toEqual({ a: 10 })
    expect(stored(INBOX_PINNED_KEY)).toEqual({})
  })

  it('pins and unpins on the same toggle', () => {
    useWorkMarks.getState().togglePin('a', 5)
    useWorkMarks.getState().togglePin('a', 6)
    expect(useWorkMarks.getState().pinned).toEqual({})
  })

  it('snoozes until a time and wakes on new activity', () => {
    useWorkMarks.getState().snooze('a', 99)
    useWorkMarks.getState().settle('b', 1)
    expect(stored(INBOX_SNOOZED_KEY)).toEqual({ a: 99 })
    useWorkMarks.getState().wake(['a', 'b'])
    expect(useWorkMarks.getState()).toMatchObject({ settled: {}, snoozed: {} })
  })
})

describe('useWorkMarks — pinning', () => {
  it('pinning a settled or snoozed card wakes it, so unpinning keeps it at the top', () => {
    useWorkMarks.getState().settle('a', 10)
    useWorkMarks.getState().snooze('b', 99)
    useWorkMarks.getState().togglePin('a', 11)
    useWorkMarks.getState().togglePin('b', 11)
    useWorkMarks.getState().togglePin('a', 12)
    const { settled, snoozed, pinned } = useWorkMarks.getState()
    expect({ settled, snoozed, pinned }).toEqual({ settled: {}, snoozed: {}, pinned: { b: 11 } })
  })
})

describe('useWorkMarks — forgetting', () => {
  it('forgets marks of gone threads once they are 30 days old', () => {
    const now = 100 * DAY_MS
    useWorkMarks.getState().settle('gone-old', now - 31 * DAY_MS)
    useWorkMarks.getState().settle('gone-new', now - DAY_MS)
    useWorkMarks.getState().togglePin('live-old', now - 40 * DAY_MS)
    useWorkMarks.getState().forgetGone(new Set(['live-old']), now)
    expect(useWorkMarks.getState().settled).toEqual({ 'gone-new': now - DAY_MS })
    expect(useWorkMarks.getState().pinned).toEqual({ 'live-old': now - 40 * DAY_MS })
  })
})

describe('useWorkMarks — restore', () => {
  it('removes the key from settled and snoozed and keeps other keys', () => {
    useWorkMarks.getState().settle('a', 1)
    useWorkMarks.getState().snooze('a', 99)
    useWorkMarks.getState().settle('b', 2)
    useWorkMarks.getState().restore('a')
    expect(useWorkMarks.getState()).toMatchObject({ settled: { b: 2 }, snoozed: {} })
    expect(stored(INBOX_SETTLED_KEY)).toEqual({ b: 2 })
  })
})

describe('useWorkMarks — migrating hand dismissals', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('turns each dismissed-threads entry into a settled mark and removes the old keys', async () => {
    localStorage.setItem('terminator.home.dismissed-threads', JSON.stringify({ x: 7 }))
    localStorage.setItem('terminator.home.dismissed-sessions', JSON.stringify({ x: 7 }))
    localStorage.setItem(INBOX_SETTLED_KEY, JSON.stringify({ y: 3 }))
    const fresh = await import('../../../../src/home/work-marks')
    expect(fresh.useWorkMarks.getState().settled).toEqual({ x: 7, y: 3 })
    expect(stored(INBOX_SETTLED_KEY)).toEqual({ x: 7, y: 3 })
    expect(localStorage.getItem('terminator.home.dismissed-threads')).toBeNull()
    expect(localStorage.getItem('terminator.home.dismissed-sessions')).toBeNull()
  })
})
