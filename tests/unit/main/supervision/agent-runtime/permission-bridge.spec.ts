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
