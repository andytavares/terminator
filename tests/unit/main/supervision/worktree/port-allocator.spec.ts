import { describe, it, expect, vi } from 'vitest'
import {
  allocatePortSpan,
  isPortFree,
} from '../../../../../src/main/supervision/worktree/port-allocator.js'

// SC-008: two concurrently provisioned working copies of the same repository
// never collide on ports. Availability is probed, not assumed — a port free in
// our own bookkeeping can still be taken by something outside the app.

const alwaysFree = () => true

describe('allocation', () => {
  it('allocates the configured base when nothing is taken', () => {
    expect(allocatePortSpan({ base: 4000, span: 10, taken: [], isFree: alwaysFree })).toEqual({
      portBase: 4000,
      portSpan: 10,
    })
  })

  it('skips a span already held by a live working copy', () => {
    const result = allocatePortSpan({
      base: 4000,
      span: 10,
      taken: [{ portBase: 4000, portSpan: 10 }],
      isFree: alwaysFree,
    })
    expect(result?.portBase).toBe(4010)
  })

  it('skips several occupied spans in a row', () => {
    const result = allocatePortSpan({
      base: 4000,
      span: 10,
      taken: [
        { portBase: 4000, portSpan: 10 },
        { portBase: 4010, portSpan: 10 },
      ],
      isFree: alwaysFree,
    })
    expect(result?.portBase).toBe(4020)
  })

  it('reuses a gap left by a released span', () => {
    const result = allocatePortSpan({
      base: 4000,
      span: 10,
      taken: [{ portBase: 4010, portSpan: 10 }],
      isFree: alwaysFree,
    })
    expect(result?.portBase).toBe(4000)
  })

  it('detects a partial overlap, not just an exact match', () => {
    // A span starting mid-way through ours still collides. Candidates step by
    // span from the base, so 4000 and 4010 both overlap 4005-4014 and the
    // first clear aligned span is 4020. Aligned spans keep the range from
    // fragmenting into unusable gaps.
    const result = allocatePortSpan({
      base: 4000,
      span: 10,
      taken: [{ portBase: 4005, portSpan: 10 }],
      isFree: alwaysFree,
    })
    expect(result?.portBase).toBe(4020)
  })
})

describe('probing actual availability', () => {
  it('skips a span whose ports are in use by something outside the app', () => {
    const isFree = vi.fn((port: number) => port >= 4010)
    const result = allocatePortSpan({ base: 4000, span: 10, taken: [], isFree })
    expect(result?.portBase).toBe(4010)
  })

  it('rejects a span when any single port in it is taken, not just the first', () => {
    const isFree = (port: number) => port !== 4007
    const result = allocatePortSpan({ base: 4000, span: 10, taken: [], isFree })
    expect(result?.portBase).toBe(4010)
  })

  it('probes every port in the span it settles on', () => {
    const isFree = vi.fn(alwaysFree)
    allocatePortSpan({ base: 4000, span: 3, taken: [], isFree })
    expect(isFree.mock.calls.map((c) => c[0])).toEqual([4000, 4001, 4002])
  })
})

describe('exhaustion', () => {
  it('returns null rather than allocating past the top of the port range', () => {
    expect(allocatePortSpan({ base: 4000, span: 10, taken: [], isFree: () => false })).toBeNull()
  })

  it('never allocates a span that would exceed the maximum port number', () => {
    const result = allocatePortSpan({ base: 65_530, span: 10, taken: [], isFree: alwaysFree })
    expect(result).toBeNull()
  })
})

describe('no overlap, ever (SC-008)', () => {
  it('produces disjoint spans across repeated allocations', () => {
    const taken: Array<{ portBase: number; portSpan: number }> = []
    for (let i = 0; i < 5; i++) {
      const result = allocatePortSpan({ base: 4000, span: 10, taken, isFree: alwaysFree })
      expect(result).not.toBeNull()
      taken.push(result!)
    }
    const used = taken.flatMap((s) => Array.from({ length: s.portSpan }, (_, i) => s.portBase + i))
    expect(new Set(used).size).toBe(used.length)
  })
})

describe('the real availability probe', () => {
  it('reports a free port as free', async () => {
    await expect(isPortFree(0)).resolves.toBe(true)
  })

  it('reports a port already bound as not free', async () => {
    const { createServer } = await import('net')
    const server = createServer()
    const port = await new Promise<number>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve((server.address() as { port: number }).port)
      })
    })
    await expect(isPortFree(port)).resolves.toBe(false)
    server.close()
  })
})
