import { describe, it, expect } from 'vitest'
import {
  resultToSessionEvent,
  hookToSessionEvent,
} from '../../../../../src/main/supervision/agent-runtime/to-session-event.js'

// Translation from the agent runtime's shapes into the neutral SessionEvent.
// This is the only place that knows either shape, so it is the only place a
// runtime upgrade should touch (SC-007).

describe('result messages -> session_ended / turn_finished', () => {
  const success = {
    type: 'result' as const,
    subtype: 'success' as const,
    session_id: 's1',
    num_turns: 12,
    total_cost_usd: 3.5,
    is_error: false,
    result: 'done',
  }

  it('maps a successful result to turn_finished then session_ended', () => {
    const events = resultToSessionEvent(success, 900)
    expect(events.map((e) => e.kind)).toEqual(['turn_finished', 'session_ended'])
    expect(events[0]).toMatchObject({ turns: 12, costUsd: 3.5 })
    expect(events[1]).toMatchObject({ outcome: 'success' })
  })

  it.each([
    'error_max_turns',
    'error_during_execution',
    'error_max_budget_usd',
    'error_max_structured_output_retries',
  ])('maps the %s subtype to an error outcome carrying the reason', (subtype) => {
    const events = resultToSessionEvent(
      { ...success, subtype: subtype as 'success', is_error: true },
      900
    )
    const ended = events.find((e) => e.kind === 'session_ended')
    expect(ended).toMatchObject({ outcome: 'error', reason: subtype })
  })

  it('stamps every produced event with the supplied time, never a read clock', () => {
    for (const event of resultToSessionEvent(success, 4242)) expect(event.at).toBe(4242)
  })

  it('reports an unknown context proportion as null rather than zero', () => {
    const [turn] = resultToSessionEvent(success, 900)
    expect(turn).toMatchObject({ contextPct: null })
  })

  it('ignores a result with no session id rather than emitting an orphan event', () => {
    expect(resultToSessionEvent({ ...success, session_id: '' }, 900)).toEqual([])
  })
})

describe('hook inputs -> session events', () => {
  const base = { session_id: 's1', transcript_path: '/tmp/s1.jsonl', cwd: '/repo' }

  it('maps SessionStart, carrying the transcript path the runtime supplied', () => {
    const event = hookToSessionEvent({ ...base, hook_event_name: 'SessionStart' }, 100)
    // Never computed from the cwd — research.md R3.
    expect(event).toMatchObject({
      kind: 'session_started',
      transcriptPath: '/tmp/s1.jsonl',
      cwd: '/repo',
      at: 100,
    })
  })

  it('maps PreToolUse to tool_started with a stable call id', () => {
    const event = hookToSessionEvent(
      { ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'c1' },
      200
    )
    expect(event).toMatchObject({ kind: 'tool_started', toolName: 'Read', callId: 'c1' })
  })

  it('flags a shell tool as such, which is what makes the FR-015 exemption possible', () => {
    const event = hookToSessionEvent(
      { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'c1' },
      200
    )
    expect(event).toMatchObject({ isShell: true })
  })

  it('does not flag a non-shell tool as shell', () => {
    const event = hookToSessionEvent(
      { ...base, hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_use_id: 'c1' },
      200
    )
    expect(event).toMatchObject({ isShell: false })
  })

  it('maps PostToolUse to tool_finished with the matching call id', () => {
    const event = hookToSessionEvent(
      { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'c1' },
      300
    )
    expect(event).toMatchObject({ kind: 'tool_finished', callId: 'c1', ok: true })
  })

  it('returns null for a hook event that carries no supervision meaning', () => {
    expect(hookToSessionEvent({ ...base, hook_event_name: 'Notification' }, 400)).toBeNull()
  })

  it('returns null when the payload is not a hook input at all', () => {
    expect(hookToSessionEvent({ nonsense: true }, 400)).toBeNull()
    expect(hookToSessionEvent(null, 400)).toBeNull()
  })

  it('falls back to a synthesised call id when the runtime supplies none', () => {
    // Pairing matters more than the id's provenance: without one, an in-flight
    // shell call could never be closed and every long command would look stalled.
    const event = hookToSessionEvent(
      { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash' },
      200
    )
    expect(event).toMatchObject({ kind: 'tool_started' })
    expect((event as { callId: string }).callId).toBeTruthy()
  })
})
