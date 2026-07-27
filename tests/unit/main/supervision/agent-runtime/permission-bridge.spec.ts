import { describe, it, expect, vi } from 'vitest'
import { createPermissionBridge } from '../../../../../src/main/supervision/agent-runtime/permission-bridge.js'
import type { SessionEvent } from '../../../../../src/main/supervision/events/session-event.js'

// canUseTool is the only documented source of "this agent is blocked on you"
// (FR-010 — the Notification hook does not fire for permission prompts). This
// bridge turns that callback into console state and back into a decision.

function harness() {
  const events: SessionEvent[] = []
  let now = 1_000
  const bridge = createPermissionBridge({
    sessionId: 's1',
    publish: (e) => events.push(e),
    now: () => now,
  })
  return { bridge, events, setNow: (t: number) => (now = t) }
}

describe('raising a request', () => {
  it('publishes permission_requested naming the tool and what it wants to do', async () => {
    const { bridge, events } = harness()
    const pending = bridge.canUseTool('Bash', { command: 'redis-cli -h prod-cache-01' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'permission_requested',
      sessionId: 's1',
      toolName: 'Bash',
      summary: expect.stringContaining('redis-cli'),
    })
    bridge.resolve((events[0] as { requestId: string }).requestId, { allow: true })
    await pending
  })

  it('extracts the target host so the allowlist check has something to work with (FR-042)', async () => {
    const { bridge, events } = harness()
    const pending = bridge.canUseTool('WebFetch', { url: 'https://example.com/x' })
    expect(events[0]).toMatchObject({ targetHost: 'example.com' })
    bridge.resolve((events[0] as { requestId: string }).requestId, { allow: true })
    await pending
  })

  it('summarises a tool with no obvious payload without throwing', async () => {
    const { bridge, events } = harness()
    const pending = bridge.canUseTool('Read', {})
    expect((events[0] as { summary: string }).summary.length).toBeGreaterThan(0)
    bridge.resolve((events[0] as { requestId: string }).requestId, { allow: true })
    await pending
  })

  it('issues a distinct request id per call so two prompts cannot collide', async () => {
    const { bridge, events } = harness()
    const a = bridge.canUseTool('Bash', { command: 'one' })
    const b = bridge.canUseTool('Bash', { command: 'two' })
    const ids = events.map((e) => (e as { requestId: string }).requestId)
    expect(new Set(ids).size).toBe(2)
    ids.forEach((id) => bridge.resolve(id, { allow: true }))
    await Promise.all([a, b])
  })
})

describe('resolving a request', () => {
  it('allowing returns the documented allow shape with the input unchanged', async () => {
    const { bridge, events } = harness()
    const input = { command: 'ls' }
    const pending = bridge.canUseTool('Bash', input)
    bridge.resolve((events[0] as { requestId: string }).requestId, { allow: true })
    await expect(pending).resolves.toEqual({ behavior: 'allow', updatedInput: input })
  })

  it('denying returns the documented deny shape carrying the reason', async () => {
    const { bridge, events } = harness()
    const pending = bridge.canUseTool('Bash', { command: 'rm -rf /' })
    bridge.resolve((events[0] as { requestId: string }).requestId, {
      allow: false,
      reason: 'operator declined',
    })
    await expect(pending).resolves.toEqual({
      behavior: 'deny',
      message: 'operator declined',
      interrupt: false,
    })
  })

  it('denying with interrupt sets the flag, which is how a redirect stops the turn', async () => {
    const { bridge, events } = harness()
    const pending = bridge.canUseTool('Bash', { command: 'x' })
    bridge.resolve((events[0] as { requestId: string }).requestId, {
      allow: false,
      reason: 'redirecting',
      interrupt: true,
    })
    await expect(pending).resolves.toMatchObject({ behavior: 'deny', interrupt: true })
  })

  it('publishes permission_resolved so the state machine can leave needs_input', async () => {
    const { bridge, events } = harness()
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    const requestId = (events[0] as { requestId: string }).requestId
    bridge.resolve(requestId, { allow: true })
    await pending
    expect(events[1]).toMatchObject({ kind: 'permission_resolved', requestId, decision: 'allow' })
  })

  it('ignores a resolution for an unknown request', async () => {
    const { bridge, events } = harness()
    expect(() => bridge.resolve('never-issued', { allow: true })).not.toThrow()
    expect(events).toHaveLength(0)
  })

  it('ignores a second resolution of the same request', async () => {
    const { bridge, events } = harness()
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    const requestId = (events[0] as { requestId: string }).requestId
    bridge.resolve(requestId, { allow: true })
    await pending
    bridge.resolve(requestId, { allow: false, reason: 'too late' })
    expect(events.filter((e) => e.kind === 'permission_resolved')).toHaveLength(1)
  })
})

