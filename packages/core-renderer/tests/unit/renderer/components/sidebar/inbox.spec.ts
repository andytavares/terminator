import { describe, it, expect } from 'vitest'
import { filterInbox, inboxSections } from '../../../../../src/components/sidebar/inbox'
import { AUTO_SETTLE_AFTER_MS, type WorkMarks } from '../../../../../src/home/settle'
import type { WorkThread } from '../../../../../src/home/work-threads'
import type { TaskState } from '../../../../../src/home/task-state'

const NOW = 10 * AUTO_SETTLE_AFTER_MS

interface ThreadFixture {
  state?: TaskState
  lastActivity?: number
  startedAt?: number
  repoRoot?: string
  branch?: string
}

function threadOf(key: string, fixture: ThreadFixture = {}): WorkThread {
  const { state = 'running', lastActivity = NOW, startedAt = 0 } = fixture
  const lane = {
    repoRoot: fixture.repoRoot ?? '/repos/api',
    repoName: 'api',
    branch: fixture.branch ?? key,
  }
  return {
    key,
    title: `Title ${key}`,
    state,
    lastActivity,
    startedAt,
    focus: false,
    lanes: [lane],
  } as unknown as WorkThread
}

const noMarks: WorkMarks = { settled: {}, pinned: {}, snoozed: {} }
const keysOf = (threads: readonly WorkThread[]) => threads.map((t) => t.key)

describe('inboxSections — order', () => {
  it('puts Needs you first, then pinned, then the rest, and settled last', () => {
    const threads = [
      threadOf('plain', { startedAt: 3 }),
      threadOf('pinned', { startedAt: 1 }),
      threadOf('asking', { state: 'needs-you', startedAt: 2 }),
      threadOf('settled', { startedAt: 4 }),
    ]
    const marks = { ...noMarks, pinned: { pinned: 1 }, settled: { settled: 1 } }
    const { cards, settled } = inboxSections(threads, marks, NOW)
    expect(keysOf(cards)).toEqual(['asking', 'pinned', 'plain'])
    expect(keysOf(settled)).toEqual(['settled'])
  })

  it('keeps a pinned thread at the top even when it has been quiet for days', () => {
    const quiet = threadOf('quiet', { lastActivity: NOW - 3 * AUTO_SETTLE_AFTER_MS })
    const { cards } = inboxSections([quiet], { ...noMarks, pinned: { quiet: 1 } }, NOW)
    expect(keysOf(cards)).toEqual(['quiet'])
  })

  it('lists a snoozed thread as settled until its time, then back on top', () => {
    const marks = { ...noMarks, snoozed: { later: NOW + 1000 } }
    expect(keysOf(inboxSections([threadOf('later')], marks, NOW).settled)).toEqual(['later'])
    expect(keysOf(inboxSections([threadOf('later')], marks, NOW + 1000).cards)).toEqual(['later'])
  })
})

describe('inboxSections — auto-settle', () => {
  it('settles a thread after 24 hours with no activity, not a minute before', () => {
    const almost = threadOf('almost', { lastActivity: NOW - AUTO_SETTLE_AFTER_MS + 60_000 })
    const stale = threadOf('stale', { lastActivity: NOW - AUTO_SETTLE_AFTER_MS })
    const { cards, settled } = inboxSections([almost, stale], noMarks, NOW)
    expect(keysOf(cards)).toEqual(['almost'])
    expect(keysOf(settled)).toEqual(['stale'])
  })

  it('never settles an unanswered ask on its own', () => {
    const asking = threadOf('asking', { state: 'needs-you', lastActivity: 0 })
    expect(keysOf(inboxSections([asking], noMarks, NOW).cards)).toEqual(['asking'])
  })

  it('brings an auto-settled thread back when it does something', () => {
    const woke = threadOf('woke', { lastActivity: NOW - 1000 })
    expect(keysOf(inboxSections([woke], noMarks, NOW).cards)).toEqual(['woke'])
  })
})

describe('filterInbox', () => {
  const threads = [
    threadOf('one', { repoRoot: '/repos/api', branch: 'fix-login' }),
    threadOf('two', { repoRoot: '/repos/web', branch: 'dark-mode' }),
  ]

  it('matches the text against title and branch', () => {
    expect(keysOf(filterInbox(threads, { text: 'login', repoRoot: null }))).toEqual(['one'])
    expect(keysOf(filterInbox(threads, { text: 'title two', repoRoot: null }))).toEqual(['two'])
  })

  it('keeps only the chosen repo', () => {
    expect(keysOf(filterInbox(threads, { text: '', repoRoot: '/repos/web' }))).toEqual(['two'])
    expect(keysOf(filterInbox(threads, { text: '', repoRoot: null }))).toEqual(['one', 'two'])
  })
})
