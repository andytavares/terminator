import { describe, it, expect, vi } from 'vitest'
import { refineryTick } from '../../src/line/refinery-tick.js'
import type { RefineryTickDeps } from '../../src/line/refinery-tick.js'
import type { RefineryState } from '../../src/line/refinery-state.js'
import type { QueueEntry } from '../../src/line/refinery.js'

// The tick's orchestration only: every git/gh/gate call is a fake, so each of
// the four things a restack can find (nothing to do yet, a clean rebase, a
// conflict, a transient failure) is one assertion against a state map rather
// than a real checkout.

function entry(over: Partial<QueueEntry> & Pick<QueueEntry, 'orderId'>): QueueEntry {
  return {
    title: over.orderId,
    repo: 'app',
    base: 'main',
    agreedAt: '2026-09-01T00:00:00.000Z',
    files: [],
    merged: false,
    ...over,
  }
}

function baseDeps(over: Partial<RefineryTickDeps> = {}): RefineryTickDeps & {
  states: Map<string, RefineryState>
  records: { orderId: string; action: string; subject: string; reason: string }[]
  conflicts: { orderId: string; why: string; files: readonly string[] }[]
  watched: string[]
} {
  const states = new Map<string, RefineryState>()
  const records: { orderId: string; action: string; subject: string; reason: string }[] = []
  const conflicts: { orderId: string; why: string; files: readonly string[] }[] = []
  const watched: string[] = []

  const deps: RefineryTickDeps = {
    candidates: async () => [],
    readState: async (orderId) => states.get(orderId) ?? { mergedAt: null, restackedFor: [] },
    writeState: async (orderId, state) => {
      states.set(orderId, state)
    },
    viewPr: async () => ({ merged: false }),
    entries: async () => [],
    lanesFor: async () => [{ cwd: '/lane', branch: 'foundry/wo', base: 'main' }],
    restack: async () => ({ kind: 'rebased', pushed: true }),
    watchCi: async (orderId) => {
      watched.push(orderId)
    },
    raiseConflict: async (orderId, why, files) => {
      conflicts.push({ orderId, why, files })
    },
    record: async (orderId, action, subject, reason) => {
      records.push({ orderId, action, subject, reason })
    },
    titleOf: async (orderId) => orderId,
    now: () => '2026-09-06T12:00:00.000Z',
    ...over,
  }

  return Object.assign(deps, { states, records, conflicts, watched })
}

