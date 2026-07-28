import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStallScheduler } from '../../../../../src/main/supervision/stall/stall-scheduler.js'
import type { SupervisedSession } from '../../../../../src/shared/types/supervision.js'

// FR-011: every active session is evaluated on a fixed tick of at most 30s.

function session(over: Partial<SupervisedSession> = {}): SupervisedSession {
  return {
    id: 's1',
    workItemId: null,
    laneOrd: null,
    repoPath: '/repo',
    worktreePath: '/wt/s1',
    branch: 'feat/x',
    transcriptPath: '/tmp/s1.jsonl',
    runtimeState: 'working',
    stateSince: 0,
    lastToolActivityAt: 0,
    lastNetChangeAt: 0,
    openShellCallId: null,
    turns: 0,
    costUsd: 0,
    contextPct: null,
    pendingPermission: null,
    diffSummary: { files: 0, added: 0, removed: 0 },
    autonomyLevel: 'edit',
    lastViewedAt: null,
    terminalSessionId: null,
    projectId: null,
    failure: null,
    ...over,
  }
}

const thresholds = { silenceMs: 480_000, noProgressMs: 900_000 }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function harness(sessions: SupervisedSession[], now = () => 9 * 60_000) {
  const onFiring = vi.fn()
  const scheduler = createStallScheduler({
    listSessions: () => sessions,
    thresholdsFor: () => thresholds,
    onFiring,
    now,
  })
  return { scheduler, onFiring }
}

describe('the tick', () => {
  it('evaluates on a fixed interval of at most 30 seconds (FR-011)', () => {
    const { scheduler, onFiring } = harness([session()])
    scheduler.start()
    expect(onFiring).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_000)
    expect(onFiring).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_000)
    expect(onFiring).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('stops evaluating once stopped', () => {
    const { scheduler, onFiring } = harness([session()])
    scheduler.start()
    vi.advanceTimersByTime(30_000)
    scheduler.stop()
    vi.advanceTimersByTime(120_000)
    expect(onFiring).toHaveBeenCalledTimes(1)
  })

  it('does not stack timers when started twice', () => {
    const { scheduler, onFiring } = harness([session()])
    scheduler.start()
    scheduler.start()
    vi.advanceTimersByTime(30_000)
    expect(onFiring).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })

  it('is safe to stop when never started', () => {
    const { scheduler } = harness([])
    expect(() => scheduler.stop()).not.toThrow()
  })
})

describe('what gets evaluated', () => {
  it('skips sessions that cannot stall', () => {
    const { scheduler, onFiring } = harness([
      session({ id: 'ready', runtimeState: 'ready' }),
      session({ id: 'blocked', runtimeState: 'needs_input' }),
    ])
    scheduler.start()
    vi.advanceTimersByTime(30_000)
    expect(onFiring).not.toHaveBeenCalled()
    scheduler.stop()
  })

  it('reports one firing per stalled session', () => {
    const { scheduler, onFiring } = harness([session({ id: 'a' }), session({ id: 'b' })])
    scheduler.start()
    vi.advanceTimersByTime(30_000)
    expect(onFiring.mock.calls.map((c) => c[0].sessionId).sort()).toEqual(['a', 'b'])
    scheduler.stop()
  })

  it('excludes a session with a shell command in flight (FR-015)', () => {
    const { scheduler, onFiring } = harness([session({ openShellCallId: 'c1' })])
    scheduler.start()
    vi.advanceTimersByTime(30_000)
    expect(onFiring).not.toHaveBeenCalled()
    scheduler.stop()
  })

  it('uses the thresholds for each session own repository (FR-016)', () => {
    const thresholdsFor = vi.fn().mockReturnValue({ silenceMs: 60 * 60_000, noProgressMs: 1e9 })
    const onFiring = vi.fn()
    const scheduler = createStallScheduler({
      listSessions: () => [session({ repoPath: '/slow-repo' })],
      thresholdsFor,
      onFiring,
      now: () => 9 * 60_000,
    })
    scheduler.start()
    vi.advanceTimersByTime(30_000)
    expect(thresholdsFor).toHaveBeenCalledWith('/slow-repo')
    expect(onFiring).not.toHaveBeenCalled()
    scheduler.stop()
  })

  it('keeps ticking when one session throws during evaluation', () => {
    const onFiring = vi.fn().mockImplementationOnce(() => {
      throw new Error('handler blew up')
    })
    const scheduler = createStallScheduler({
      listSessions: () => [session({ id: 'a' }), session({ id: 'b' })],
      thresholdsFor: () => thresholds,
      onFiring,
      now: () => 9 * 60_000,
    })
    scheduler.start()
    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow()
    expect(onFiring).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })
})
