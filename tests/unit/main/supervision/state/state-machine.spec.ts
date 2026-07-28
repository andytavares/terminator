import { describe, it, expect } from 'vitest'
import {
  initialSessionState,
  applyEvent,
  type SessionState,
} from '../../../../../src/main/supervision/state/state-machine.js'
import type { SessionEvent } from '../../../../../src/main/supervision/events/session-event.js'

// A pure reducer over SessionEvent (data-model.md §3). Every transition in the
// table is asserted here; nothing in this file touches a clock or the disk.

function at(t: number) {
  return t
}

const base = (): SessionState => initialSessionState('s1', at(0))

function reduce(events: SessionEvent[], from: SessionState = base()): SessionState {
  return events.reduce(applyEvent, from)
}

const started: SessionEvent = {
  kind: 'session_started',
  sessionId: 's1',
  transcriptPath: '/tmp/s1.jsonl',
  cwd: '/repo',
  at: at(100),
}

const toolStart = (t: number, callId = 'c1', isShell = false): SessionEvent => ({
  kind: 'tool_started',
  sessionId: 's1',
  toolName: isShell ? 'Bash' : 'Read',
  callId,
  isShell,
  at: at(t),
})

const toolEnd = (t: number, callId = 'c1'): SessionEvent => ({
  kind: 'tool_finished',
  sessionId: 's1',
  callId,
  ok: true,
  at: at(t),
})

describe('initial state', () => {
  it('starts in `starting`, because provisioning runs before the agent does', () => {
    const s = base()
    expect(s.runtimeState).toBe('starting')
    expect(s.stateSince).toBe(0)
  })
})

describe('setup outcome (FR-034)', () => {
  it('moves to `failed` when the setup command exits non-zero, retaining the output', () => {
    const s = reduce([
      { kind: 'setup_finished', sessionId: 's1', exitCode: 3, output: 'boom', at: at(50) },
    ])
    expect(s.runtimeState).toBe('failed')
    expect(s.failure).toEqual({ step: 'setup', exitCode: 3, output: 'boom' })
    expect(s.stateSince).toBe(50)
  })

  it('stays in `starting` on a clean setup, until the agent actually starts', () => {
    const s = reduce([
      { kind: 'setup_finished', sessionId: 's1', exitCode: 0, output: '', at: at(50) },
    ])
    expect(s.runtimeState).toBe('starting')
  })

  it('moves to `working` once the session starts', () => {
    const s = reduce([started])
    expect(s.runtimeState).toBe('working')
    expect(s.transcriptPath).toBe('/tmp/s1.jsonl')
  })
})

describe('permission requests (FR-007)', () => {
  it('moves to `needs_input` and records what is being requested', () => {
    const s = reduce([
      started,
      {
        kind: 'permission_requested',
        sessionId: 's1',
        requestId: 'r1',
        toolName: 'Bash',
        summary: 'redis-cli -h prod-cache-01',
        targetHost: 'prod-cache-01',
        at: at(200),
      },
    ])
    expect(s.runtimeState).toBe('needs_input')
    expect(s.pendingPermission?.summary).toBe('redis-cli -h prod-cache-01')
    expect(s.pendingPermission?.targetHost).toBe('prod-cache-01')
    expect(s.stateSince).toBe(200)
  })

  it('returns to `working` and clears the request once resolved', () => {
    const s = reduce([
      started,
      {
        kind: 'permission_requested',
        sessionId: 's1',
        requestId: 'r1',
        toolName: 'Bash',
        summary: 'ls',
        at: at(200),
      },
      {
        kind: 'permission_resolved',
        sessionId: 's1',
        requestId: 'r1',
        decision: 'allow',
        at: at(210),
      },
    ])
    expect(s.runtimeState).toBe('working')
    expect(s.pendingPermission).toBeNull()
  })

  it('ignores a resolution for a request it is not waiting on', () => {
    const s = reduce([
      started,
      {
        kind: 'permission_requested',
        sessionId: 's1',
        requestId: 'r1',
        toolName: 'Bash',
        summary: 'ls',
        at: at(200),
      },
      {
        kind: 'permission_resolved',
        sessionId: 's1',
        requestId: 'OTHER',
        decision: 'allow',
        at: at(210),
      },
    ])
    expect(s.runtimeState).toBe('needs_input')
    expect(s.pendingPermission?.requestId).toBe('r1')
  })
})

