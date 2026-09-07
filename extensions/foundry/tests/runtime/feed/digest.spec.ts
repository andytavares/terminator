import { describe, it, expect } from 'vitest'
import { buildDigest, channelFor } from '../../../src/runtime/feed/digest.js'
import type { FeedEntry } from '../../../src/runtime/feed/feed-log.js'

// Coming back after time away. The point is not to replay every line the agents
// wrote — that is the feed — but to say what actually happened.

const entry = (over: Partial<FeedEntry> = {}): FeedEntry => ({
  id: 'e1',
  at: 1_000,
  sessionId: 'session-1',
  author: 'agent',
  summary: 'ran the tests',
  replyable: true,
  ...over,
})

describe('what a digest carries', () => {
  it('counts what happened in the window', () => {
    const digest = buildDigest([entry({ at: 1_000 }), entry({ id: 'e2', at: 2_000 })], 0, 3_000)
    expect(digest.entryCount).toBe(2)
  })

  it('leaves out what happened before you looked away', () => {
    const digest = buildDigest([entry({ at: 100 }), entry({ id: 'e2', at: 2_000 })], 1_000, 3_000)
    expect(digest.entryCount).toBe(1)
  })

  it('leaves out what happened after the window closed', () => {
    const digest = buildDigest([entry({ at: 1_000 }), entry({ id: 'e2', at: 9_000 })], 0, 3_000)
    expect(digest.entryCount).toBe(1)
  })

  it('says nothing happened rather than returning an empty shape', () => {
    const digest = buildDigest([], 0, 3_000)
    expect(digest.entryCount).toBe(0)
    expect(digest.sessionCount).toBe(0)
  })

  it('groups by run, so a card is read as one thing rather than interleaved', () => {
    const digest = buildDigest(
      [
        entry({ sessionId: 'a' }),
        entry({ id: 'e2', sessionId: 'b' }),
        entry({ id: 'e3', sessionId: 'a' }),
      ],
      0,
      3_000
    )
    expect(digest.sessionCount).toBe(2)
    expect(digest.bySession.find((s) => s.sessionId === 'a')?.entries).toHaveLength(2)
  })
})

describe('which channel an event may use', () => {
  it('lets a blocking permission request interrupt', () => {
    // The only thing that may: an agent is stopped dead until it is answered.
    expect(channelFor({ kind: 'permission_requested', sessionId: 's1' })).toBe('modal')
  })

  it('does not let a stall interrupt', () => {
    // A stall is a non-blocking indicator. Interrupting for it is how the
    // detector earns the reputation that gets it muted.
    expect(channelFor({ kind: 'stalled', sessionId: 's1' })).not.toBe('modal')
  })

  it('sends routine progress to the digest rather than to the operator', () => {
    expect(channelFor({ kind: 'progress', sessionId: 's1' })).toBe('digest')
  })
})
