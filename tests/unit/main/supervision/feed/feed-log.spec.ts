import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createFeedLog } from '../../../../../src/main/supervision/feed/feed-log.js'

let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'feed-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const newLog = () => createFeedLog(join(dir, 'feed.jsonl'))

const agentEntry = {
  at: 1_000,
  sessionId: 's1',
  author: 'agent' as const,
  summary: 'Ran the tests',
}
const consoleEntry = {
  at: 2_000,
  sessionId: 's1',
  author: 'console' as const,
  summary: 'Terminator: this session has recorded no tool activity',
}

describe('authorship (FR-092)', () => {
  it('records who wrote the entry', () => {
    const log = newLog()
    log.post(agentEntry)
    log.post(consoleEntry)
    expect(log.list().map((e) => e.author)).toEqual(['agent', 'console'])
  })

  it('marks an agent entry replyable', () => {
    expect(newLog().post(agentEntry).replyable).toBe(true)
  })

  it('marks a console entry not replyable, because nobody is listening', () => {
    // A stall notice was written by Terminator; replying to it would go nowhere.
    expect(newLog().post(consoleEntry).replyable).toBe(false)
  })
})

describe('chronology (FR-091)', () => {
  it('lists entries oldest first', () => {
    const log = newLog()
    log.post({ ...agentEntry, at: 3_000, summary: 'third' })
    log.post({ ...agentEntry, at: 1_000, summary: 'first' })
    expect(log.list().map((e) => e.summary)).toEqual(['first', 'third'])
  })

  it('returns entries since a point in time, for the catch-up case', () => {
    const log = newLog()
    log.post({ ...agentEntry, at: 1_000 })
    log.post({ ...agentEntry, at: 5_000 })
    expect(log.since(2_000)).toHaveLength(1)
  })

  it('filters to one session', () => {
    const log = newLog()
    log.post(agentEntry)
    log.post({ ...agentEntry, sessionId: 's2' })
    expect(log.forSession('s1')).toHaveLength(1)
  })

  it('is empty before anything is posted', () => {
    expect(newLog().list()).toEqual([])
  })

  it('issues a distinct id per entry', () => {
    const log = newLog()
    log.post(agentEntry)
    log.post(agentEntry)
    expect(new Set(log.list().map((e) => e.id)).size).toBe(2)
  })

  it('survives a reopen', () => {
    const path = join(dir, 'feed.jsonl')
    createFeedLog(path).post(agentEntry)
    expect(createFeedLog(path).list()).toHaveLength(1)
  })
})

describe('mute rules (FR-029)', () => {
  it('notifies when nothing is muted', () => {
    const log = newLog()
    expect(log.shouldNotify(log.post(agentEntry), [])).toBe(true)
  })

  it('suppresses the notification for a muted session', () => {
    const log = newLog()
    expect(log.shouldNotify(log.post(agentEntry), [{ sessionId: 's1' }])).toBe(false)
  })

  it('leaves other sessions notifying', () => {
    const log = newLog()
    const entry = log.post({ ...agentEntry, sessionId: 's2' })
    expect(log.shouldNotify(entry, [{ sessionId: 's1' }])).toBe(true)
  })

  it('suppresses by author class, so console chatter can be muted separately', () => {
    const log = newLog()
    expect(log.shouldNotify(log.post(consoleEntry), [{ author: 'console' }])).toBe(false)
    expect(log.shouldNotify(log.post(agentEntry), [{ author: 'console' }])).toBe(true)
  })

  it('still records a muted entry — the feed stays complete', () => {
    const log = newLog()
    const entry = log.post(agentEntry)
    log.shouldNotify(entry, [{ sessionId: 's1' }])
    // Muting suppresses the interruption, never the record of what happened.
    expect(log.list()).toHaveLength(1)
  })
})

// Discarding a session, or reclaiming its working copy, leaves nothing to go
// back to — so a feed still discussing it is noise about something that no
// longer exists.

describe('forgetting a session', () => {
  it('drops everything said about it', () => {
    const log = newLog()
    log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'did a thing' })
    log.post({ at: 2_000, sessionId: 's1', author: 'console', summary: 'stalled' })
    log.forget('s1')
    expect(log.forSession('s1')).toEqual([])
  })

  it('leaves other sessions alone', () => {
    const log = newLog()
    log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'mine' })
    log.post({ at: 1_000, sessionId: 's2', author: 'agent', summary: 'theirs' })
    log.forget('s1')
    expect(log.list().map((entry) => entry.sessionId)).toEqual(['s2'])
  })

  it('takes them out of a time window too', () => {
    const log = newLog()
    log.post({ at: 5_000, sessionId: 's1', author: 'agent', summary: 'x' })
    log.forget('s1')
    expect(log.since(0)).toEqual([])
  })

  it('survives a reopen, so they do not come back', () => {
    const log = newLog()
    log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'x' })
    log.forget('s1')
    expect(newLog().list()).toEqual([])
  })

  it('keeps anything said after it was forgotten', () => {
    const log = newLog()
    log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'before' })
    log.forget('s1')
    log.post({ at: 2_000, sessionId: 's1', author: 'console', summary: 'after' })
    expect(log.forSession('s1').map((entry) => entry.summary)).toEqual(['after'])
  })

  it('ignores a session it never heard of', () => {
    const log = newLog()
    log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'x' })
    log.forget('ghost')
    expect(log.list()).toHaveLength(1)
  })
})

describe('removing one entry', () => {
  it('takes it off the feed', () => {
    const log = newLog()
    const entry = log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'noise' })
    log.removeEntry(entry.id)
    expect(log.list()).toEqual([])
  })

  it('leaves the others', () => {
    const log = newLog()
    const first = log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'noise' })
    log.post({ at: 2_000, sessionId: 's1', author: 'agent', summary: 'keep' })
    log.removeEntry(first.id)
    expect(log.list().map((entry) => entry.summary)).toEqual(['keep'])
  })

  it('survives a reopen', () => {
    const log = newLog()
    const entry = log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'noise' })
    log.removeEntry(entry.id)
    expect(newLog().list()).toEqual([])
  })

  it('ignores an id it does not have', () => {
    const log = newLog()
    log.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'keep' })
    log.removeEntry('nope')
    expect(log.list()).toHaveLength(1)
  })
})
