import { describe, it, expect } from 'vitest'
import { agentNode } from '../helpers/run-nodes.js'
import { countAttention } from '../../src/gates/attention.js'
import { raiseGate } from '../../src/gates/rules.js'
import { draftOrder } from '../../src/order/draft.js'
import { standingOf } from '../../src/order/standing.js'
import type { StandingInput } from '../../src/order/standing.js'
import type { Gate, GateRuleId } from '../../src/gates/rules.js'
import type { OpenQuestion, WorkOrder } from '../../src/order/schema.js'
import { openQuestion } from '../helpers/order-parts.js'

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

/** An unanswered yes-or-no question that recommends yes. */
function yesOrNoQuestion(id: string): OpenQuestion {
  return openQuestion(id, { text: `What about ${id}?`, options: ['yes', 'no'], recommended: 0 })
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
  describe('undecided gates', undecidedGatesTests)
  describe('silenced gates and questions', silencedGatesAndQuestionsTests)
  describe('answered and stale questions', answeredAndStaleQuestionsTests)
  describe('held calls and signals', heldCallsAndSignalsTests)
  describe('nothing waiting', attentionNothingWaitingTests)
  describe('orders waiting on you', ordersWaitingOnYouTests)
  describe('double counting', doubleCountingTests)
  describe("Foundry's move", foundrysMoveTests)
})

function undecidedGatesTests() {
  it('counts undecided gates as the inbox badge', () => {
    const counts = countAttention({
      gates: [gate({ id: 'G-1' }), gate({ id: 'G-2', rule: 'unit.boundary' })],
      autonomy: 'escorted',
      orders: [],
      pendingAsks: 0,
      waiting: [],
    })
    expect(counts.inbox).toBe(2)
  })

  it('does not count a gate that has already been decided', () => {
    const decided: Gate = {
      ...gate(),
      decision: { option: 'approve', by: 'operator', note: '', at: '2026-09-06T11:00:00.000Z' },
    }
    expect(
      countAttention({
        gates: [decided],
        autonomy: 'escorted',
        orders: [],
        pendingAsks: 0,
        waiting: [],
      })
    ).toMatchObject({ inbox: 0 })
  })
}

function silencedGatesAndQuestionsTests() {
  it('does not count a gate this autonomy setting silences', () => {
    // The badge has to mean the same thing the inbox does. A count that
    // includes rows the inbox filters out is a badge you learn to ignore.
    const silenced = 'unit.boundary' as GateRuleId
    const counts = countAttention({
      gates: [gate({ id: 'G-9', rule: silenced })],
      autonomy: 'lights-out',
      orders: [],
      pendingAsks: 0,
      waiting: [],
    })
    expect(counts.inbox).toBe(0)
  })

  it('counts open questions per order, and names which order is asking', () => {
    const counts = countAttention({
      gates: [],
      autonomy: 'standard',
      orders: [
        order('WO-1', [yesOrNoQuestion('q1'), yesOrNoQuestion('q2')]),
        order('WO-2', [yesOrNoQuestion('q3')]),
      ],
      pendingAsks: 0,
      waiting: [],
    })
    expect(counts.forge).toBe(3)
    expect(counts.byOrder).toEqual({ 'WO-1': 2, 'WO-2': 1 })
  })
}

function answeredAndStaleQuestionsTests() {
  it('leaves an answered question out', () => {
    const answered = { ...yesOrNoQuestion('q1'), answer: 'yes' }
    const counts = countAttention({
      gates: [],
      autonomy: 'standard',
      orders: [order('WO-1', [answered])],
      pendingAsks: 0,
      waiting: [],
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
        orders: [order('WO-1', [yesOrNoQuestion('q1')], status)],
        pendingAsks: 0,
        waiting: [],
      })
      expect(counts.forge).toBe(0)
    }
  })
}

