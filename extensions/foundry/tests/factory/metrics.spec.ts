import { describe, it, expect } from 'vitest'
import { orderMetrics, factoryMetrics } from '../../src/factory/metrics.js'
import { draftOrder } from '../../src/order/schema.js'
import type { OrderRecords } from '../../src/factory/metrics.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { LedgerEntry } from '../../src/ledger/append.js'
import type { Gate } from '../../src/gates/rules.js'
import type { RunGraph } from '../../src/line/run-graph.js'

const NOW = '2026-09-26T00:00:00.000Z'

function entry(
  over: Partial<LedgerEntry> & Pick<LedgerEntry, 'orderId' | 'action' | 'at'>
): LedgerEntry {
  return {
    actor: 'rule:test',
    subject: '',
    reason: '',
    evidence: [],
    ...over,
  }
}

function gate(over: Partial<Gate> & Pick<Gate, 'id' | 'orderId' | 'raisedAt'>): Gate {
  return {
    rule: 'risk.p0',
    nodeId: null,
    summary: '',
    why: 'test',
    evidence: [],
    options: [],
    defaultIfIgnored: 'hold',
    deadline: null,
    blockedUnits: 0,
    riskGrade: 'P3',
    decision: null,
    breach: null,
    ...over,
  }
}

function order(
  id: string,
  title: string,
  createdAt: string,
  over: Partial<WorkOrder> = {}
): WorkOrder {
  const base = draftOrder({
    id,
    title,
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repo/one'],
    now: createdAt,
  })
  return { ...base, ...over }
}

// Order A: clean shipped order. Seeded and run both an hour apart, ships a
// day later, no gates, no reworks, no CI rounds — a first-pass ship.
const orderA = order('WO-A', 'Order A', '2026-08-31T23:00:00.000Z')
const ledgerA: LedgerEntry[] = [
  entry({ orderId: 'WO-A', action: 'order.seeded', at: '2026-09-01T00:00:00.000Z' }),
  entry({ orderId: 'WO-A', action: 'run.started', at: '2026-09-01T01:00:00.000Z' }),
  entry({ orderId: 'WO-A', action: 'ship.draft_opened', at: '2026-09-02T00:00:00.000Z' }),
]
const graphA: RunGraph = {
  orderId: 'WO-A',
  recipe: 'default',
  nodes: [
    {
      id: 'agent-1',
      stepId: 'agent-1',
      kind: 'agent',
      state: 'passed',
      unitIds: [],
      lane: null,
      role: null,
      dependsOn: [],
      attempts: 1,
      reworks: 0,
      feedback: [],
      sessionId: null,
      worktreePath: null,
      startedAt: null,
      endedAt: null,
    },
    {
      id: 'fanout-1',
      stepId: 'fanout-1',
      kind: 'fanout',
      state: 'passed',
      unitIds: [],
      lane: null,
      role: null,
      dependsOn: [],
      attempts: 2,
      reworks: 0,
      feedback: [],
      sessionId: null,
      worktreePath: null,
      startedAt: null,
      endedAt: null,
    },
    {
      id: 'run-1',
      stepId: 'run-1',
      kind: 'run',
      state: 'passed',
      unitIds: [],
      lane: null,
      role: null,
      dependsOn: [],
      attempts: 5,
      reworks: 0,
      feedback: [],
      sessionId: null,
      worktreePath: null,
      startedAt: null,
      endedAt: null,
    },
  ],
}
const recordsA: OrderRecords = { order: orderA, ledger: ledgerA, gates: [], graph: graphA }