describe('auto-decision by the autonomy ladder', () => {
  it('resolves without ever publishing a request when the decider allows it', async () => {
    const events: SessionEvent[] = []
    const bridge = createPermissionBridge({
      sessionId: 's1',
      publish: (e) => events.push(e),
      now: () => 1_000,
      autoDecide: () => ({ allow: true }),
    })
    await expect(bridge.canUseTool('Read', {})).resolves.toMatchObject({ behavior: 'allow' })
    // No prompt was raised, so the operator was never interrupted.
    expect(events.filter((e) => e.kind === 'permission_requested')).toHaveLength(0)
  })

  it('still prompts when the decider abstains', async () => {
    const events: SessionEvent[] = []
    const autoDecide = vi.fn().mockReturnValue(null)
    const bridge = createPermissionBridge({
      sessionId: 's1',
      publish: (e) => events.push(e),
      now: () => 1_000,
      autoDecide,
    })
    const pending = bridge.canUseTool('Bash', { command: 'x' })
    expect(autoDecide).toHaveBeenCalled()
    expect(events[0]).toMatchObject({ kind: 'permission_requested' })
    bridge.resolve((events[0] as { requestId: string }).requestId, { allow: true })
    await pending
  })
})

describe('shutdown', () => {
  it('denies every outstanding request when the session is torn down', async () => {
    const { bridge } = harness()
    const pending = bridge.canUseTool('Bash', { command: 'x' })
    bridge.rejectAll('session ended')
    // Leaving a promise unresolved would hang the runtime's turn forever.
    await expect(pending).resolves.toMatchObject({ behavior: 'deny' })
  })
})

// FR-007. Deciding requires seeing the ask. "AskUserQuestion request" is the
// tool's name, not its question — you cannot approve or deny that.

describe('what the operator is told is being asked', () => {
  function ask(toolName: string, input: unknown) {
    const events: SessionEvent[] = []
    const bridge = createPermissionBridge({
      sessionId: 's1',
      publish: (event) => events.push(event),
      now: () => 1_000,
    })
    void bridge.canUseTool(toolName, input)
    return events.find((event) => event.kind === 'permission_requested') as {
      summary: string
      detail?: string | null
    }
  }

  it('leads with the question itself', () => {
    const event = ask('AskUserQuestion', {
      questions: [{ question: 'Which database should the worker write to?', options: [] }],
    })
    expect(event.summary).toBe('Which database should the worker write to?')
  })

  it('carries the options, which are most of what you need to answer', () => {
    const event = ask('AskUserQuestion', {
      questions: [
        {
          question: 'Which database?',
          options: [{ label: 'Postgres' }, { label: 'SQLite' }],
        },
      ],
    })
    expect(event.detail).toContain('Postgres')
    expect(event.detail).toContain('SQLite')
  })

  it('carries every question when more than one is asked', () => {
    const event = ask('AskUserQuestion', {
      questions: [{ question: 'First?' }, { question: 'Second?' }],
    })
    expect(event.detail).toContain('First?')
    expect(event.detail).toContain('Second?')
  })

  it('still leads with the command for a shell request', () => {
    const event = ask('Bash', { command: 'redis-cli -h prod-cache-01 FLUSHALL' })
    expect(event.summary).toBe('redis-cli -h prod-cache-01 FLUSHALL')
  })

  it('carries a command’s description as the detail', () => {
    const event = ask('Bash', { command: 'rm -rf build', description: 'Clean the build output' })
    expect(event.detail).toBe('Clean the build output')
  })

  it('shows the input of a tool it does not recognise, rather than only its name', () => {
    // An unfamiliar tool is exactly when you most need to see what it wants.
    const event = ask('SomeNewTool', { target: 'production', mode: 'destructive' })
    expect(event.detail).toContain('target: production')
    expect(event.detail).toContain('mode: destructive')
  })

  it('bounds a very long value rather than pasting it whole', () => {
    const event = ask('SomeNewTool', { blob: 'x'.repeat(5_000) })
    expect(event.detail?.length ?? 0).toBeLessThan(400)
    expect(event.detail).toContain('…')
  })

  it('bounds how many fields it shows', () => {
    const input = Object.fromEntries(
      Array.from({ length: 40 }, (_, index) => [`field${index}`, String(index)])
    )
    const event = ask('SomeNewTool', input)
    expect((event.detail ?? '').split('\n')).toHaveLength(8)
  })

  it('has no detail to show when the input is not an object', () => {
    const event = ask('SomeNewTool', 'just a string')
    expect(event.summary).toBe('SomeNewTool request')
    expect(event.detail).toBeNull()
  })

  it('ignores an empty question list rather than claiming a question was asked', () => {
    const event = ask('AskUserQuestion', { questions: [] })
    expect(event.summary).toBe('AskUserQuestion request')
  })

  it('falls back to the tool name when the questions carry no text', () => {
    const event = ask('AskUserQuestion', { questions: [{ options: [] }] })
    expect(event.summary).toBe('AskUserQuestion request')
  })
})

