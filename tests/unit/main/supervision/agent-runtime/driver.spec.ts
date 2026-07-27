import { describe, it, expect, vi } from 'vitest'
import { createSessionDriver } from '../../../../../src/main/supervision/agent-runtime/driver.js'
import type { SessionEvent } from '../../../../../src/main/supervision/events/session-event.js'

// The only module that starts an agent. The runtime's `query` is injected so
// this can be exercised without spawning one — and so a runtime upgrade that
// changes `query`'s signature breaks here and nowhere else (SC-007).

function fakeQuery(messages: unknown[]) {
  const interrupt = vi.fn().mockResolvedValue(undefined)
  const iterable = {
    async *[Symbol.asyncIterator]() {
      for (const m of messages) yield m
    },
    interrupt,
  }
  return { query: vi.fn().mockReturnValue(iterable), interrupt }
}

const successResult = {
  type: 'result',
  subtype: 'success',
  session_id: 's1',
  num_turns: 4,
  total_cost_usd: 1.25,
  is_error: false,
}

function harness(messages: unknown[] = [successResult]) {
  const events: SessionEvent[] = []
  const { query, interrupt } = fakeQuery(messages)
  const driver = createSessionDriver({
    query: query as never,
    publish: (e) => events.push(e),
    now: () => 1_000,
  })
  return { driver, events, query, interrupt }
}

describe('starting a session', () => {
  it('passes the prompt and the working copy as cwd', async () => {
    const { driver, query } = harness()
    await driver.start({ sessionId: 's1', prompt: 'do the thing', cwd: '/wt/s1' })
    const options = query.mock.calls[0][0] as { prompt: string; options: { cwd: string } }
    expect(options.prompt).toBe('do the thing')
    expect(options.options.cwd).toBe('/wt/s1')
  })

  it('wires canUseTool, which is the only source of needs_input (FR-010)', async () => {
    const { driver, query } = harness()
    await driver.start({ sessionId: 's1', prompt: 'x', cwd: '/wt/s1' })
    const options = query.mock.calls[0][0] as { options: { canUseTool: unknown } }
    expect(typeof options.options.canUseTool).toBe('function')
  })

  it('registers the supervision hooks', async () => {
    const { driver, query } = harness()
    await driver.start({ sessionId: 's1', prompt: 'x', cwd: '/wt/s1' })
    const options = query.mock.calls[0][0] as { options: { hooks: Record<string, unknown> } }
    expect(Object.keys(options.options.hooks).sort()).toEqual([
      'PostToolUse',
      'PreToolUse',
      'SessionStart',
    ])
  })

  it('publishes turn_finished and session_ended from the terminal result', async () => {
    const { driver, events } = harness()
    await driver.start({ sessionId: 's1', prompt: 'x', cwd: '/wt/s1' })
    await driver.completion('s1')
    expect(events.map((e) => e.kind)).toEqual(['turn_finished', 'session_ended'])
    expect(events[0]).toMatchObject({ turns: 4, costUsd: 1.25 })
  })

  it('maps an error result to a failed outcome carrying the subtype', async () => {
    const { driver, events } = harness([
      { ...successResult, subtype: 'error_max_turns', is_error: true },
    ])
    await driver.start({ sessionId: 's1', prompt: 'x', cwd: '/wt/s1' })
    await driver.completion('s1')
    expect(events.at(-1)).toMatchObject({ outcome: 'error', reason: 'error_max_turns' })
  })

  it('ignores non-result messages rather than choking on them', async () => {
    const { driver, events } = harness([{ type: 'assistant' }, { type: 'system' }, successResult])
    await driver.start({ sessionId: 's1', prompt: 'x', cwd: '/wt/s1' })
    await driver.completion('s1')
    expect(events.map((e) => e.kind)).toEqual(['turn_finished', 'session_ended'])
  })

  it('publishes session_ended even when the run throws', async () => {
    const events: SessionEvent[] = []
    const driver = createSessionDriver({
      query: (() => ({
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() {
          throw new Error('runtime blew up')
        },
        interrupt: vi.fn(),
      })) as never,
      publish: (e) => events.push(e),
      now: () => 1_000,
    })
    await driver.start({ sessionId: 's1', prompt: 'x', cwd: '/wt/s1' })
    await driver.completion('s1')
    // A crashed run that reported nothing would leave the session `working`
    // forever, which is precisely the silent failure this feature exists to stop.
    expect(events.at(-1)).toMatchObject({ kind: 'session_ended', outcome: 'error' })
  })
})

describe('start resolves at launch, not at completion', () => {
  it('returns while the run is still going, so the session can be acted on', async () => {
    let releaseRun: (() => void) | undefined
    const gate = new Promise<void>((r) => (releaseRun = r))
    const events: SessionEvent[] = []
    const driver = createSessionDriver({
      query: (() => ({
        async *[Symbol.asyncIterator]() {
          await gate
          yield successResult
        },
        interrupt: vi.fn(),
      })) as never,
      publish: (e) => events.push(e),
      now: () => 1_000,
    })
    // If start() awaited the run, this would deadlock on the gate.
    await driver.start({ sessionId: 's1', prompt: 'x', cwd: '/wt/s1' })
    expect(events).toEqual([])
    releaseRun?.()
    await driver.completion('s1')
    expect(events.at(-1)).toMatchObject({ kind: 'session_ended' })
  })
})

describe('interrupting and redirecting (FR-043)', () => {
  it('interrupts a run that is still going', async () => {
    // The run must be held open: a session that has already finished is
    // correctly forgotten, so interrupting it is a no-op by design.
    const interrupt = vi.fn().mockResolvedValue(undefined)
    let releaseRun: (() => void) | undefined
    const gate = new Promise<void>((r) => (releaseRun = r))
    const driver = createSessionDriver({
      query: (() => ({
        // eslint-disable-next-line require-yield -- the run is held open, never producing a message
        async *[Symbol.asyncIterator]() {
          await gate
        },
        interrupt,
      })) as never,
      publish: () => {},
      now: () => 1_000,
    })
    await driver.start({ sessionId: 's1', prompt: 'x', cwd: '/wt/s1' })
    await driver.interrupt('s1')
    expect(interrupt).toHaveBeenCalled()
    releaseRun?.()
    await driver.completion('s1')
  })

  it('forgets a session once its run has ended, so a late interrupt is a no-op', async () => {
    const { driver, interrupt } = harness()
    await driver.start({ sessionId: 's1', prompt: 'x', cwd: '/wt/s1' })
    await driver.completion('s1')
    await driver.interrupt('s1')
    expect(interrupt).not.toHaveBeenCalled()
  })

  it('is a no-op for a session it is not running', async () => {
    const { driver, interrupt } = harness()
    await expect(driver.interrupt('nope')).resolves.toBeUndefined()
    expect(interrupt).not.toHaveBeenCalled()
  })

  it('resolves a pending permission through the session bridge', async () => {
    const { driver, events } = harness([])
    await driver.start({ sessionId: 's1', prompt: 'x', cwd: '/wt/s1' })
    // Nothing outstanding — the call must be safe, not throw.
    expect(() => driver.resolvePermission('s1', 'r-unknown', { allow: true })).not.toThrow()
    expect(events.filter((e) => e.kind === 'permission_resolved')).toHaveLength(0)
  })

  it('ignores a permission decision for an unknown session', () => {
    const { driver } = harness()
    expect(() => driver.resolvePermission('ghost', 'r1', { allow: true })).not.toThrow()
  })
})
