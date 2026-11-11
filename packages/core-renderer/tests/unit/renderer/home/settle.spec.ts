import { describe, it, expect } from 'vitest'
import {
  AUTO_SETTLE_AFTER_MS,
  isSettled,
  wokenKeys,
  type WorkMarks,
} from '../../../../src/home/settle'
import type { WorkThread } from '../../../../src/home/work-threads'
import type { TaskState } from '../../../../src/home/task-state'

const NOW = 10 * AUTO_SETTLE_AFTER_MS
const noMarks: WorkMarks = { settled: {}, pinned: {}, snoozed: {} }

function threadOf(key: string, patch: Partial<WorkThread> = {}): WorkThread {
  return { key, state: 'running', lastActivity: NOW, ...patch } as unknown as WorkThread
}

describe('isSettled', () => {
  it('settles a hand-settled thread and a snoozed one until its time', () => {
    expect(isSettled(threadOf('a'), { ...noMarks, settled: { a: 1 } }, NOW)).toBe(true)
    expect(isSettled(threadOf('a'), { ...noMarks, snoozed: { a: NOW + 1 } }, NOW)).toBe(true)
    expect(isSettled(threadOf('a'), { ...noMarks, snoozed: { a: NOW } }, NOW)).toBe(false)
  })

  it('settles a thread quiet for a day, but never a pinned one or an unanswered ask', () => {
    const quiet = { lastActivity: NOW - AUTO_SETTLE_AFTER_MS }
    expect(isSettled(threadOf('a', quiet), noMarks, NOW)).toBe(true)
    expect(isSettled(threadOf('a', quiet), { ...noMarks, pinned: { a: 1 } }, NOW)).toBe(false)
    expect(isSettled(threadOf('a', { ...quiet, state: 'needs-you' }), noMarks, NOW)).toBe(false)
  })
})

describe('wokenKeys', () => {
  it('names threads whose agent ended a turn or started asking', () => {
    const before = new Map<string, TaskState>([
      ['turn-ended', 'running'],
      ['asked', 'quiet'],
      ['still-running', 'running'],
      ['still-asking', 'needs-you'],
    ])
    const threads = [
      threadOf('turn-ended', { state: 'quiet' }),
      threadOf('asked', { state: 'needs-you' }),
      threadOf('still-running', { state: 'running' }),
      threadOf('still-asking', { state: 'needs-you' }),
      threadOf('new', { state: 'needs-you' }),
    ]
    expect(wokenKeys(before, threads)).toEqual(['turn-ended', 'asked'])
  })
})

describe('wokenKeys — facet activity', () => {
  it('does not wake a thread whose lastActivity moved while its state stayed the same', () => {
    const before = new Map<string, TaskState>([['a', 'quiet']])
    expect(wokenKeys(before, [threadOf('a', { state: 'quiet', lastActivity: NOW + 5 })])).toEqual(
      []
    )
  })
})