describe('refineryTick', () => {
  it('does nothing when nothing has merged', async () => {
    const deps = baseDeps({
      candidates: async () => [{ order: { id: 'WO-1', title: 'A' }, pulls: [{ url: 'u1' }] }],
      viewPr: async () => ({ merged: false }),
      entries: vi.fn(async () => []),
    })

    await refineryTick(deps)

    expect(deps.states.size).toBe(0)
    expect(deps.records).toEqual([])
    expect(deps.entries).not.toHaveBeenCalled()
  })

  it('writes mergedAt once and restacks + CI-watches an overlapping later order', async () => {
    const deps = baseDeps({
      candidates: async () => [
        { order: { id: 'WO-1', title: 'Predecessor' }, pulls: [{ url: 'u1' }] },
      ],
      viewPr: async () => ({ merged: true }),
      entries: async () => [
        entry({ orderId: 'WO-1', agreedAt: '2026-09-01T00:00:00.000Z', files: ['a.ts'] }),
        entry({ orderId: 'WO-2', agreedAt: '2026-09-02T00:00:00.000Z', files: ['a.ts'] }),
      ],
    })

    await refineryTick(deps)

    expect(deps.states.get('WO-1')).toEqual({
      mergedAt: '2026-09-06T12:00:00.000Z',
      restackedFor: [],
    })
    expect(deps.states.get('WO-2')?.restackedFor).toEqual(['WO-1'])
    expect(deps.watched).toEqual(['WO-2'])
    expect(deps.records.map((r) => r.action)).toEqual(['refinery.merged', 'refinery.rebased'])
  })

  it('does not re-check gh once mergedAt is already recorded', async () => {
    const viewPr = vi.fn(async () => ({ merged: true }))
    const deps = baseDeps({
      candidates: async () => [
        { order: { id: 'WO-1', title: 'Predecessor' }, pulls: [{ url: 'u1' }] },
      ],
      viewPr,
      entries: async () => [],
    })
    deps.states.set('WO-1', { mergedAt: '2026-09-06T10:00:00.000Z', restackedFor: [] })

    await refineryTick(deps)

    expect(viewPr).not.toHaveBeenCalled()
  })

  it('skips an order already restacked for that predecessor', async () => {
    const restack = vi.fn(async () => ({ kind: 'rebased' as const, pushed: true }))
    const deps = baseDeps({
      candidates: async () => [
        { order: { id: 'WO-1', title: 'Predecessor' }, pulls: [{ url: 'u1' }] },
      ],
      viewPr: async () => ({ merged: true }),
      entries: async () => [
        entry({ orderId: 'WO-1', files: ['a.ts'] }),
        entry({ orderId: 'WO-2', agreedAt: '2026-09-02T00:00:00.000Z', files: ['a.ts'] }),
      ],
      restack,
    })
    deps.states.set('WO-2', { mergedAt: null, restackedFor: ['WO-1'] })

    await refineryTick(deps)

    expect(restack).not.toHaveBeenCalled()
    expect(deps.watched).toEqual([])
  })

  it('raises refinery.conflict on a conflicting rebase, once', async () => {
    const deps = baseDeps({
      candidates: async () => [
        { order: { id: 'WO-1', title: 'Predecessor' }, pulls: [{ url: 'u1' }] },
      ],
      viewPr: async () => ({ merged: true }),
      entries: async () => [
        entry({ orderId: 'WO-1', files: ['a.ts'] }),
        entry({ orderId: 'WO-2', agreedAt: '2026-09-02T00:00:00.000Z', files: ['a.ts'] }),
      ],
      restack: async () => ({ kind: 'conflict', files: ['a.ts'] }),
      titleOf: async (id) => (id === 'WO-1' ? 'Predecessor' : 'Successor'),
    })

    await refineryTick(deps)

    expect(deps.conflicts).toHaveLength(1)
    expect(deps.conflicts[0]).toMatchObject({
      orderId: 'WO-2',
      why: 'Successor no longer rebases onto its base after Predecessor merged',
      files: ['a.ts'],
    })
    expect(deps.records.map((r) => r.action)).toEqual(['refinery.merged', 'refinery.conflict'])
    expect(deps.states.get('WO-2')?.restackedFor ?? []).toEqual([])
    expect(deps.watched).toEqual([])
  })

  it('records a failed restack without marking it restacked, so it retries next tick', async () => {
    const restack = vi.fn(async () => ({ kind: 'failed' as const, reason: 'network blip' }))
    const deps = baseDeps({
      candidates: async () => [
        { order: { id: 'WO-1', title: 'Predecessor' }, pulls: [{ url: 'u1' }] },
      ],
      viewPr: async () => ({ merged: true }),
      entries: async () => [
        entry({ orderId: 'WO-1', files: ['a.ts'] }),
        entry({ orderId: 'WO-2', agreedAt: '2026-09-02T00:00:00.000Z', files: ['a.ts'] }),
      ],
      restack,
    })

    await refineryTick(deps)
    expect(deps.records.map((r) => r.action)).toEqual(['refinery.merged', 'refinery.failed'])
    expect(deps.states.get('WO-2')?.restackedFor ?? []).toEqual([])

    // Second tick: WO-1's mergedAt already recorded, so it is retried again.
    restack.mockResolvedValueOnce({ kind: 'rebased', pushed: true } as never)
    await refineryTick(deps)
    expect(deps.states.get('WO-2')?.restackedFor).toEqual(['WO-1'])
    expect(deps.watched).toEqual(['WO-2'])
  })
})