function heldCallsAndSignalsTests() {
  it('adds held tool calls to the Forge count', () => {
    // The Floor is reached through the Forge tab, so an ask waiting there has
    // to raise that tab's badge or it is invisible from anywhere else.
    const counts = countAttention({
      gates: [],
      autonomy: 'standard',
      orders: [order('WO-1', [yesOrNoQuestion('q1')])],
      pendingAsks: 2,
      waiting: [],
    })
    expect(counts.forge).toBe(3)
  })

  it('takes no notice of open signals — the badge counts gates only', () => {
    // Sensor signals live in the Inbox as their own section, not in this
    // count: `AttentionInput` carries gates, orders and held tool calls, and
    // nothing that reads `signals.list`. An order seeded from a signal is
    // just an order once it exists, so it is counted the same as any other —
    // draft-status questions raise `forge`, and being signal-sourced adds
    // nothing to `inbox`.
    const fromASignal = order('WO-1', [], 'draft')
    const counts = countAttention({
      gates: [],
      autonomy: 'standard',
      orders: [fromASignal],
      pendingAsks: 0,
      waiting: [],
    })
    expect(counts).toEqual({ inbox: 0, forge: 0, byOrder: {} })
  })
}

function attentionNothingWaitingTests() {
  it('is zero across the board when nothing is waiting', () => {
    expect(
      countAttention({
        gates: [],
        autonomy: 'standard',
        orders: [],
        pendingAsks: 0,
        waiting: [],
      })
    ).toEqual({
      inbox: 0,
      forge: 0,
      byOrder: {},
    })
  })
}

function ordersWaitingOnYouTests() {
  // WO-1008-287 sat amended and ready with both badges at zero and the Inbox
  // saying "Nothing needs you". Anything whose turn is the operator's, and
  // that no gate or question already counts, is counted here.
  it('counts an order waiting on you that no gate or question covers', () => {
    const counts = countAttention({
      gates: [],
      autonomy: 'standard',
      orders: [order('WO-1', [])],
      pendingAsks: 0,
      waiting: [
        { orderId: 'WO-1', standing: standingOf(standing({ status: 'draft', shaping: false })) },
      ],
    })
    expect(counts.inbox).toBe(1)
  })

  it('does not count an order twice when a gate is already holding it', () => {
    const held = gate({ orderId: 'WO-1' })
    const counts = countAttention({
      gates: [held],
      autonomy: 'escorted',
      orders: [],
      pendingAsks: 0,
      waiting: [{ orderId: 'WO-1', standing: standingOf(standing({ gates: [held] })) }],
    })
    expect(counts.inbox).toBe(1)
  })
}

function doubleCountingTests() {
  it('does not count an order twice when its questions are already counted', () => {
    const counts = countAttention({
      gates: [],
      autonomy: 'standard',
      orders: [order('WO-1', [yesOrNoQuestion('q1')])],
      pendingAsks: 0,
      waiting: [
        { orderId: 'WO-1', standing: standingOf(standing({ status: 'draft', openQuestions: 1 })) },
      ],
    })
    expect(counts).toMatchObject({ inbox: 0, forge: 1 })
  })

  it('does not count held tool calls twice', () => {
    const counts = countAttention({
      gates: [],
      autonomy: 'standard',
      orders: [],
      pendingAsks: 1,
      waiting: [{ orderId: 'WO-1', standing: standingOf(standing({ asks: 1 })) }],
    })
    expect(counts).toMatchObject({ inbox: 0, forge: 1 })
  })
}

function foundrysMoveTests() {
  it('leaves out an order that is Foundry\u2019s move', () => {
    const counts = countAttention({
      gates: [],
      autonomy: 'standard',
      orders: [],
      pendingAsks: 0,
      waiting: [{ orderId: 'WO-1', standing: standingOf(standing({})) }],
    })
    expect(counts.inbox).toBe(0)
  })
}

function standing(over: Partial<StandingInput>): StandingInput {
  return {
    status: 'running',
    graph: {
      orderId: 'WO-1',
      recipe: 'direct',
      nodes: [agentNode('build', { state: 'running' })],
    },
    gates: [],
    asks: 0,
    orphaned: [],
    stalls: 0,
    openQuestions: 0,
    failures: 0,
    stranded: 0,
    intakeRefused: null,
    runFailure: null,
    shaping: true,
    blocker: null,
    ...over,
  }
}
