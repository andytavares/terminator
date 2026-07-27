import { describe, it, expect, vi } from 'vitest'
import { buildSupervisionHooks } from '../../../../../src/main/supervision/agent-runtime/hooks.js'
import type { SessionEvent } from '../../../../../src/main/supervision/events/session-event.js'

// Hooks are the supplementary source (research.md R1c): they give us
// SessionStart — and with it the transcript path — plus the PreToolUse /
// PostToolUse pair the long-command exemption depends on.

function harness() {
  const events: SessionEvent[] = []
  const hooks = buildSupervisionHooks({ publish: (e) => events.push(e), now: () => 1_000 })
  return { hooks, events }
}

const base = { session_id: 's1', transcript_path: '/tmp/s1.jsonl', cwd: '/repo' }

async function fire(
  hooks: ReturnType<typeof buildSupervisionHooks>,
  eventName: string,
  input: Record<string, unknown>
): Promise<void> {
  const matchers = (hooks as Record<string, Array<{ hooks: Array<(i: unknown) => unknown> }>>)[
    eventName
  ]
  for (const matcher of matchers ?? []) {
    for (const callback of matcher.hooks) await callback(input)
  }
}

describe('registered hook events', () => {
  it('registers exactly the events supervision needs, and no others', () => {
    const { hooks } = harness()
    expect(Object.keys(hooks).sort()).toEqual(['PostToolUse', 'PreToolUse', 'SessionStart'])
  })
})

describe('SessionStart', () => {
  it('publishes session_started carrying the runtime-supplied transcript path', async () => {
    const { hooks, events } = harness()
    await fire(hooks, 'SessionStart', { ...base, hook_event_name: 'SessionStart' })
    expect(events[0]).toMatchObject({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/tmp/s1.jsonl',
    })
  })
})

describe('tool pairing (FR-015)', () => {
  it('publishes tool_started with a shell flag for a shell tool', async () => {
    const { hooks, events } = harness()
    await fire(hooks, 'PreToolUse', {
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'c1',
    })
    expect(events[0]).toMatchObject({ kind: 'tool_started', isShell: true, callId: 'c1' })
  })

  it('publishes tool_finished with the same call id, closing the interval', async () => {
    const { hooks, events } = harness()
    await fire(hooks, 'PostToolUse', {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'c1',
    })
    expect(events[0]).toMatchObject({ kind: 'tool_finished', callId: 'c1' })
  })
})

describe('hook callbacks are inert observers', () => {
  it('always returns a continue decision, so supervision never blocks the agent', async () => {
    const { hooks } = harness()
    const matcher = (
      hooks as Record<string, Array<{ hooks: Array<(i: unknown) => Promise<unknown>> }>>
    ).PreToolUse[0]
    const result = await matcher.hooks[0]({
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_use_id: 'c1',
    })
    expect(result).toEqual({ continue: true })
  })

  it('publishes nothing, and still continues, for an unrecognised payload', async () => {
    const { hooks, events } = harness()
    await fire(hooks, 'PreToolUse', { garbage: true })
    expect(events).toEqual([])
  })

  it('does not let a publish failure propagate into the agent run', async () => {
    // A surface throwing must never take down the session it is observing.
    const hooks = buildSupervisionHooks({
      publish: () => {
        throw new Error('bus exploded')
      },
      now: () => 1_000,
    })
    await expect(
      fire(hooks, 'SessionStart', { ...base, hook_event_name: 'SessionStart' })
    ).resolves.toBeUndefined()
  })
})

describe('clock injection', () => {
  it('stamps events from the supplied clock rather than reading one', async () => {
    const events: SessionEvent[] = []
    const now = vi.fn().mockReturnValue(4_242)
    const hooks = buildSupervisionHooks({ publish: (e) => events.push(e), now })
    await fire(hooks, 'SessionStart', { ...base, hook_event_name: 'SessionStart' })
    expect(events[0].at).toBe(4_242)
    expect(now).toHaveBeenCalled()
  })
})