// Order B: shipped after one rework, plus an operator gate (200s) and a
// send_back decision that must not add to your time.
const orderB = order('WO-B', 'Order B', '2026-09-04T23:00:00.000Z')
const ledgerB: LedgerEntry[] = [
  entry({ orderId: 'WO-B', action: 'order.seeded', at: '2026-09-05T00:00:00.000Z' }),
  entry({ orderId: 'WO-B', action: 'run.started', at: '2026-09-05T02:00:00.000Z' }),
  entry({ orderId: 'WO-B', action: 'rework.started', at: '2026-09-05T10:00:00.000Z' }),
  entry({ orderId: 'WO-B', action: 'ship.draft_opened', at: '2026-09-06T12:00:00.000Z' }),
]
const gatesB: Gate[] = [
  gate({
    id: 'G-B1',
    orderId: 'WO-B',
    raisedAt: '2026-09-05T11:00:00.000Z',
    decision: { option: 'approve', by: 'operator', note: '', at: '2026-09-05T11:03:20.000Z' },
  }),
  gate({
    id: 'G-B2',
    orderId: 'WO-B',
    rule: 'verify.repeat-fail',
    raisedAt: '2026-09-05T12:00:00.000Z',
    decision: { option: 'send_back', by: 'operator', note: '', at: '2026-09-05T12:00:00.000Z' },
  }),
]
const recordsB: OrderRecords = { order: orderB, ledger: ledgerB, gates: gatesB, graph: null }

// Order C: shipped, one CI round, an operator gate (90s) and an unrelated
// default-decided gate whose large gap must not count as your time.
const orderC = order('WO-C', 'Order C', '2026-09-09T23:00:00.000Z')
const ledgerC: LedgerEntry[] = [
  entry({ orderId: 'WO-C', action: 'order.seeded', at: '2026-09-10T00:00:00.000Z' }),
  entry({ orderId: 'WO-C', action: 'run.started', at: '2026-09-10T01:00:00.000Z' }),
  entry({ orderId: 'WO-C', action: 'ci.round', at: '2026-09-10T05:00:00.000Z' }),
  entry({ orderId: 'WO-C', action: 'ship.draft_opened', at: '2026-09-10T18:00:00.000Z' }),
]
const gatesC: Gate[] = [
  gate({
    id: 'G-C1',
    orderId: 'WO-C',
    raisedAt: '2026-09-10T12:00:00.000Z',
    decision: { option: 'approve', by: 'operator', note: '', at: '2026-09-10T12:01:30.000Z' },
  }),
  gate({
    id: 'G-C2',
    orderId: 'WO-C',
    rule: 'budget.exceeded',
    raisedAt: '2026-09-10T13:00:00.000Z',
    decision: { option: 'hold', by: 'default', note: '', at: '2026-09-10T14:00:00.000Z' },
  }),
]
const recordsC: OrderRecords = { order: orderC, ledger: ledgerC, gates: gatesC, graph: null }

// Order D: never shipped. Two Forge decisions (A-Q-*), one struck, plus one
// follow-up. Not counted in any "per shipped order" average.
const orderD = order('WO-D', 'Order D', '2026-09-14T23:00:00.000Z', {
  assumptions: [
    { id: 'A-Q-1', text: 'q1', struck: true, affects: [] },
    { id: 'A-Q-2', text: 'q2', struck: false, affects: [] },
    { id: 'A-OTHER', text: 'not a forge decision', struck: true, affects: [] },
  ],
})
const ledgerD: LedgerEntry[] = [
  entry({ orderId: 'WO-D', action: 'order.seeded', at: '2026-09-15T00:00:00.000Z' }),
  entry({ orderId: 'WO-D', action: 'converge.followed_up', at: '2026-09-15T01:00:00.000Z' }),
]
const recordsD: OrderRecords = { order: orderD, ledger: ledgerD, gates: [], graph: null }

// Order E: seeded 40 days before `now` — dropped by the 30d window.
const orderE = order('WO-E', 'Order E', '2026-08-16T23:00:00.000Z')
const ledgerE: LedgerEntry[] = [
  entry({ orderId: 'WO-E', action: 'order.seeded', at: '2026-08-17T00:00:00.000Z' }),
  entry({ orderId: 'WO-E', action: 'ship.draft_opened', at: '2026-08-17T05:00:00.000Z' }),
]
const recordsE: OrderRecords = { order: orderE, ledger: ledgerE, gates: [], graph: null }

