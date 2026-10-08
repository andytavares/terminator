import { describe, it, expect, vi } from 'vitest'
import { readyToHandOff } from '../../src/forge/release-again.js'
import type { ReleaseDeps } from '../../src/forge/release-again.js'
import type { LedgerEntry } from '../../src/ledger/append.js'
import type { WorkOrder } from '../../src/order/schema.js'

// What happens when an amended draft passes every check.
//
// WO-1008-287: the operator handed the order off, the inspector found a
// defect, the operator answered it, the architect amended the plan — and the
// order sat in draft for good with a toast as its only notice. The operator
// had already released it; answering the defect was the decision to carry on.

const ORDER = { id: 'WO-1008-287', title: 'render html in comments' } as WorkOrder

function entry(action: string, actor = 'operator'): LedgerEntry {
  return {
    at: '2026-10-08T01:55:24.000Z',
    orderId: ORDER.id,
    actor,
    action,
    subject: ORDER.id,
    reason: '',
    evidence: [],
  }
}

function deps(entries: LedgerEntry[], over: Partial<ReleaseDeps> = {}): ReleaseDeps {
  return {
    entries: vi.fn(async () => entries),
    agree: vi.fn(async () => ({ ok: true as const })),
    start: vi.fn(async () => ({ ok: true as const })),
    refuse: vi.fn(async () => undefined),
    sayReady: vi.fn(),
    sayRestarted: vi.fn(),
    ...over,
  }
}

describe('readyToHandOff', () => {
  // Hand-off is the operator's (tests/hand-off.spec.ts): a draft nobody has
  // released waits for the button.
  it('waits for the operator when the order was never released', async () => {
    const d = deps([entry('order.seeded', 'role:scout')])
    expect(await readyToHandOff(ORDER, d)).toBe('waiting')
    expect(d.sayReady).toHaveBeenCalledWith(ORDER)
    expect(d.agree).not.toHaveBeenCalled()
    expect(d.start).not.toHaveBeenCalled()
  })

  it('agrees it again and restarts the run when the operator released it before', async () => {
    const d = deps([entry('order.agreed'), entry('run.started'), entry('gate.decided')])
    expect(await readyToHandOff(ORDER, d)).toBe('restarted')
    expect(d.agree).toHaveBeenCalledWith(ORDER)
    expect(d.start).toHaveBeenCalledWith(ORDER)
    expect(d.sayRestarted).toHaveBeenCalledWith(ORDER)
    expect(d.refuse).not.toHaveBeenCalled()
  })

  it('records exactly why when it could not be agreed, and does not start', async () => {
    const d = deps([entry('order.agreed')], {
      agree: vi.fn(async () => ({ ok: false as const, reason: 'AC-5 has no way to verify it.' })),
    })
    expect(await readyToHandOff(ORDER, d)).toBe('refused')
    expect(d.refuse).toHaveBeenCalledWith(ORDER, 'AC-5 has no way to verify it.')
    expect(d.start).not.toHaveBeenCalled()
  })

  it('records exactly why when the run would not start', async () => {
    const d = deps([entry('order.agreed')], {
      start: vi.fn(async () => ({ ok: false as const, reason: 'Unknown skill "ci-fix".' })),
    })
    expect(await readyToHandOff(ORDER, d)).toBe('refused')
    expect(d.refuse).toHaveBeenCalledWith(ORDER, 'Unknown skill "ci-fix".')
    expect(d.sayRestarted).not.toHaveBeenCalled()
  })
})