describe('tool activity', () => {
  it('records the time of the last tool call', () => {
    const s = reduce([started, toolStart(300)])
    expect(s.lastToolActivityAt).toBe(300)
  })

  it('tracks an in-flight shell call so its interval can be excluded from silence (FR-015)', () => {
    const s = reduce([started, toolStart(300, 'c1', true)])
    expect(s.openShellCallId).toBe('c1')
    expect(s.openShellStartedAt).toBe(300)
  })

  it('clears the in-flight marker when the matching call finishes', () => {
    const s = reduce([started, toolStart(300, 'c1', true), toolEnd(1000, 'c1')])
    expect(s.openShellCallId).toBeNull()
    expect(s.lastToolActivityAt).toBe(1000)
  })

  it('does not clear the marker when a different call finishes', () => {
    const s = reduce([started, toolStart(300, 'c1', true), toolEnd(400, 'c2')])
    expect(s.openShellCallId).toBe('c1')
  })

  it('does not track non-shell calls as in-flight commands', () => {
    const s = reduce([started, toolStart(300, 'c1', false)])
    expect(s.openShellCallId).toBeNull()
  })

  it('returns a stalled session to `working` on any tool activity', () => {
    const stalled: SessionState = { ...reduce([started]), runtimeState: 'stalled', stateSince: 500 }
    const s = applyEvent(stalled, toolStart(600))
    expect(s.runtimeState).toBe('working')
    expect(s.stateSince).toBe(600)
  })
})

describe('turn accounting (FR-008)', () => {
  it('accumulates turns, cost and remaining context', () => {
    const s = reduce([
      started,
      {
        kind: 'turn_finished',
        sessionId: 's1',
        turns: 12,
        costUsd: 3.5,
        contextPct: 61,
        at: at(400),
      },
    ])
    expect(s.turns).toBe(12)
    expect(s.costUsd).toBe(3.5)
    expect(s.contextPct).toBe(61)
  })
})

describe('session end (FR-045)', () => {
  it('moves to `ready` when it ends successfully with a non-empty diff', () => {
    const withDiff: SessionState = {
      ...reduce([started]),
      diffSummary: { files: 2, added: 9, removed: 1 },
    }
    const s = applyEvent(withDiff, {
      kind: 'session_ended',
      sessionId: 's1',
      outcome: 'success',
      at: at(900),
    })
    expect(s.runtimeState).toBe('ready')
  })

  it('does NOT move to `ready` when it ends with an empty diff — there is nothing to review', () => {
    const s = reduce([
      started,
      { kind: 'session_ended', sessionId: 's1', outcome: 'success', at: at(900) },
    ])
    expect(s.runtimeState).not.toBe('ready')
  })

  it('does not call an empty-diff session merged — no branch reached the trunk', () => {
    // Calling it `merged` would unblock downstream lanes waiting on a change
    // that was never made (FR-088, FR-090).
    const s = reduce([
      started,
      { kind: 'session_ended', sessionId: 's1', outcome: 'success', at: at(900) },
    ])
    expect(s.runtimeState).toBe('failed')
    expect(s.failure?.output).toMatch(/without changing anything/)
  })

  it('moves to `merged` only when the branch actually reached the trunk', () => {
    const s = reduce([
      started,
      {
        kind: 'turn_finished',
        sessionId: 's1',
        turns: 1,
        costUsd: 0,
        contextPct: null,
        at: at(800),
      },
      { kind: 'branch_merged', sessionId: 's1', unattended: false, at: at(900) },
    ])
    expect(s.runtimeState).toBe('merged')
  })

  it('records an unattended merge as a merge just the same', () => {
    const s = reduce([
      started,
      { kind: 'branch_merged', sessionId: 's1', unattended: true, at: at(900) },
    ])
    expect(s.runtimeState).toBe('merged')
  })

  it('moves to `failed` on an error outcome, keeping the reason', () => {
    const s = reduce([
      started,
      {
        kind: 'session_ended',
        sessionId: 's1',
        outcome: 'error',
        reason: 'error_max_turns',
        at: at(900),
      },
    ])
    expect(s.runtimeState).toBe('failed')
    expect(s.failure?.output).toBe('error_max_turns')
  })

  it('ends a session that was stalled just as cleanly', () => {
    const stalled: SessionState = {
      ...reduce([started]),
      runtimeState: 'stalled',
      diffSummary: { files: 1, added: 1, removed: 0 },
    }
    const s = applyEvent(stalled, {
      kind: 'session_ended',
      sessionId: 's1',
      outcome: 'success',
      at: at(900),
    })
    expect(s.runtimeState).toBe('ready')
  })
})

