import { describe, it, expect, vi } from 'vitest'
import { createEventBus } from '../../../../../src/main/supervision/events/event-bus.js'
import type { SessionEvent } from '../../../../../src/main/supervision/events/session-event.js'

const started: SessionEvent = {
  kind: 'session_started',
  sessionId: 's1',
  transcriptPath: '/tmp/s1.jsonl',
  cwd: '/repo',
  at: 1_000,
}

const toolStarted: SessionEvent = {
  kind: 'tool_started',
  sessionId: 's1',
  toolName: 'Read',
  isShell: false,
  callId: 'c1',
  at: 2_000,
}

describe('event bus', () => {
  it('delivers a published event to a subscriber', () => {
    const bus = createEventBus()
    const seen = vi.fn()
    bus.subscribe(seen)
    bus.publish(started)
    expect(seen).toHaveBeenCalledExactlyOnceWith(started)
  })

  it('delivers to every subscriber in subscription order', () => {
    const bus = createEventBus()
    const order: string[] = []
    bus.subscribe(() => order.push('first'))
    bus.subscribe(() => order.push('second'))
    bus.publish(started)
    expect(order).toEqual(['first', 'second'])
  })

  it('stops delivering after unsubscribe', () => {
    const bus = createEventBus()
    const seen = vi.fn()
    const off = bus.subscribe(seen)
    bus.publish(started)
    off()
    bus.publish(toolStarted)
    expect(seen).toHaveBeenCalledExactlyOnceWith(started)
  })

  it('tolerates unsubscribing twice', () => {
    const bus = createEventBus()
    const off = bus.subscribe(vi.fn())
    off()
    expect(() => off()).not.toThrow()
  })

  it('delivers nothing when there are no subscribers', () => {
    const bus = createEventBus()
    expect(() => bus.publish(started)).not.toThrow()
  })

  it('isolates subscribers: one throwing does not stop the others', () => {
    // A surface that throws while rendering must not silently stop the state
    // machine from seeing the rest of the stream.
    const bus = createEventBus()
    const after = vi.fn()
    bus.subscribe(() => {
      throw new Error('subscriber blew up')
    })
    bus.subscribe(after)
    expect(() => bus.publish(started)).not.toThrow()
    expect(after).toHaveBeenCalledExactlyOnceWith(started)
  })

  it('reports subscriber failures through the supplied error sink rather than swallowing them', () => {
    const onError = vi.fn()
    const bus = createEventBus({ onError })
    const boom = new Error('subscriber blew up')
    bus.subscribe(() => {
      throw boom
    })
    bus.publish(started)
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom, started)
  })

  it('does not deliver to a subscriber that unsubscribed earlier in the same publish', () => {
    // Delivery iterates a snapshot, so a handler removed mid-publish would
    // still be called unless membership is re-checked. A surface that tears
    // down on one event must not receive the rest of that same dispatch.
    const bus = createEventBus()
    const second = vi.fn()
    const offSecondRef: { current?: () => void } = {}
    bus.subscribe(() => offSecondRef.current?.())
    offSecondRef.current = bus.subscribe(second)
    bus.publish(started)
    expect(second).not.toHaveBeenCalled()
  })

  it('does not deliver an event to a subscriber added during that same publish', () => {
    // Otherwise a subscriber that subscribes on first event sees it twice.
    const bus = createEventBus()
    const late = vi.fn()
    bus.subscribe(() => bus.subscribe(late))
    bus.publish(started)
    expect(late).not.toHaveBeenCalled()
    bus.publish(toolStarted)
    expect(late).toHaveBeenCalledExactlyOnceWith(toolStarted)
  })
})

// The shapes feeding this bus come from hooks and a transcript whose formats
// are not published contracts, so a malformed event is reachable in production
// and not only from a typed caller.

describe('a value that is not a session event', () => {
  it('never reaches a subscriber', () => {
    const handler = vi.fn()
    const bus = createEventBus()
    bus.subscribe(handler)
    bus.publish({ kind: 'nonsense', sessionId: 's1', at: 1 } as never)
    expect(handler).not.toHaveBeenCalled()
  })

  it('is reported rather than dropped silently', () => {
    const onInvalid = vi.fn()
    const bus = createEventBus({ onInvalid })
    bus.publish({ kind: 'nonsense' } as never)
    expect(onInvalid).toHaveBeenCalled()
  })

  it('does not throw when nobody is watching for it', () => {
    const bus = createEventBus()
    expect(() => bus.publish(null as never)).not.toThrow()
  })

  it('still delivers the well-formed events around it', () => {
    const handler = vi.fn()
    const bus = createEventBus()
    bus.subscribe(handler)
    bus.publish({ kind: 'nonsense' } as never)
    bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: null,
      cwd: '/repo',
      at: 1_000,
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
