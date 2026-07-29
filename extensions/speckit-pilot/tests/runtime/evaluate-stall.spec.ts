import { describe, it, expect } from 'vitest'
import {
  evaluateStall,
  DEFAULT_THRESHOLDS,
  type SessionFacts,
} from '../../src/runtime/evaluate-stall.js'

// The differentiating capability, and a pure function: (facts, thresholds, now).
// No clock, no I/O — every case below is a table row, not a timer.

const MIN = 60_000

function facts(over: Partial<SessionFacts> = {}): SessionFacts {
  return {
    sessionId: 's1',
    canStall: true,
    stateSince: 0,
    lastToolActivityAt: 0,
    lastNetChangeAt: 0,
    openShellStartedAt: null,
    recentToolPaths: [],
    recentNetChange: 1,
    recentReverts: 0,
    ...over,
  }
}

describe('silence signal (FR-012)', () => {
  it('does not fire below the threshold', () => {
    expect(evaluateStall(facts(), DEFAULT_THRESHOLDS, 7 * MIN)).toBeNull()
  })

  it('does not fire exactly at the threshold', () => {
    expect(evaluateStall(facts(), DEFAULT_THRESHOLDS, 8 * MIN)).toBeNull()
  })

  it('fires past the threshold, naming the signal and its inputs', () => {
    const firing = evaluateStall(facts(), DEFAULT_THRESHOLDS, 9 * MIN)
    expect(firing).toMatchObject({ sessionId: 's1', signal: 'silence' })
    expect(firing?.inputs.toolSilenceMs).toBe(9 * MIN)
  })

  it('honours a raised per-repository threshold (FR-016)', () => {
    const thresholds = { ...DEFAULT_THRESHOLDS, silenceMs: 20 * MIN }
    expect(evaluateStall(facts(), thresholds, 9 * MIN)).toBeNull()
    expect(evaluateStall(facts(), thresholds, 21 * MIN)?.signal).toBe('silence')
  })

  it('treats a session that has never recorded activity as silent from its start', () => {
    const firing = evaluateStall(facts({ lastToolActivityAt: null }), DEFAULT_THRESHOLDS, 9 * MIN)
    expect(firing?.signal).toBe('silence')
  })

  it('measures that silence from when it started, not from the epoch', () => {
    // Falling back to zero measured from 1970: a session that had not yet made
    // its first tool call reported fifty-six years of silence and stalled the
    // instant it started, every time.
    const firing = evaluateStall(
      facts({ stateSince: 8 * MIN, lastToolActivityAt: null }),
      DEFAULT_THRESHOLDS,
      18 * MIN
    )
    expect(firing?.inputs.toolSilenceMs).toBe(10 * MIN)
  })

  it('gives a session that has just started time to make its first tool call', () => {
    const justStarted = facts({ stateSince: 100 * MIN, lastToolActivityAt: null })
    expect(evaluateStall(justStarted, DEFAULT_THRESHOLDS, 100 * MIN + 30_000)).toBeNull()
  })

  it('measures a session that has changed nothing from its start too', () => {
    const firing = evaluateStall(
      facts({ stateSince: 8 * MIN, lastNetChangeAt: null }),
      DEFAULT_THRESHOLDS,
      18 * MIN
    )
    expect(firing?.inputs.diffSilenceMs).toBe(10 * MIN)
  })
})

describe('the long-running-command exemption (FR-015)', () => {
  // The spec calls this "the obvious first bug" and quickstart.md makes it the
  // gate on shipping stall detection at all: if a 12-minute test suite reads as
  // a stall, the feature is unusable and must not ship.
  it('does NOT fire while a shell command has been in flight for 12 minutes', () => {
    const f = facts({ lastToolActivityAt: 0, openShellStartedAt: 0 })
    expect(evaluateStall(f, DEFAULT_THRESHOLDS, 12 * MIN)).toBeNull()
  })

  it('does not fire even for an extremely long command', () => {
    const f = facts({ lastToolActivityAt: 0, openShellStartedAt: 0 })
    expect(evaluateStall(f, DEFAULT_THRESHOLDS, 120 * MIN)).toBeNull()
  })

  it('resumes counting silence from when the command finished, not from before it', () => {
    // Command ran 0→12min, then nothing for 2 more minutes: not yet a stall.
    const f = facts({ lastToolActivityAt: 12 * MIN, openShellStartedAt: null })
    expect(evaluateStall(f, DEFAULT_THRESHOLDS, 14 * MIN)).toBeNull()
    expect(evaluateStall(f, DEFAULT_THRESHOLDS, 21 * MIN)?.signal).toBe('silence')
  })

  it('still fires the loop signal while a command is in flight, since that is a different failure', () => {
    const f = facts({
      openShellStartedAt: 0,
      lastNetChangeAt: 0,
      recentToolPaths: ['a.ts', 'a.ts', 'a.ts'],
      recentNetChange: 0,
    })
    expect(evaluateStall(f, DEFAULT_THRESHOLDS, 16 * MIN)?.signal).toBe('loop')
  })
})