describe('orderMetrics', () => {
  it('computes a clean first-pass ship', () => {
    const m = orderMetrics(recordsA)
    expect(m.shipped).toBe(true)
    expect(m.leadTimeMs).toBe(24 * 60 * 60 * 1000)
    expect(m.buildTimeMs).toBe(23 * 60 * 60 * 1000)
    expect(m.yourTimeMs).toBe(0)
    expect(m.reworks).toBe(0)
    expect(m.ciRounds).toBe(0)
    expect(m.sentBack).toBe(0)
    expect(m.sessions).toBe(3) // 1 (agent) + 2 (fanout); the run node's 5 don't count
    expect(m.firstPass).toBe(true)
  })

  it('counts a rework and disqualifies first-pass, ignores a send_back gate in your time', () => {
    const m = orderMetrics(recordsB)
    expect(m.reworks).toBe(1)
    expect(m.sentBack).toBe(1)
    expect(m.yourTimeMs).toBe(200_000) // only the 200s "approve" gate
    expect(m.firstPass).toBe(false)
    expect(m.leadTimeMs).toBe(36 * 60 * 60 * 1000)
    expect(m.buildTimeMs).toBe(34 * 60 * 60 * 1000)
  })

  it('counts a CI round and an operator gate, ignores a default-decided gate', () => {
    const m = orderMetrics(recordsC)
    expect(m.ciRounds).toBe(1)
    expect(m.yourTimeMs).toBe(90_000)
    expect(m.firstPass).toBe(false)
  })

  it('reads Forge decisions from A-Q-* assumptions and their struck state', () => {
    const m = orderMetrics(recordsD)
    expect(m.shipped).toBe(false)
    expect(m.leadTimeMs).toBeNull()
    expect(m.buildTimeMs).toBeNull()
    expect(m.forgeFollowUps).toBe(1)
    expect(m.forgeDecisions).toBe(2)
    expect(m.forgeDecisionsStruck).toBe(1)
    expect(m.firstPass).toBe(false)
  })
})

describe('factoryMetrics', () => {
  const all = [recordsA, recordsB, recordsC, recordsD, recordsE]

  it('sorts orders newest-first by order.seeded and drops nothing in "all"', () => {
    const fm = factoryMetrics(all, 'all', NOW)
    expect(fm.orders.map((o) => o.orderId)).toEqual(['WO-D', 'WO-C', 'WO-B', 'WO-A', 'WO-E'])
  })

  it('drops an order seeded 40 days before now in the 30d window', () => {
    const fm = factoryMetrics(all, '30d', NOW)
    expect(fm.orders.map((o) => o.orderId)).not.toContain('WO-E')
    expect(fm.orders).toHaveLength(4)
  })

  it('computes yield, medians and per-order rates over shipped orders only', () => {
    const fm = factoryMetrics(all, '30d', NOW)
    expect(fm.shipped).toBe(3) // A, B, C
    expect(fm.firstPassYield).toBe(1 / 3)
    expect(fm.medianLeadTimeMs).toBe(24 * 60 * 60 * 1000) // [18h, 24h, 36h] -> 24h
    expect(fm.medianYourTimeMs).toBe(90_000) // [0, 90000, 200000] -> 90000
    expect(fm.reworksPerOrder).toBeCloseTo(1 / 3)
    expect(fm.ciRoundsPerOrder).toBeCloseTo(1 / 3)
    expect(fm.sessionsPerOrder).toBeCloseTo(1) // (3+0+0)/3
    expect(fm.forgeFollowUps).toBe(1)
    expect(fm.forgeDecisionsStruckShare).toBe(0.5)
  })

  it('reports nulls when nothing has shipped', () => {
    const fm = factoryMetrics([recordsD], 'all', NOW)
    expect(fm.shipped).toBe(0)
    expect(fm.firstPassYield).toBeNull()
    expect(fm.medianYourTimeMs).toBeNull()
    expect(fm.reworksPerOrder).toBeNull()
    expect(fm.ciRoundsPerOrder).toBeNull()
    expect(fm.sessionsPerOrder).toBeNull()
    expect(fm.medianLeadTimeMs).toBeNull() // D has no leadTime
  })
})
