// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  INBOX_PINNED_KEY,
  INBOX_SETTLED_KEY,
  INBOX_SNOOZED_KEY,
  useInboxMarks,
} from '../../../../../src/components/sidebar/inbox-marks'

const DAY_MS = 24 * 60 * 60 * 1000
const stored = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? 'null')

beforeEach(() => {
  localStorage.clear()
  useInboxMarks.setState({ settled: {}, pinned: {}, snoozed: {} })
})

describe('useInboxMarks', () => {
  it('settles a thread, unpins it, and keeps both in storage', () => {
    useInboxMarks.getState().togglePin('a', 5)
    expect(stored(INBOX_PINNED_KEY)).toEqual({ a: 5 })
    useInboxMarks.getState().settle('a', 10)
    expect(useInboxMarks.getState()).toMatchObject({ settled: { a: 10 }, pinned: {} })
    expect(stored(INBOX_SETTLED_KEY)).toEqual({ a: 10 })
    expect(stored(INBOX_PINNED_KEY)).toEqual({})
  })

  it('pins and unpins on the same toggle', () => {
    useInboxMarks.getState().togglePin('a', 5)
    useInboxMarks.getState().togglePin('a', 6)
    expect(useInboxMarks.getState().pinned).toEqual({})
  })

  it('snoozes until a time and wakes on new activity', () => {
    useInboxMarks.getState().snooze('a', 99)
    useInboxMarks.getState().settle('b', 1)
    expect(stored(INBOX_SNOOZED_KEY)).toEqual({ a: 99 })
    useInboxMarks.getState().wake(['a', 'b'])
    expect(useInboxMarks.getState()).toMatchObject({ settled: {}, snoozed: {} })
  })
})

describe('useInboxMarks — pinning', () => {
  it('pinning a settled or snoozed card wakes it, so unpinning keeps it at the top', () => {
    useInboxMarks.getState().settle('a', 10)
    useInboxMarks.getState().snooze('b', 99)
    useInboxMarks.getState().togglePin('a', 11)
    useInboxMarks.getState().togglePin('b', 11)
    useInboxMarks.getState().togglePin('a', 12)
    const { settled, snoozed, pinned } = useInboxMarks.getState()
    expect({ settled, snoozed, pinned }).toEqual({ settled: {}, snoozed: {}, pinned: { b: 11 } })
  })
})

describe('useInboxMarks — forgetting', () => {
  it('forgets marks of gone threads once they are 30 days old', () => {
    const now = 100 * DAY_MS
    useInboxMarks.getState().settle('gone-old', now - 31 * DAY_MS)
    useInboxMarks.getState().settle('gone-new', now - DAY_MS)
    useInboxMarks.getState().togglePin('live-old', now - 40 * DAY_MS)
    useInboxMarks.getState().forgetGone(new Set(['live-old']), now)
    expect(useInboxMarks.getState().settled).toEqual({ 'gone-new': now - DAY_MS })
    expect(useInboxMarks.getState().pinned).toEqual({ 'live-old': now - 40 * DAY_MS })
  })
})
