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

/**
 * A run that stays open, the way a real one does for minutes or hours. The
 * session has to still be running for a reply or an interrupt to reach it.
 */
function liveHarness() {
  const interrupt = vi.fn().mockResolvedValue(undefined)
  const iterable = {
    // Never yields and never returns — a real run produces nothing until the
    // agent does, and the session must stay open in the meantime.
    [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
    interrupt,
  }
  const events: SessionEvent[] = []
  const query = vi.fn().mockReturnValue(iterable)
  const driver = createSessionDriver({
    query: query as never,
    publish: (e) => events.push(e),
    now: () => 1_000,
  })
  return { driver, events, query, interrupt }
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
  it('passes the prompt as a stream and the working copy as cwd', async () => {
    const { driver, query } = harness()
    await driver.start({ sessionId: 's1', prompt: 'do the thing', cwd: '/wt/s1' })
    const options = query.mock.calls[0][0] as {
      prompt: AsyncIterable<unknown>
      options: { cwd: string }
    }
    expect(options.options.cwd).toBe('/wt/s1')

    // Streaming input, not a string: the runtime documents interrupt() as
    // available in streaming mode only, and a follow-up message has nowhere
    // to go otherwise. With a string prompt both silently do nothing.
    expect(typeof options.prompt).toBe('object')
    const first = await options.prompt[Symbol.asyncIterator]().next()
    expect(first.value).toMatchObject({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'do the thing' }] },
    })
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

// Both actions the operator needs on a stalled session run through this.

describe('sending a further message to a running session', () => {
  async function promptStream(query: ReturnType<typeof liveHarness>['query']) {
    const call = query.mock.calls[0][0] as { prompt: AsyncIterable<unknown> }
    return call.prompt[Symbol.asyncIterator]()
  }

  it('delivers the message into the prompt stream', async () => {
    const { driver, query } = liveHarness()
    await driver.start({ sessionId: 's1', prompt: 'first', cwd: '/wt/s1' })
    const iterator = await promptStream(query)
    await iterator.next()

    await driver.send('s1', 'try the other approach')
    const next = await iterator.next()
    expect(next.value).toMatchObject({
      message: { content: [{ type: 'text', text: 'try the other approach' }] },
    })
  })

  it('delivers several messages in order', async () => {
    const { driver, query } = liveHarness()
    await driver.start({ sessionId: 's1', prompt: 'first', cwd: '/wt/s1' })
    const iterator = await promptStream(query)
    await iterator.next()

    await driver.send('s1', 'one')
    await driver.send('s1', 'two')
    expect((await iterator.next()).value).toMatchObject({
      message: { content: [{ text: 'one' }] },
    })
    expect((await iterator.next()).value).toMatchObject({
      message: { content: [{ text: 'two' }] },
    })
  })

  it('reports a session that is no longer running rather than swallowing it', async () => {
    const { driver } = harness()
    // A reply that goes nowhere must say so.
    await expect(driver.send('ghost', 'hello')).rejects.toThrow(/no longer running/)
  })
})

describe('interrupting', () => {
  it('calls the runtime interrupt', async () => {
    const { driver, interrupt } = liveHarness()
    await driver.start({ sessionId: 's1', prompt: 'x', cwd: '/wt/s1' })
    await driver.interrupt('s1')
    expect(interrupt).toHaveBeenCalled()
  })

  it('closes the prompt stream, which is what actually ends the run', async () => {
    const { driver, query } = liveHarness()
    await driver.start({ sessionId: 's1', prompt: 'x', cwd: '/wt/s1' })
    const call = query.mock.calls[0][0] as { prompt: AsyncIterable<unknown> }
    const iterator = call.prompt[Symbol.asyncIterator]()
    await iterator.next()

    await driver.interrupt('s1')
    // Interrupting stops the current turn; it does not end the session.
    expect(await iterator.next()).toMatchObject({ done: true })
  })

  it('does nothing for a session that is not running', async () => {
    const { driver } = harness()
    await expect(driver.interrupt('ghost')).resolves.toBeUndefined()
  })
})
