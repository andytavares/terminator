import { describe, it, expect, vi } from 'vitest'
import { createStateFanout } from '../../../../src/main/supervision/state-fanout.js'

// Extensions subscribing to supervision state used to receive a no-op
// subscription: `onStateChanged: () => () => {}`. Nothing ever fired, so the
// published read surface (FR-066, FR-072) was inert.

function build(over: Record<string, unknown> = {}) {
  const toRenderer = vi.fn()
  const onSubscriberError = vi.fn()
  const fanout = createStateFanout({ toRenderer, onSubscriberError, ...over })
  return { fanout, toRenderer, onSubscriberError }
}

const change = { sessionId: 's1', to: 'needs_input', at: 2_000 }

describe('fanning supervision state out to both audiences', () => {
  it('always tells the renderer', () => {
    const { fanout, toRenderer } = build()
    fanout.publish(change)
    expect(toRenderer).toHaveBeenCalledWith(change)
  })

  it('tells a subscribed extension', () => {
    const { fanout } = build()
    const handler = vi.fn()
    fanout.subscribe(handler)
    fanout.publish(change)
    expect(handler).toHaveBeenCalledWith({
      sessionId: 's1',
      from: '',
      to: 'needs_input',
      at: 2_000,
    })
  })

  it('tells every subscriber, not just the first', () => {
    const { fanout } = build()
    const first = vi.fn()
    const second = vi.fn()
    fanout.subscribe(first)
    fanout.subscribe(second)
    fanout.publish(change)
    expect(first).toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
  })

  it('stops telling a subscriber that unsubscribed', () => {
    const { fanout } = build()
    const handler = vi.fn()
    const off = fanout.subscribe(handler)
    off()
    fanout.publish(change)
    expect(handler).not.toHaveBeenCalled()
    expect(fanout.subscriberCount).toBe(0)
  })

  it('keeps telling the others when one subscriber throws', () => {
    const { fanout, onSubscriberError } = build()
    const later = vi.fn()
    fanout.subscribe(() => {
      throw new Error('extension exploded')
    })
    fanout.subscribe(later)
    fanout.publish(change)
    expect(later).toHaveBeenCalled()
    expect(onSubscriberError).toHaveBeenCalled()
  })

  it('reaches the renderer even when an extension throws (SC-001)', () => {
    const { fanout, toRenderer } = build()
    fanout.subscribe(() => {
      throw new Error('extension exploded')
    })
    fanout.publish(change)
    // The renderer is told first and outside the loop: two seconds is the whole
    // budget for a blocked session to become visible.
    expect(toRenderer).toHaveBeenCalledWith(change)
  })

  it('publishes to nobody without error when no extension subscribed', () => {
    const { fanout, onSubscriberError } = build()
    expect(() => fanout.publish(change)).not.toThrow()
    expect(onSubscriberError).not.toHaveBeenCalled()
  })

  it('reports how many extensions are listening', () => {
    const { fanout } = build()
    expect(fanout.subscriberCount).toBe(0)
    fanout.subscribe(vi.fn())
    expect(fanout.subscriberCount).toBe(1)
  })
})