describe('purity', () => {
  it('never mutates the state it is given', () => {
    const before = reduce([started])
    const snapshot = JSON.parse(JSON.stringify(before))
    applyEvent(before, toolStart(999))
    expect(before).toEqual(snapshot)
  })

  it('ignores events belonging to another session', () => {
    const before = reduce([started])
    const after = applyEvent(before, { ...toolStart(999), sessionId: 'other' })
    expect(after).toBe(before)
  })

  it('only advances stateSince when the state actually changes', () => {
    const working = reduce([started])
    const after = applyEvent(working, toolStart(400))
    expect(after.stateSince).toBe(working.stateSince)
  })
})

describe('what the working copy has changed', () => {
  // Nothing reported this before, so the diff stayed at zero for a session's
  // whole life: `ready` was unreachable, every finished session was recorded as
  // having changed nothing, and the review queue could never fill.
  const measured = (
    over: Partial<{ files: number; added: number; removed: number; at: number }> = {}
  ) => ({
    kind: 'diff_measured' as const,
    sessionId: 's1',
    files: 2,
    added: 9,
    removed: 1,
    at: at(500),
    ...over,
  })

  it('records it', () => {
    expect(reduce([started, measured()]).diffSummary).toEqual({ files: 2, added: 9, removed: 1 })
  })

  it('is what lets a finished session reach review', () => {
    const s = reduce([
      started,
      measured(),
      { kind: 'session_ended', sessionId: 's1', outcome: 'success', at: at(900) },
    ])
    expect(s.runtimeState).toBe('ready')
  })

  it('still calls a session that changed nothing what it is', () => {
    const s = reduce([
      started,
      measured({ files: 0, added: 0, removed: 0 }),
      { kind: 'session_ended', sessionId: 's1', outcome: 'success', at: at(900) },
    ])
    expect(s.runtimeState).toBe('failed')
  })

  it('notes when the net change moved, which is what no-progress measures from', () => {
    expect(reduce([started, measured()]).lastNetChangeAt).toBe(at(500))
  })

  it('does not count a measurement that changed nothing as progress', () => {
    // Otherwise every poll resets the clock and the no-progress signal can
    // never fire at all.
    const s = reduce([started, measured(), measured({ at: at(800) })])
    expect(s.lastNetChangeAt).toBe(at(500))
  })

  it('notes progress again when the net change moves further', () => {
    const s = reduce([started, measured(), measured({ added: 20, at: at(800) })])
    expect(s.lastNetChangeAt).toBe(at(800))
  })

  it('notes a revert as progress too — the net moved, in the other direction', () => {
    const s = reduce([started, measured(), measured({ added: 1, at: at(800) })])
    expect(s.lastNetChangeAt).toBe(at(800))
  })
})

describe('finishing a turn offers the work for review', () => {
  // Running in a terminal the agent does not exit when it finishes — it sits at
  // its prompt. Waiting for the conversation to end meant work was never
  // offered for review until somebody closed the session by hand, so the
  // review queue stayed empty however much the agent did.
  const measured = {
    kind: 'diff_measured' as const,
    sessionId: 's1',
    files: 2,
    added: 9,
    removed: 1,
    at: at(500),
  }
  const turn = (over: Record<string, unknown> = {}) => ({
    kind: 'turn_finished' as const,
    sessionId: 's1',
    turns: 3,
    costUsd: 0,
    contextPct: null,
    at: at(600),
    ...over,
  })

  it('moves to `ready` when it finished a turn having changed something', () => {
    expect(reduce([started, measured, turn()]).runtimeState).toBe('ready')
  })

  it('stays put when it has changed nothing — there is nothing to look at', () => {
    expect(reduce([started, turn()]).runtimeState).not.toBe('ready')
  })

  it('does not call a session waiting on the operator ready', () => {
    const s = reduce([
      started,
      measured,
      {
        kind: 'permission_requested',
        sessionId: 's1',
        requestId: 'p1',
        toolName: 'Bash',
        summary: 'rm -rf /',
        at: at(550),
      },
      turn(),
    ])
    expect(s.runtimeState).toBe('needs_input')
  })

  it('offers a stalled session that produced work for review too', () => {
    const s = reduce([started, measured, turn()])
    expect(s.runtimeState).toBe('ready')
  })

  it('still counts the turn', () => {
    expect(reduce([started, measured, turn()]).turns).toBe(3)
  })

  it('goes back to work when the agent picks the task up again', () => {
    // Reversible on purpose: this says "there is something to look at", not
    // "this is over", and anything typed at the terminal carries it on.
    const s = reduce([
      started,
      measured,
      turn(),
      {
        kind: 'tool_started',
        sessionId: 's1',
        toolName: 'Edit',
        callId: 't2',
        isShell: false,
        at: at(700),
      },
    ])
    expect(s.runtimeState).toBe('working')
  })
})
