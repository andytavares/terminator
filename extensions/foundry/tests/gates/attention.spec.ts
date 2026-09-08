import { describe, it, expect } from 'vitest'
import { countAttention } from '../../src/gates/attention.js'
import { raiseGate } from '../../src/gates/rules.js'
import { draftOrder } from '../../src/order/schema.js'
import type { Gate, GateRuleId } from '../../src/gates/rules.js'
import type { OpenQuestion, WorkOrder } from '../../src/order/schema.js'

// The count behind the tab badge. It exists because Foundry holds work for a
// person on three surfaces and, before this, said so on none of them until you
// had already navigated to the right one.

function gate(over: Partial<Parameters<typeof raiseGate>[0]> = {}): Gate {
  return raiseGate({
    id: 'G-1',
    rule: 'risk.p0',
    orderId: 'WO-1',
    summary: 'U-4 rewrites session token refresh',
    why: 'the diff touches src/main/auth/session.ts',
    at: '2026-09-06T10:00:00.000Z',
    ...over,
  })
}

function question(id: string): OpenQuestion {
  return {
    id,
    text: `What about ${id}?`,
    why: '',
    options: ['yes', 'no'],
    recommended: 0,
    answer: null,
    rank: 1,
  }
}

function order(id: string, questions: OpenQuestion[], status?: WorkOrder['status']): WorkOrder {
  const base = draftOrder({
    id,
    title: id,
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repo/one'],
    now: '2026-09-06T09:00:00.000Z',
  })
  return { ...base, openQuestions: questions, status: status ?? base.status }
}

describe('countAttention', () => {
  it('counts undecided gates as the inbox badge', () => {
    const counts = countAttention({
      gates: [gate({ id: 'G-1' }), gate({ id: 'G-2', rule: 'destructive' })],
      autonomy: 'escorted',
      orders: [],
      pendingAsks: 0,
    })
    expect(counts.inbox).toBe(2)
  })

  it('does not count a gate that has already been decided', () => {
    const decided: Gate = {
      ...gate(),
      decision: { option: 'approve', by: 'operator', note: '', at: '2026-09-06T11:00:00.000Z' },
    }
    expect(
      countAttention({ gates: [decided], autonomy: 'escorted', orders: [], pendingAsks: 0 })
    ).toMatchObject({ inbox: 0 })
  })

  it('does not count a gate this autonomy setting silences', () => {
    // The badge has to mean the same thing the inbox does. A count that
    // includes rows the inbox filters out is a badge you learn to ignore.
    const silenced = 'unit.boundary' as GateRuleId
    const counts = countAttention({
      gates: [gate({ id: 'G-9', rule: silenced })],
      autonomy: 'lights-out',
      orders: [],
      pendingAsks: 0,
    })
    expect(counts.inbox).toBe(0)
  })

  it('counts open questions per order, and names which order is asking', () => {
    const counts = countAttention({
      gates: [],
      autonomy: 'standard',
      orders: [order('WO-1', [question('q1'), question('q2')]), order('WO-2', [question('q3')])],
      pendingAsks: 0,
    })
    expect(counts.forge).toBe(3)
    expect(counts.byOrder).toEqual({ 'WO-1': 2, 'WO-2': 1 })
  })

  it('leaves an answered question out', () => {
    const answered = { ...question('q1'), answer: 'yes' }
    const counts = countAttention({
      gates: [],
      autonomy: 'standard',
      orders: [order('WO-1', [answered])],
      pendingAsks: 0,
    })
    expect(counts.forge).toBe(0)
    expect(counts.byOrder).toEqual({})
  })

  it('ignores questions on an order that is no longer being agreed', () => {
    // Past draft the plan is fixed, so a leftover question is history rather
    // than a request — badging it sends the operator to a screen with no
    // control on it.
    for (const status of ['agreed', 'running', 'shipped', 'cancelled'] as const) {
      const counts = countAttention({
        gates: [],
        autonomy: 'standard',
        orders: [order('WO-1', [question('q1')], status)],
        pendingAsks: 0,
      })
      expect(counts.forge, status).toBe(0)
    }
  })

  it('adds held tool calls to the Forge count', () => {
    // The Floor is reached through the Forge tab, so an ask waiting there has
    // to raise that tab's badge or it is invisible from anywhere else.
    const counts = countAttention({
      gates: [],
      autonomy: 'standard',
      orders: [order('WO-1', [question('q1')])],
      pendingAsks: 2,
    })
    expect(counts.forge).toBe(3)
  })

  it('is zero across the board when nothing is waiting', () => {
    expect(countAttention({ gates: [], autonomy: 'standard', orders: [], pendingAsks: 0 })).toEqual(
      {
        inbox: 0,
        forge: 0,
        byOrder: {},
      }
    )
  })
})
