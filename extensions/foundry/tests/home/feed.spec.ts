import { describe, it, expect } from 'vitest'

import { buildFoundryHomeFeed } from '../../src/home/feed.js'
import type { OrderRow } from '../../src/home/feed.js'
import type { Gate } from '../../src/gates/rules.js'
import { raiseGate } from '../../src/gates/rules.js'
import type { WorkOrder } from '../../src/order/schema.js'
import type { Standing } from '../../src/order/standing.js'
import type { FactoryMetrics } from '../../src/factory/metrics.js'
import { runningOrder, openQuestion } from '../helpers/order-parts.js'

const NOW = '2026-10-18T12:00:00.000Z'

function standingWith(over: Partial<Standing> = {}): Standing {
  return {
    kind: 'working',
    turn: 'foundry',
    label: 'building 1/3',
    headline: 'Building',
    detail: '1 agent is working — 1 of 3 steps done.',
    done: 1,
    total: 3,
    gateId: null,
    ...over,
  }
}

/** A running order on a branch, the way an architect's plan names one. */
function orderOnBranch(id: string, over: Partial<WorkOrder> = {}): WorkOrder {
  const base = runningOrder(id, ['src/a.ts'], { title: 'Interval presets', ...over })
  const source = { ...base.source, branch: base.source.branch ?? `${id.toLowerCase()}-presets` }
  return { ...base, source }
}

function orderRow(over: Partial<OrderRow> = {}): OrderRow {
  return {
    order: orderOnBranch('WO-1'),
    standing: standingWith(),
    gate: null,
    since: '2026-10-18T11:00:00.000Z',
    updatedAt: '2026-10-18T11:30:00.000Z',
    closedAt: null,
    pullUrl: null,
    ...over,
  }
}

const NO_METRICS: FactoryMetrics = {
  window: '30d',
  orders: [],
  shipped: 0,
  medianLeadTimeMs: null,
  medianYourTimeMs: null,
  firstPassYield: null,
  reworksPerOrder: null,
  ciRoundsPerOrder: null,
  sessionsPerOrder: null,
  forgeFollowUps: 0,
  forgeDecisionsStruckShare: null,
}

function riskGate(): Gate {
  return raiseGate({
    id: 'G-1',
    rule: 'risk.p0',
    orderId: 'WO-1',
    summary: 'A riskier change than planned',
    why: 'touches payments',
    at: '2026-10-18T11:10:00.000Z',
  })
}

function feedOf(rows: OrderRow[], metrics = NO_METRICS) {
  return buildFoundryHomeFeed({ rows, metrics, now: NOW })
}

describe('asks', () => {
  it('raises one ask for an order whose turn is the operator', () => {
    const feed = feedOf([
      orderRow({
        standing: standingWith({ kind: 'failed', turn: 'you', headline: '2 steps failed' }),
      }),
    ])
    expect(feed.asks).toHaveLength(1)
    expect(feed.asks[0]).toMatchObject({
      kind: 'fix',
      title: 'Foundry stopped',
      detail: '2 steps failed',
      since: '2026-10-18T11:00:00.000Z',
    })
  })

  it('raises nothing for an order whose turn is Foundry', () => {
    expect(feedOf([orderRow()]).asks).toEqual([])
  })

  it.each([
    ['stranded', 'Foundry stopped'],
    ['halted', 'Foundry stopped'],
    ['failed', 'Foundry stopped'],
    ['stopped', 'Foundry stopped'],
    ['asking', 'Foundry is asking'],
  ] as const)('titles a %s standing "%s"', (kind, title) => {
    const feed = feedOf([orderRow({ standing: standingWith({ kind, turn: 'you' }) })])
    expect(feed.asks[0].title).toBe(title)
  })
})

describe('where an ask comes from', () => {
  it("says where the ask comes from: the repo and the order's title", () => {
    const row = orderRow({ standing: standingWith({ kind: 'failed', turn: 'you' }) })
    const [ask] = feedOf([row]).asks
    const repo = row.order.context.repos[0].path.split('/').at(-1)
    expect(ask.where).toBe(`${repo} · order "${row.order.title}"`)
  })
})