// canUseTool has exactly two ways back to the agent: allow with an updated
// input, or deny with a message. The message is the only channel that carries
// words, so a real answer travels as a denial whose message is the answer.

describe('answering rather than approving', () => {
  function bridgeFor() {
    const events: SessionEvent[] = []
    const bridge = createPermissionBridge({
      sessionId: 's1',
      publish: (event) => events.push(event),
      now: () => 1_000,
    })
    return { bridge, events }
  }

  function requestIdOf(events: SessionEvent[]): string {
    const event = events.find((e) => e.kind === 'permission_requested') as { requestId: string }
    return event.requestId
  }

  it('sends the answer to the agent as the message', async () => {
    const { bridge, events } = bridgeFor()
    const pending = bridge.canUseTool('AskUserQuestion', {
      questions: [{ question: 'Which scope?' }],
    })
    bridge.resolve(requestIdOf(events), { allow: false, answer: 'terminal output only' })
    await expect(pending).resolves.toEqual({
      behavior: 'deny',
      message: 'terminal output only',
      interrupt: false,
    })
  })

  it('never interrupts the run for an answer — the agent carries on with it', async () => {
    const { bridge, events } = bridgeFor()
    const pending = bridge.canUseTool('Bash', { command: 'rm -rf build' })
    bridge.resolve(requestIdOf(events), { allow: false, answer: 'use dist/ instead' })
    await expect(pending).resolves.toMatchObject({ interrupt: false })
  })

  it('ignores an empty answer and behaves as the decision says', async () => {
    const { bridge, events } = bridgeFor()
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    bridge.resolve(requestIdOf(events), { allow: true, answer: '   ' })
    await expect(pending).resolves.toMatchObject({ behavior: 'allow' })
  })

  function questionsOn(events: SessionEvent[]) {
    const event = events.find((e) => e.kind === 'permission_requested') as {
      questions?: ReadonlyArray<{ question: string; options: readonly string[] }>
    }
    return event.questions
  }

  it('publishes each question with its own options, so an answer can name it', () => {
    const { bridge, events } = bridgeFor()
    void bridge.canUseTool('AskUserQuestion', {
      questions: [
        { question: 'Which scope?', options: [{ label: 'App-wide' }, { label: 'Terminal' }] },
      ],
    })
    expect(questionsOn(events)).toEqual([
      { question: 'Which scope?', options: ['App-wide', 'Terminal'] },
    ])
  })

  it('keeps two questions apart rather than piling their options together', () => {
    // Flattened, clicking "Yes" would not say which question it answered.
    const { bridge, events } = bridgeFor()
    void bridge.canUseTool('AskUserQuestion', {
      questions: [
        { question: 'A?', options: [{ label: 'Yes' }] },
        { question: 'B?', options: [{ label: 'Yes' }, { label: 'No' }] },
      ],
    })
    expect(questionsOn(events)).toEqual([
      { question: 'A?', options: ['Yes'] },
      { question: 'B?', options: ['Yes', 'No'] },
    ])
  })

  it('offers no questions for a request that is a plain yes or no', () => {
    const { bridge, events } = bridgeFor()
    void bridge.canUseTool('Bash', { command: 'ls' })
    expect(questionsOn(events)).toBeUndefined()
  })

  it('keeps a question that offers no options', () => {
    const { bridge, events } = bridgeFor()
    void bridge.canUseTool('AskUserQuestion', { questions: [{ question: 'Why?' }] })
    expect(questionsOn(events)).toEqual([{ question: 'Why?', options: [] }])
  })
})
