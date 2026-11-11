// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { shownThreads, useWakeOnActivity } from '../../../../src/components/home/useWorkThreads'
import { useWorkMarks } from '../../../../src/home/work-marks'
import { AUTO_SETTLE_AFTER_MS } from '../../../../src/home/settle'
import type { WorkThread, WorkThreadInput } from '../../../../src/home/work-threads'
import { fact } from '../sidebar/fixtures/facts'

const NOW = Date.parse('2026-10-18T12:00:00.000Z')
const input = (facts: unknown[]): WorkThreadInput =>
  ({
    facts,
    facets: [],
    issues: [],
    changeStats: new Map(),
    tasks: [],
    repoRoots: new Map([['p1', '/repos/terminator']]),
    repos: new Map(),
    now: NOW,
  }) as unknown as WorkThreadInput

const sessionOn = (branch: string, ageMs: number) =>
  fact({ sessionId: branch, state: 'working', branch, lastActivityAt: NOW - ageMs })

beforeEach(() => {
  useWorkMarks.setState({ settled: {}, pinned: {}, snoozed: {} })
})

describe('shownThreads', () => {
  const facts = [
    sessionOn('fresh', 1000),
    sessionOn('by-hand', 1000),
    sessionOn('quiet', AUTO_SETTLE_AFTER_MS + 1000),
    sessionOn('pinned-quiet', AUTO_SETTLE_AFTER_MS + 1000),
  ]

  it('moves hand-settled and day-quiet threads to settledThreads and keeps a pinned quiet one', () => {
    const keyOf = (branch: string): string => `/repos/terminator#${branch}`
    const marks = {
      settled: { [keyOf('by-hand')]: 1 },
      pinned: { [keyOf('pinned-quiet')]: 1 },
      snoozed: {},
    }
    const { threads, settledThreads } = shownThreads(input(facts), [], marks)
    expect(settledThreads.map((t) => t.key).sort()).toEqual([keyOf('by-hand'), keyOf('quiet')])
    expect(threads.map((t) => t.key).sort()).toEqual([keyOf('fresh'), keyOf('pinned-quiet')])
  })
})

describe('useWakeOnActivity', () => {
  const threadOf = (state: string) => [{ key: 'a', state }] as unknown as WorkThread[]

  it('wakes a settled thread when its state leaves running', () => {
    useWorkMarks.setState({ settled: { a: 1 } })
    const { rerender } = renderHook(({ t }) => useWakeOnActivity(t), {
      initialProps: { t: threadOf('running') },
    })
    expect(useWorkMarks.getState().settled).toEqual({ a: 1 })
    rerender({ t: threadOf('quiet') })
    expect(useWorkMarks.getState().settled).toEqual({})
  })

  it('wakes a settled thread when it starts asking', () => {
    useWorkMarks.setState({ settled: { a: 1 } })
    const { rerender } = renderHook(({ t }) => useWakeOnActivity(t), {
      initialProps: { t: threadOf('quiet') },
    })
    rerender({ t: threadOf('needs-you') })
    expect(useWorkMarks.getState().settled).toEqual({})
  })
})
