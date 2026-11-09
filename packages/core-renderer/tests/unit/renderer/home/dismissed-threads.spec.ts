// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'

import {
  DISMISSED_THREADS_KEY,
  endedSessionsOfDismissed,
  isDismissed,
  useDismissedThreads,
} from '../../../../src/components/home/dismissed-threads'
import { storedDismissedOf } from '../../../../src/home/stored-shapes'
import type { WorkThread } from '../../../../src/home/work-threads'

const storedDismissed = (): unknown =>
  JSON.parse(localStorage.getItem(DISMISSED_THREADS_KEY) ?? '{}')

describe('useDismissedThreads', () => {
  beforeEach(() => {
    localStorage.clear()
    useDismissedThreads.setState({ dismissed: {} })
  })

  it('dismisses a thread at the time given and restores it', () => {
    useDismissedThreads.getState().dismiss('linear:TAV-20', 100, false)
    expect(useDismissedThreads.getState().dismissed).toEqual({ 'linear:TAV-20': 100 })
    expect(storedDismissed()).toEqual({ 'linear:TAV-20': 100 })
    useDismissedThreads.getState().restore('linear:TAV-20')
    expect(useDismissedThreads.getState().dismissed).toEqual({})
    expect(localStorage.getItem(DISMISSED_THREADS_KEY)).toBe('{}')
  })

  it('a dismissed thread stays dismissed whatever its sessions print afterwards', () => {
    useDismissedThreads.getState().dismiss('session:scratch', 100, false)
    const dismissed = useDismissedThreads.getState().dismissed
    const quiet = shown('session:scratch', [{ startedAt: 50, lastActivityAt: 90 }])
    const printedLater = shown('session:scratch', [{ startedAt: 50, lastActivityAt: 500 }])
    expect(isDismissed(dismissed, quiet)).toBe(true)
    expect(isDismissed(dismissed, printedLater)).toBe(true)
  })

  it('a thread nobody dismissed is not dismissed', () => {
    useDismissedThreads.getState().dismiss('session:scratch', 100, false)
    const { dismissed } = useDismissedThreads.getState()
    expect(isDismissed(dismissed, shown('session:other', []))).toBe(false)
  })
})

describe('isDismissed — a new session', () => {
  beforeEach(() => {
    localStorage.clear()
    useDismissedThreads.setState({ dismissed: {} })
  })

  // A branch row is keyed by repo and branch, so every later terminal on main joins a dismissed row.
  it('a session started after the dismissal brings the thread back', () => {
    useDismissedThreads.getState().dismiss('/repo#main', 100, false)
    const { dismissed } = useDismissedThreads.getState()
    const startedLater = shown('/repo#main', [{ startedAt: 50 }, { startedAt: 150 }])
    expect(isDismissed(dismissed, startedLater)).toBe(false)
  })
})

/** A thread with sessions started (and active) at the given epoch ms. */
function shown(key: string, sessions: Array<{ startedAt: number; lastActivityAt?: number }>) {
  return {
    key,
    sessions: sessions.map((s) => ({
      startedAt: new Date(s.startedAt).toISOString(),
      lastActivityAt: s.lastActivityAt ?? s.startedAt,
    })),
  } as unknown as WorkThread
}

describe('useDismissedThreads — forgetting', () => {
  beforeEach(() => {
    localStorage.clear()
    useDismissedThreads.setState({ dismissed: {} })
  })

  it('forgets entries whose thread is gone once their dismissal is 30 days old', () => {
    const now = 100 * 24 * 60 * 60 * 1000
    useDismissedThreads.getState().dismiss('gone-old', now - 31 * 24 * 60 * 60 * 1000, false)
    useDismissedThreads.getState().dismiss('gone-new', now - 24 * 60 * 60 * 1000, false)
    useDismissedThreads.getState().forgetGone(new Set(['gone-new']), now)
    expect(useDismissedThreads.getState().dismissed).toEqual({
      'gone-new': now - 24 * 60 * 60 * 1000,
    })
  })
})

describe('storedDismissedOf', () => {
  it('reads thread keys with the activity each was dismissed at', () => {
    expect(storedDismissedOf({ 'linear:TAV-20': 42 })).toEqual({ 'linear:TAV-20': 42 })
  })

  it.each([
    ['a list', ['linear:TAV-20']],
    ['a time that is not a number', { k: 'later' }],
    ['nothing', null],
  ])('refuses %s', (_name, value) => {
    expect(storedDismissedOf(value)).toBeNull()
  })
})

const thread = (key: string, sessions: Array<{ sessionId: string; isClosed: boolean }>) =>
  ({ key, sessions }) as unknown as WorkThread
/** A Terminator session row, and a pull request row with an ended session joined to it. */
const threads = [
  thread('session:a', [
    { sessionId: 'a-ended', isClosed: true },
    { sessionId: 'a-live', isClosed: false },
  ]),
  thread('github:pr-7', [{ sessionId: 'pr-joined-ended', isClosed: true }]),
]
const toDelete = (): string[] => {
  const { dismissed, deletesSessions } = useDismissedThreads.getState()
  return endedSessionsOfDismissed(threads, dismissed, deletesSessions)
}

describe('endedSessionsOfDismissed — only rows that showed Terminator sessions', () => {
  beforeEach(() => {
    localStorage.clear()
    useDismissedThreads.setState({ dismissed: {}, deletesSessions: {} })
  })

  it('deletes the ended sessions of a row dismissed while it showed sessions', () => {
    useDismissedThreads.getState().dismiss('session:a', 100, true)
    expect(toDelete()).toEqual(['a-ended'])
  })

  it('deletes nothing for a row that showed no sessions, such as a pull request', () => {
    useDismissedThreads.getState().dismiss('github:pr-7', 100, false)
    expect(toDelete()).toEqual([])
  })

  it('deletes nothing for a dismissal stored before dismissing deleted anything', () => {
    useDismissedThreads.setState({ dismissed: { 'session:a': 50 }, deletesSessions: {} })
    expect(toDelete()).toEqual([])
  })

  it('Undo stops the deletion', () => {
    useDismissedThreads.getState().dismiss('session:a', 100, true)
    useDismissedThreads.getState().restore('session:a')
    expect(toDelete()).toEqual([])
  })
})
