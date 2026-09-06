import { describe, it, expect } from 'vitest'
import { createPendingPermissions, type PendingAsk } from '../../src/runtime/pending-permissions.js'

// The runner raises a request and clears it again; something has to hold the
// ones in between, or the surface has nothing to render and a phase sits at its
// hook until the bridge hands the decision back to the terminal.
//
// Keyed by the card's feature directory rather than by a session registry of its
// own — a supervised run belongs to a card, and the board, the phases and the
// worktree already identify one that way.

const ask = (over: Partial<PendingAsk> = {}): PendingAsk => ({
  featureDir: '/repo/specs/021-thing',
  sessionId: 'session-1',
  requestId: 'req-1',
  toolName: 'Bash',
  summary: 'rm -rf /',
  detail: 'command: rm -rf /',
  at: 1_000,
  ...over,
})

describe('holding what is waiting on the operator', () => {
  it('lists a raised request', () => {
    const pending = createPendingPermissions()
    pending.add(ask())
    expect(pending.list()).toEqual([ask()])
  })

  it('lists oldest first, so one card cannot starve another by asking last', () => {
    const pending = createPendingPermissions()
    pending.add(ask({ requestId: 'first' }))
    pending.add(ask({ requestId: 'second', featureDir: '/repo/specs/022-other' }))
    expect(pending.list().map((a) => a.requestId)).toEqual(['first', 'second'])
  })

  it('clears one that has been answered', () => {
    const pending = createPendingPermissions()
    pending.add(ask())
    pending.remove('req-1')
    expect(pending.list()).toEqual([])
  })

  it('ignores clearing something it does not have', () => {
    const pending = createPendingPermissions()
    expect(() => pending.remove('never-raised')).not.toThrow()
  })

  it('says which run an answer belongs to', () => {
    const pending = createPendingPermissions()
    pending.add(ask({ sessionId: 'session-7' }))
    expect(pending.sessionFor('req-1')).toBe('session-7')
  })

  it('says nothing for a request that is no longer waiting', () => {
    // A stale click must not be sent to some other run.
    expect(createPendingPermissions().sessionFor('req-1')).toBeNull()
  })

  it('shows only one card’s requests when asked for them', () => {
    const pending = createPendingPermissions()
    pending.add(ask({ requestId: 'a' }))
    pending.add(ask({ requestId: 'b', featureDir: '/repo/specs/022-other' }))
    expect(pending.forCard('/repo/specs/021-thing').map((a) => a.requestId)).toEqual(['a'])
  })

  it('drops a card’s requests when its run ends', () => {
    const pending = createPendingPermissions()
    pending.add(ask({ requestId: 'a' }))
    pending.add(ask({ requestId: 'b', featureDir: '/repo/specs/022-other' }))
    pending.forgetCard('/repo/specs/021-thing')
    expect(pending.list().map((a) => a.requestId)).toEqual(['b'])
  })

  it('replaces a request raised twice under the same id rather than duplicating it', () => {
    const pending = createPendingPermissions()
    pending.add(ask({ summary: 'first' }))
    pending.add(ask({ summary: 'second' }))
    expect(pending.list()).toHaveLength(1)
    expect(pending.list()[0].summary).toBe('second')
  })
})
