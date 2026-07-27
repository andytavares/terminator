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
