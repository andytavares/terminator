import { describe, it, expect, vi } from 'vitest'
import {
  createPermissionBridge,
  type PendingPermission,
} from '../../src/runtime/permission-bridge.js'

// canUseTool is the only documented source of "this agent is blocked on you"
// (FR-010 — the Notification hook does not fire for permission prompts). This
// bridge turns that callback into console state and back into a decision.

function harness() {
  const events: PendingPermission[] = []
  const resolved: Array<{ requestId: string; decision: string }> = []
  let now = 1_000
  const bridge = createPermissionBridge({
    sessionId: 's1',
    now: () => now,
    onPending: (p) => events.push(p),
    onResolved: (requestId, decision) => resolved.push({ requestId, decision }),
  })
  return { bridge, events, resolved, setNow: (t: number) => (now = t) }
}

describe('raising a request', () => {
  it('raises a request naming the tool and what it wants to do', async () => {
    const { bridge, events } = harness()
    const pending = bridge.canUseTool('Bash', { command: 'redis-cli -h prod-cache-01' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
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
    await expect(pending).resolves.toEqual({ permissionDecision: 'allow', updatedInput: input })
  })

  it('denying returns the documented deny shape carrying the reason', async () => {
    const { bridge, events } = harness()
    const pending = bridge.canUseTool('Bash', { command: 'rm -rf /' })
    bridge.resolve((events[0] as { requestId: string }).requestId, {
      allow: false,
      reason: 'operator declined',
    })
    await expect(pending).resolves.toEqual({
      permissionDecision: 'deny',
      reason: 'operator declined',
    })
  })

  it('names a reason even when the operator gave none, so the agent is not simply refused', async () => {
    const { bridge, events } = harness()
    const pending = bridge.canUseTool('Bash', { command: 'x' })
    bridge.resolve((events[0] as { requestId: string }).requestId, { allow: false })
    await expect(pending).resolves.toMatchObject({ reason: 'Denied by the operator' })
  })

  it('reports the resolution, so a surface can clear the prompt', async () => {
    const { bridge, events, resolved } = harness()
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    const requestId = (events[0] as { requestId: string }).requestId
    bridge.resolve(requestId, { allow: true })
    await pending
    // Reported through its own callback rather than as another pending
    // request: a surface clears the prompt on this, and it is what tells a
    // waiting session it is no longer waiting.
    expect(resolved).toEqual([{ requestId, decision: 'allow' }])
  })

  it('ignores a resolution for an unknown request', async () => {
    const { bridge, events } = harness()
    expect(() => bridge.resolve('never-issued', { allow: true })).not.toThrow()
    expect(events).toHaveLength(0)
  })

  it('ignores a second resolution of the same request', async () => {
    const { bridge, events, resolved } = harness()
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    const requestId = (events[0] as { requestId: string }).requestId
    bridge.resolve(requestId, { allow: true })
    await pending
    bridge.resolve(requestId, { allow: false, reason: 'too late' })
    expect(resolved).toHaveLength(1)
  })
})

describe('auto-decision by the autonomy ladder', () => {
  it('resolves without ever publishing a request when the decider allows it', async () => {
    const events: SessionEvent[] = []
    const bridge = createPermissionBridge({
      sessionId: 's1',
      now: () => 1_000,
      onPending: (p) => events.push(p),
      onResolved: () => {},
      autoDecide: () => ({ allow: true }),
    })
    await expect(bridge.canUseTool('Read', {})).resolves.toMatchObject({
      permissionDecision: 'allow',
    })
    // No prompt was raised, so the operator was never interrupted.
    expect(events).toHaveLength(0)
  })

  it('still prompts when the decider abstains', async () => {
    const events: SessionEvent[] = []
    const autoDecide = vi.fn().mockReturnValue(null)
    const bridge = createPermissionBridge({
      sessionId: 's1',
      now: () => 1_000,
      onPending: (p) => events.push(p),
      onResolved: () => {},
      autoDecide,
    })
    const pending = bridge.canUseTool('Bash', { command: 'x' })
    expect(autoDecide).toHaveBeenCalled()
    expect(events).toHaveLength(1)
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
    await expect(pending).resolves.toMatchObject({ permissionDecision: 'deny' })
  })
})

// FR-007. Deciding requires seeing the ask. "AskUserQuestion request" is the
// tool's name, not its question — you cannot approve or deny that.

describe('what the operator is told is being asked', () => {
  function ask(toolName: string, input: unknown) {
    const events: SessionEvent[] = []
    const bridge = createPermissionBridge({
      sessionId: 's1',
      now: () => 1_000,
      onPending: (p) => events.push(p),
      onResolved: () => {},
    })
    void bridge.canUseTool(toolName, input)
    return events[0] as { summary: string; detail?: string | null }
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

  it('carries the command itself, not only the agent’s description of it', () => {
    // Approving on a description alone is taking the agent's word for what the
    // command does.
    const event = ask('Bash', { command: 'rm -rf build', description: 'Clean the build output' })
    expect(event.detail).toContain('command: rm -rf build')
    expect(event.detail).toContain('description: Clean the build output')
  })

  it('shows a command in full, however long the title elides it to', () => {
    const command = `cd ${'/very-long-path'.repeat(40)} && npm run build`
    const event = ask('Bash', { command })
    expect(event.detail).toContain(command)
  })

  it('shows the input of a tool it does not recognise, rather than only its name', () => {
    // An unfamiliar tool is exactly when you most need to see what it wants.
    const event = ask('SomeNewTool', { target: 'production', mode: 'destructive' })
    expect(event.detail).toContain('target: production')
    expect(event.detail).toContain('mode: destructive')
  })

  it('bounds a value that would never end, and says it did', () => {
    const event = ask('SomeNewTool', { blob: 'x'.repeat(50_000) })
    expect(event.detail?.length ?? 0).toBeLessThan(5_000)
    expect(event.detail).toContain('truncated')
  })

  it('bounds how many fields it shows', () => {
    const input = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`field${index}`, String(index)])
    )
    const event = ask('SomeNewTool', input)
    expect((event.detail ?? '').split('\n')).toHaveLength(24)
  })

  it('puts a multi-line value on its own line so a script stays readable', () => {
    const event = ask('Write', { file_path: '/a.sh', content: 'set -e\nrm -rf build\n' })
    expect(event.detail).toContain('content:\nset -e\nrm -rf build')
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
    const events: PendingPermission[] = []
    const bridge = createPermissionBridge({
      sessionId: 's1',
      now: () => 1_000,
      onPending: (p) => events.push(p),
      onResolved: () => {},
    })
    return { bridge, events }
  }

  function requestIdOf(events: PendingPermission[]): string {
    return events[0].requestId
  }

  it('sends the answer to the agent as the decision reason', async () => {
    const { bridge, events } = bridgeFor()
    const pending = bridge.canUseTool('AskUserQuestion', {
      questions: [{ question: 'Which scope?' }],
    })
    bridge.resolve(requestIdOf(events), { allow: false, answer: 'terminal output only' })
    await expect(pending).resolves.toEqual({
      permissionDecision: 'deny',
      reason: 'terminal output only',
    })
  })

  it('ignores an empty answer and behaves as the decision says', async () => {
    const { bridge, events } = bridgeFor()
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    bridge.resolve(requestIdOf(events), { allow: true, answer: '   ' })
    await expect(pending).resolves.toMatchObject({ permissionDecision: 'allow' })
  })

  function questionsOn(events: PendingPermission[]) {
    return events[0].questions
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

describe('a request nobody answers', () => {
  // It must not block the agent indefinitely. The hook itself waits twelve
  // hours; the console handing the decision back long before that is the
  // difference between a slow answer and a run that is stuck.
  function bridgeWith(askAfterMs: number) {
    const events: PendingPermission[] = []
    const resolved: Array<{ requestId: string; decision: string }> = []
    const bridge = createPermissionBridge({
      sessionId: 's1',
      now: () => 1_000,
      askAfterMs,
      onPending: (p) => events.push(p),
      onResolved: (requestId, decision) => resolved.push({ requestId, decision }),
    })
    return { bridge, events, resolved }
  }

  it('hands the decision back to the terminal rather than holding it', async () => {
    const { bridge } = bridgeWith(10)
    // `ask` is Claude Code's own prompt, in the terminal the operator is
    // already looking at. Not an allow — nothing is approved for them — and not
    // a deny, which would refuse work because they stepped away.
    await expect(bridge.canUseTool('Bash', { command: 'ls' })).resolves.toEqual({
      permissionDecision: 'ask',
    })
  })

  it('clears the prompt, so a surface stops showing an ask nobody owns', async () => {
    const { bridge, resolved } = bridgeWith(10)
    await bridge.canUseTool('Bash', { command: 'ls' })
    expect(resolved).toHaveLength(1)
  })

  it('does not hand back one the operator answered in time', async () => {
    const { bridge, events, resolved } = bridgeWith(10_000)
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    bridge.resolve(events[0].requestId, { allow: true })
    await expect(pending).resolves.toMatchObject({ permissionDecision: 'allow' })
    expect(resolved).toEqual([{ requestId: events[0].requestId, decision: 'allow' }])
  })

  it('can be handed back deliberately, not only by running out of time', async () => {
    const { bridge, events } = bridgeWith(10_000)
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    bridge.handBackToTerminal(events[0].requestId)
    await expect(pending).resolves.toEqual({ permissionDecision: 'ask' })
  })

  it('ignores handing back something already answered', async () => {
    const { bridge, events } = bridgeWith(10_000)
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    bridge.resolve(events[0].requestId, { allow: true })
    await pending
    expect(() => bridge.handBackToTerminal(events[0].requestId)).not.toThrow()
  })
})

describe('when the run ends with requests still held', () => {
  it('tells the surface they are gone, not just the agent', async () => {
    // `rejectAll` settled the waiting hooks but said nothing, so the board went
    // on listing tool calls from a run that had ended and clicking them did
    // nothing at all.
    const resolved: string[] = []
    const bridge = createPermissionBridge({
      sessionId: 's1',
      now: () => 0,
      onPending: () => {},
      onResolved: (requestId) => resolved.push(requestId),
    })
    const held = bridge.canUseTool('Bash', { command: 'ls' })
    bridge.rejectAll('This run has ended')
    await held
    expect(resolved).toHaveLength(1)
  })
})

describe('answering something that is no longer waiting', () => {
  it('says so rather than reporting a success that changed nothing', () => {
    const bridge = createPermissionBridge({
      sessionId: 's1',
      now: () => 0,
      onPending: () => {},
      onResolved: () => {},
    })
    expect(bridge.resolve('never-asked', { allow: true })).toBe(false)
  })

  it('reports true for one it actually answered', async () => {
    let asked = ''
    const bridge = createPermissionBridge({
      sessionId: 's1',
      now: () => 0,
      onPending: (pending) => {
        asked = pending.requestId
      },
      onResolved: () => {},
    })
    const held = bridge.canUseTool('Bash', { command: 'ls' })
    expect(bridge.resolve(asked, { allow: true })).toBe(true)
    await held
  })
})
