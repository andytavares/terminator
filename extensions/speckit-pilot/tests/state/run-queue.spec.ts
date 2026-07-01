import { describe, it, expect } from 'vitest'
import { shouldQueue, orderPending } from '../../src/state/run-queue.js'

describe('shouldQueue', () => {
  it('queues when active count reaches the cap', () => {
    expect(shouldQueue(3, 3)).toBe(true)
    expect(shouldQueue(4, 3)).toBe(true)
  })

  it('does not queue below the cap', () => {
    expect(shouldQueue(2, 3)).toBe(false)
    expect(shouldQueue(0, 3)).toBe(false)
  })

  it('treats a cap below 1 as 1', () => {
    expect(shouldQueue(1, 0)).toBe(true)
    expect(shouldQueue(0, 0)).toBe(false)
  })
})

describe('orderPending', () => {
  it('orders oldest run start first', () => {
    const ordered = orderPending([
      { featureDir: 'b', startedAt: '2026-06-30T02:00:00Z' },
      { featureDir: 'a', startedAt: '2026-06-30T01:00:00Z' },
      { featureDir: 'c', startedAt: null },
    ])
    expect(ordered.map((c) => c.featureDir)).toEqual(['c', 'a', 'b'])
  })

  it('handles null start times on either side of a comparison', () => {
    // Exercises both `?? ''` fallbacks (null on the left and on the right).
    const ordered = orderPending([
      { featureDir: 'has', startedAt: '2026-06-30T01:00:00Z' },
      { featureDir: 'null-a', startedAt: null },
      { featureDir: 'null-b', startedAt: null },
    ])
    expect(ordered[ordered.length - 1].featureDir).toBe('has')
  })

  it('returns an empty array unchanged', () => {
    expect(orderPending([])).toEqual([])
  })
})