describe('asks that name a move', () => {
  it('titles a gate "Foundry needs a decision" and offers the options the gate has', () => {
    const gate = riskGate()
    const feed = feedOf([
      orderRow({
        gate,
        since: gate.raisedAt,
        standing: standingWith({ kind: 'halted', turn: 'you', gateId: gate.id }),
      }),
    ])
    const ask = feed.asks[0]
    expect(ask.title).toBe('Foundry needs a decision')
    expect(ask.kind).toBe('decide')
    expect(ask.id).toBe(`gate:${gate.id}`)
    expect(ask.actions.map((a) => a.id)).toEqual(['approve', 'send_back', 'open'])
    expect(ask.actions[0]).toMatchObject({ label: 'Approve', primary: true })
    expect(ask.actions.filter((a) => a.primary)).toHaveLength(1)
  })

  it('never offers a move a gate does not have: a ready draft only opens', () => {
    const feed = feedOf([
      orderRow({
        order: orderOnBranch('WO-1', { status: 'draft' }),
        standing: standingWith({ kind: 'shaping', turn: 'you', headline: 'Ready to hand off' }),
      }),
    ])
    expect(feed.asks[0].title).toBe('Foundry needs a decision')
    expect(feed.asks[0].actions).toEqual([{ id: 'open', label: 'Open', primary: true }])
  })
})

describe('asks about a draft', () => {
  it('titles a draft with open questions "Foundry is asking"', () => {
    const feed = feedOf([
      orderRow({
        order: orderOnBranch('WO-1', {
          status: 'draft',
          openQuestions: [openQuestion('Q-1')],
        }),
        standing: standingWith({ kind: 'shaping', turn: 'you', headline: '1 question to answer' }),
      }),
    ])
    expect(feed.asks[0]).toMatchObject({ title: 'Foundry is asking', kind: 'answer' })
  })

  it('states the plan as facts when it has one', () => {
    const feed = feedOf([
      orderRow({
        order: orderOnBranch('WO-1', { status: 'draft' }),
        standing: standingWith({ kind: 'shaping', turn: 'you' }),
      }),
    ])
    expect(feed.asks[0].facts).toContain('1 lane')
  })
})

describe('facet stage and tone', () => {
  it.each([
    ['draft', null, 'shaping'],
    ['agreed', null, 'building'],
    ['running', null, 'building'],
    ['running', 'https://github.com/o/r/pull/9', 'in-review'],
    ['shipped', 'https://github.com/o/r/pull/9', 'shipped'],
  ] as const)('maps status %s with pull %s to stage %s', (status, pullUrl, stage) => {
    const closedAt = status === 'shipped' ? '2026-10-18T10:00:00.000Z' : null
    const feed = feedOf([orderRow({ order: orderOnBranch('WO-1', { status }), pullUrl, closedAt })])
    expect(feed.facets[0]).toMatchObject({ kind: 'order', stage, closedAt })
  })

  it('maps whose move it is', () => {
    const feed = feedOf([
      orderRow({ standing: standingWith({ turn: 'you', kind: 'failed' }) }),
      orderRow({ order: orderOnBranch('WO-2') }),
    ])
    expect(feed.facets.map((f) => f.whoseMove)).toEqual(['you', 'agents'])
  })

  it('carries the standing headline as the line and the order title', () => {
    const [facet] = feedOf([orderRow()]).facets
    expect(facet).toMatchObject({
      line: 'Building',
      title: 'Interval presets',
      updatedAt: '2026-10-18T11:30:00.000Z',
    })
  })
})

describe('facet work keys', () => {
  it('keys a ticket order by its tracker and key', () => {
    const order = orderOnBranch('WO-1', {
      source: { kind: 'tracker', tracker: 'linear', key: 'WT-12', url: null },
    })
    expect(feedOf([orderRow({ order })]).facets[0].workKey).toEqual({
      tracker: 'linear',
      key: 'WT-12',
    })
  })

  it('keys any other order by its repository and branch', () => {
    const order = orderOnBranch('WO-1', {
      source: { kind: 'typed', tracker: null, key: null, url: null, branch: 'wt-12-presets' },
    })
    expect(feedOf([orderRow({ order })]).facets[0].workKey).toEqual({
      repoRoot: '/repos/a',
      branch: 'wt-12-presets',
    })
  })

  it('drops an order shipped more than a day ago', () => {
    const feed = feedOf([
      orderRow({
        order: orderOnBranch('WO-1', { status: 'shipped' }),
        closedAt: '2026-10-16T10:00:00.000Z',
      }),
    ])
    expect(feed.facets).toEqual([])
  })
})

describe('measures', () => {
  it('reports orders shipped and the first-pass share in the 30 day window', () => {
    const { measures } = feedOf([], { ...NO_METRICS, shipped: 2, firstPassYield: 0.5 })
    expect(measures).toMatchObject([
      { id: 'orders-shipped', value: 2, unit: 'count', window: '30d' },
      { id: 'first-pass', value: 50, unit: 'percent', window: '30d' },
    ])
  })

  it('leaves the first-pass share out when nothing has shipped', () => {
    expect(feedOf([]).measures.map((m) => m.id)).toEqual(['orders-shipped'])
  })
})
