import { describe, it, expect, vi } from 'vitest'
import { convergeMaybeScouted } from '../../src/forge/scouted-converge.js'
import type { ScoutedConvergeDeps } from '../../src/forge/scouted-converge.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// `converge`'s contract (forge-channels.ts) is to answer once a turn has
// *started*, not once it has finished — the redraft lands later, through the
// store. A first draft used to break that: it waited out the scout's whole
// turn before answering at all, so on a host with no `claude` binary the
// channel never answered and the IPC caller timed out (PR #210, ac0b65e0).

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Hide done tickets in the picker',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { ...base, ...over }
}

function amendedOrder(): WorkOrder {
  return order({
    provenance: { forgeSession: null, decisions: ['accepted a finding'], amendments: [] },
    context: { ...order().context, entryPoints: ['src/index.ts'] },
  })
}

/** A scout that never calls onStarted and finishes straight to refusal. */
function refusedBeforeStart(): ScoutedConvergeDeps['startScout'] {
  return (_order, _onStarted, onFinished) => {
    onFinished(null)
  }
}

describe('convergeMaybeScouted', () => {
  it('resolves with the scout session while the scout has not finished', async () => {
    let finish: (updated: WorkOrder | null) => void = () => {}
    const startScout: ScoutedConvergeDeps['startScout'] = (_order, onStarted, onFinished) => {
      onStarted('scout-session-1')
      finish = onFinished
    }
    const startArchitect = vi.fn().mockResolvedValue({ ok: true, sessionId: 'architect-1' })
    const recordArchitectStarted = vi.fn().mockResolvedValue(undefined)

    const result = await convergeMaybeScouted(
      { startScout, startArchitect, recordArchitectStarted },
      order(),
      'do the thing'
    )

    expect(result).toEqual({ ok: true, sessionId: 'scout-session-1' })
    expect(startArchitect).not.toHaveBeenCalled()
    // Nothing has forced the scout to finish yet.
    expect(finish).toBeTypeOf('function')
  })

  it('starts the architect once the scout finishes, with the scout-collected order', async () => {
    let finish: (updated: WorkOrder | null) => void = () => {}
    const startScout: ScoutedConvergeDeps['startScout'] = (_order, onStarted, onFinished) => {
      onStarted('scout-session-1')
      finish = onFinished
    }
    const collected = order({ context: { ...order().context, entryPoints: ['src/foo.ts'] } })
    const startArchitect = vi.fn().mockResolvedValue({ ok: true, sessionId: 'architect-1' })
    const recordArchitectStarted = vi.fn().mockResolvedValue(undefined)

    const promise = convergeMaybeScouted(
      { startScout, startArchitect, recordArchitectStarted },
      order(),
      'do the thing'
    )
    await promise

    expect(startArchitect).not.toHaveBeenCalled()
    finish(collected)
    // The architect starts asynchronously off the scout's onFinished.
    await Promise.resolve()
    await Promise.resolve()

    expect(startArchitect).toHaveBeenCalledWith(collected, 'do the thing')
    expect(recordArchitectStarted).toHaveBeenCalledWith(collected, 'do the thing', {
      ok: true,
      sessionId: 'architect-1',
    })
  })

  it('resolves with the architect result when the scout is refused before starting', async () => {
    const startArchitect = vi.fn().mockResolvedValue({ ok: true, sessionId: 'architect-1' })
    const recordArchitectStarted = vi.fn().mockResolvedValue(undefined)

    const result = await convergeMaybeScouted(
      { startScout: refusedBeforeStart(), startArchitect, recordArchitectStarted },
      order(),
      'do the thing'
    )

    expect(result).toEqual({ ok: true, sessionId: 'architect-1' })
    expect(startArchitect).toHaveBeenCalledWith(order(), 'do the thing')
    expect(recordArchitectStarted).toHaveBeenCalledWith(order(), 'do the thing', {
      ok: true,
      sessionId: 'architect-1',
    })
  })

  it('skips the scout for a non-first (amending) draft', async () => {
    const startScout = vi.fn()
    const startArchitect = vi.fn().mockResolvedValue({ ok: true, sessionId: 'architect-1' })
    const recordArchitectStarted = vi.fn().mockResolvedValue(undefined)

    const result = await convergeMaybeScouted(
      { startScout, startArchitect, recordArchitectStarted },
      amendedOrder(),
      'do the thing'
    )

    expect(result).toEqual({ ok: true, sessionId: 'architect-1' })
    expect(startScout).not.toHaveBeenCalled()
    expect(startArchitect).toHaveBeenCalledWith(amendedOrder(), 'do the thing')
    // The architect's later start is `startArchitect`'s own caller's to
    // record for the amending path — `converge.started` there comes from
    // `runArchitectTurn`, the same as before this change.
    expect(recordArchitectStarted).not.toHaveBeenCalled()
  })
})