describe('loop signal (FR-013)', () => {
  const looping = { recentToolPaths: ['a.ts', 'a.ts', 'a.ts'], recentNetChange: 0 }

  it('fires when one file is touched repeatedly with no net change past the threshold', () => {
    const firing = evaluateStall(facts(looping), DEFAULT_THRESHOLDS, 16 * MIN)
    expect(firing).toMatchObject({ signal: 'loop' })
    expect(firing?.inputs.distinctFiles).toBe(1)
  })

  it('does not fire the loop signal before the no-progress threshold', () => {
    // Silence legitimately fires here (14 min > 8 min); what must not happen is
    // the loop diagnosis being reported before its own threshold is met.
    const f = facts({ ...looping, lastToolActivityAt: 13 * MIN })
    expect(evaluateStall(f, DEFAULT_THRESHOLDS, 14 * MIN)).toBeNull()
  })

  it('does not fire when more than one file is being touched', () => {
    const f = facts({ recentToolPaths: ['a.ts', 'b.ts'], recentNetChange: 0 })
    // Working across files is progress, however slow.
    expect(evaluateStall(f, DEFAULT_THRESHOLDS, 16 * MIN)?.signal).not.toBe('loop')
  })

  it('does not fire when the work is producing net change', () => {
    const f = facts({ recentToolPaths: ['a.ts', 'a.ts'], recentNetChange: 12 })
    expect(evaluateStall(f, DEFAULT_THRESHOLDS, 16 * MIN)?.signal).not.toBe('loop')
  })

  it('does not fire when no tool calls have been recorded at all', () => {
    const f = facts({ recentToolPaths: [], recentNetChange: 0, lastToolActivityAt: 16 * MIN })
    expect(evaluateStall(f, DEFAULT_THRESHOLDS, 16 * MIN)).toBeNull()
  })
})

describe('revert signal (FR-014)', () => {
  it('fires at two self-reverts within the window', () => {
    const firing = evaluateStall(facts({ recentReverts: 2 }), DEFAULT_THRESHOLDS, MIN)
    expect(firing).toMatchObject({ signal: 'revert' })
    expect(firing?.inputs.reverts).toBe(2)
  })

  it('does not fire at one revert', () => {
    expect(evaluateStall(facts({ recentReverts: 1 }), DEFAULT_THRESHOLDS, MIN)).toBeNull()
  })

  it('fires regardless of how recently the agent was active', () => {
    const f = facts({ recentReverts: 3, lastToolActivityAt: MIN })
    expect(evaluateStall(f, DEFAULT_THRESHOLDS, MIN)?.signal).toBe('revert')
  })
})

describe('runs that cannot stall', () => {
  it.each([true])(
    'never fires for a run that is waiting on a person or already finished (%s)',
    () => {
      // Waiting on the operator is blocked, not stuck; a run that has ended is
      // finished; one already reported is not reported twice.
      expect(evaluateStall(facts({ canStall: false }), DEFAULT_THRESHOLDS, 60 * MIN)).toBeNull()
    }
  )
})

describe('signal precedence', () => {
  it('reports revert first when several conditions hold, as the most specific diagnosis', () => {
    const f = facts({
      recentReverts: 2,
      recentToolPaths: ['a.ts', 'a.ts'],
      recentNetChange: 0,
      lastToolActivityAt: 0,
    })
    expect(evaluateStall(f, DEFAULT_THRESHOLDS, 60 * MIN)?.signal).toBe('revert')
  })
})

describe('purity', () => {
  it('does not mutate the facts it is given', () => {
    const f = facts({ recentToolPaths: ['a.ts'] })
    const snapshot = JSON.parse(JSON.stringify(f))
    evaluateStall(f, DEFAULT_THRESHOLDS, 60 * MIN)
    expect(f).toEqual(snapshot)
  })

  it('is deterministic for the same inputs', () => {
    const f = facts()
    const a = evaluateStall(f, DEFAULT_THRESHOLDS, 9 * MIN)
    const b = evaluateStall(f, DEFAULT_THRESHOLDS, 9 * MIN)
    expect(a).toEqual(b)
  })
})
