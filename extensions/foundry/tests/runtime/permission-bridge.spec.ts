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
  describe('the request', theRequestTests)
  describe('summaries and ids', summariesAndIdsTests)
})

function theRequestTests() {
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
}

function summariesAndIdsTests() {
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
}

describe('resolving a request', () => {
  describe('allowing and denying', allowingAndDenyingTests)
  describe('reasons and reports', reasonsAndReportsTests)
  describe('unknown and repeated resolutions', unknownAndRepeatedResolutionsTests)
})

function allowingAndDenyingTests() {
  it('allowing returns the allow verdict', async () => {
    const { bridge, events } = harness()
    const input = { command: 'ls' }
    const pending = bridge.canUseTool('Bash', input)
    bridge.resolve((events[0] as { requestId: string }).requestId, { allow: true })
    await expect(pending).resolves.toEqual({ permissionDecision: 'allow' })
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
}

function reasonsAndReportsTests() {
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
}

function unknownAndRepeatedResolutionsTests() {
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
}

describe('auto-decision by the autonomy ladder', () => {
  describe('an allowing decider', anAllowingDeciderTests)
  describe('an abstaining decider', anAbstainingDeciderTests)
})

function anAllowingDeciderTests() {
  it('resolves without ever publishing a request when the decider allows it', async () => {
    const events: PendingPermission[] = []
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
}

function anAbstainingDeciderTests() {
  it('still prompts when the decider abstains', async () => {
    const events: PendingPermission[] = []
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
}

describe('an ask answered in the agent tab', () => {
  it('drops the held call it raised and reports how it was settled', async () => {
    const { bridge, events, resolved } = bridgeWith()
    const pending = bridge.canUseTool('Bash', { command: 'ls' }, 'ask-1')
    bridge.withdraw('ask-1', 'allowed')
    await expect(pending).resolves.toEqual({ permissionDecision: 'ask' })
    expect(resolved).toEqual([{ requestId: events[0].requestId, decision: 'allow' }])
    expect(bridge.resolve(events[0].requestId, { allow: true })).toBe(false)
  })

  it('leaves the calls of other asks held', async () => {
    const { bridge, events, resolved } = bridgeWith()
    const pending = bridge.canUseTool('Bash', { command: 'ls' }, 'ask-1')
    bridge.withdraw('ask-2', 'rejected')
    expect(resolved).toEqual([])
    expect(bridge.resolve(events[0].requestId, { allow: true })).toBe(true)
    await pending
  })
})

describe('an ask cancelled by an interrupt or an end', () => {
  it('reports the held call denied, not answered', async () => {
    const { bridge, events, resolved } = bridgeWith()
    const pending = bridge.canUseTool('Bash', { command: 'ls' }, 'ask-1')
    bridge.withdraw('ask-1', 'cancelled')
    await expect(pending).resolves.toEqual({ permissionDecision: 'ask' })
    expect(resolved).toEqual([{ requestId: events[0].requestId, decision: 'deny' }])
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

async function ask(toolName: string, input: unknown) {
  const events: PendingPermission[] = []
  const bridge = createPermissionBridge({
    sessionId: 's1',
    now: () => 1_000,
    onPending: (p) => events.push(p),
    onResolved: () => {},
  })
  const pending = bridge.canUseTool(toolName, input)
  const asked = events[0] as { summary: string; detail?: string | null }
  bridge.rejectAll('asked only to read what the operator is told')
  await pending
  return asked
}

// FR-007. Deciding requires seeing the ask, not only the tool's name.

describe('what the operator is told is being asked', () => {
  describe('shell requests', shellRequestsTests)
  describe('unknown tools and bounds', unknownToolsAndBoundsTests)
  describe('multi-line values and non-objects', multiLineValuesAndNonObjectsTests)
})

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
function shellRequestsTests() {
  it('still leads with the command for a shell request', async () => {
    const event = await ask('Bash', { command: 'redis-cli -h prod-cache-01 FLUSHALL' })
    expect(event.summary).toBe('redis-cli -h prod-cache-01 FLUSHALL')
  })

  it('carries the command itself, not only the agent’s description of it', async () => {
    // Approving on a description alone is taking the agent's word for what the
    // command does.
    const event = await ask('Bash', {
      command: 'rm -rf build',
      description: 'Clean the build output',
    })
    expect(event.detail).toContain('command: rm -rf build')
    expect(event.detail).toContain('description: Clean the build output')
  })

  it('shows a command in full, however long the title elides it to', async () => {
    const command = `cd ${'/very-long-path'.repeat(40)} && npm run build`
    const event = await ask('Bash', { command })
    expect(event.detail).toContain(command)
  })
}

function unknownToolsAndBoundsTests() {
  it('shows the input of a tool it does not recognise, rather than only its name', async () => {
    // An unfamiliar tool is exactly when you most need to see what it wants.
    const event = await ask('SomeNewTool', { target: 'production', mode: 'destructive' })
    expect(event.detail).toContain('target: production')
    expect(event.detail).toContain('mode: destructive')
  })

  it('bounds a value that would never end, and says it did', async () => {
    const event = await ask('SomeNewTool', { blob: 'x'.repeat(50_000) })
    expect(event.detail?.length ?? 0).toBeLessThan(5_000)
    expect(event.detail).toContain('truncated')
  })

  it('bounds how many fields it shows', async () => {
    const input = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`field${index}`, String(index)])
    )
    const event = await ask('SomeNewTool', input)
    expect((event.detail ?? '').split('\n')).toHaveLength(24)
  })
}

function multiLineValuesAndNonObjectsTests() {
  it('puts a multi-line value on its own line so a script stays readable', async () => {
    const event = await ask('Write', { file_path: '/a.sh', content: 'set -e\nrm -rf build\n' })
    expect(event.detail).toContain('content:\nset -e\nrm -rf build')
  })

  it('has no detail to show when the input is not an object', async () => {
    const event = await ask('SomeNewTool', 'just a string')
    expect(event.summary).toBe('SomeNewTool request')
    expect(event.detail).toBeNull()
  })
}

// canUseTool has exactly two ways back to the agent: allow with an updated
// input, or deny with a message. The message is the only channel that carries
// words, so a real answer travels as a denial whose message is the answer.

describe('answering rather than approving', () => {
  describe('answers', answersTests)
})

function bridgeWith() {
  const events: PendingPermission[] = []
  const resolved: Array<{ requestId: string; decision: string }> = []
  const bridge = createPermissionBridge({
    sessionId: 's1',
    now: () => 1_000,
    onPending: (p) => events.push(p),
    onResolved: (requestId, decision) => resolved.push({ requestId, decision }),
  })
  return { bridge, events, resolved }
}

function answersTests() {
  function requestIdOf(events: PendingPermission[]): string {
    return events[0].requestId
  }

  it('carries the answer as the reason', async () => {
    const { bridge, events } = bridgeFor()
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    bridge.resolve(requestIdOf(events), { allow: false, answer: 'terminal output only' })
    await expect(pending).resolves.toMatchObject({
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
}

describe('a request nobody has answered yet', () => {
  describe('being held for a person', heldForAPersonTests)
  describe('typing an answer', typedAnswerTests)
  describe('handing back deliberately', handingBackDeliberatelyTests)
})

function heldForAPersonTests() {
  it('reaches the operator at once, with no timer that hands it back', async () => {
    vi.useFakeTimers()
    try {
      const { bridge, events } = bridgeWith()
      const pending = bridge.canUseTool('Bash', { command: 'ls' })
      expect(events).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(0)
      bridge.rejectAll('test ended')
      await pending
    } finally {
      vi.useRealTimers()
    }
  })

  it('is still held after a long wait, not handed back', async () => {
    vi.useFakeTimers()
    try {
      const { bridge, events, resolved } = bridgeWith()
      const pending = bridge.canUseTool('Bash', { command: 'ls' })
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(resolved).toEqual([])
      bridge.resolve(events[0].requestId, { allow: true })
      await expect(pending).resolves.toMatchObject({ permissionDecision: 'allow' })
    } finally {
      vi.useRealTimers()
    }
  })
}

function typedAnswerTests() {
  it('reports an operator’s typed answer as a refusal that carries the words', async () => {
    const { bridge, events } = bridgeWith()
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    bridge.resolve(events[0].requestId, { allow: false, answer: ' use staging ' })
    await expect(pending).resolves.toEqual({
      permissionDecision: 'deny',
      reason: 'use staging',
      answer: 'use staging',
    })
  })
}

function handingBackDeliberatelyTests() {
  it('can be handed back deliberately, not only by running out of time', async () => {
    const { bridge, events } = bridgeWith()
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    bridge.handBackToTerminal(events[0].requestId)
    await expect(pending).resolves.toEqual({ permissionDecision: 'ask' })
  })

  it('ignores handing back something already answered', async () => {
    const { bridge, events } = bridgeWith()
    const pending = bridge.canUseTool('Bash', { command: 'ls' })
    bridge.resolve(events[0].requestId, { allow: true })
    await pending
    expect(() => bridge.handBackToTerminal(events[0].requestId)).not.toThrow()
  })
}

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

function ladder(over: Record<string, unknown>) {
  return createPermissionBridge({
    sessionId: 's1',
    now: () => 1_000,
    onPending: () => undefined,
    onResolved: () => undefined,
    ...over,
  } as never)
}

// A refusal taken by the ladder raised no prompt and posted nothing, so an
// agent being turned down looked exactly like one that had gone quiet. Four
// live runs died on refused commands, and reading the transcript was the only
// way to find out why any of them stopped.
describe('a refusal the ladder took on its own', () => {
  describe('ladder refusals', ladderRefusalsTests)
})

function ladderRefusalsTests() {
  it('is reported, so the console can say why the agent changed course', async () => {
    const denied: { tool: string; reason: string }[] = []
    const b = ladder({
      autoDecide: () => ({ allow: false, reason: 'rm is not on the read-only list' }),
      onAutoDenied: (tool: string, reason: string) => denied.push({ tool, reason }),
    })
    await b.canUseTool('Bash', { command: 'rm -rf x' })
    expect(denied).toEqual([{ tool: 'Bash', reason: 'rm is not on the read-only list' }])
  })

  it('is not reported for an allow, which would be one of hundreds', async () => {
    const denied: string[] = []
    const b = ladder({
      autoDecide: () => ({ allow: true, reason: 'standard takes ordinary work' }),
      onAutoDenied: (tool: string) => denied.push(tool),
    })
    await b.canUseTool('Edit', { file_path: '/wt/a.ts' })
    expect(denied).toEqual([])
  })

  it('says something even where the refusal carried no reason', async () => {
    const denied: string[] = []
    const b = ladder({
      autoDecide: () => ({ allow: false }),
      onAutoDenied: (_tool: string, reason: string) => denied.push(reason),
    })
    await b.canUseTool('Bash', { command: 'rm -rf x' })
    expect(denied).toEqual(['no reason given'])
  })
}
