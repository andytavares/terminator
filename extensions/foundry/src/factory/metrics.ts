import type { WorkOrder } from '../order/schema.js'
import type { LedgerEntry } from '../ledger/append.js'
import type { Gate } from '../gates/rules.js'
import type { RunGraph } from '../line/run-graph.js'

// The factory's own dashboard: nothing stored, everything recomputed from the
// ledger, the gates and the run graph an order already produced. A number
// that needed its own storage would be a second place the truth could drift
// from the record it is supposed to summarise.

const DAY_MS = 24 * 60 * 60 * 1000

export interface OrderRecords {
  readonly order: WorkOrder
  readonly ledger: readonly LedgerEntry[]
  readonly gates: readonly Gate[]
  readonly graph: RunGraph | null
}

export interface OrderMetrics {
  readonly orderId: string
  readonly title: string
  readonly shipped: boolean
  readonly leadTimeMs: number | null
  readonly buildTimeMs: number | null
  readonly yourTimeMs: number
  readonly reworks: number
  readonly ciRounds: number
  readonly sentBack: number
  readonly sessions: number
  readonly forgeFollowUps: number
  readonly forgeDecisions: number
  readonly forgeDecisionsStruck: number
  readonly firstPass: boolean
}

export interface FactoryMetrics {
  readonly window: '30d' | 'all'
  readonly orders: readonly OrderMetrics[]
  readonly shipped: number
  readonly medianLeadTimeMs: number | null
  readonly medianYourTimeMs: number | null
  readonly firstPassYield: number | null
  readonly reworksPerOrder: number | null
  readonly ciRoundsPerOrder: number | null
  readonly sessionsPerOrder: number | null
  readonly forgeFollowUps: number
  readonly forgeDecisionsStruckShare: number | null
}

function firstAt(entries: readonly LedgerEntry[], action: string): string | null {
  const found = entries.find((e) => e.action === action)
  return found ? found.at : null
}

function countOf(entries: readonly LedgerEntry[], action: string): number {
  return entries.filter((e) => e.action === action).length
}

function seededAt(records: OrderRecords): string {
  return firstAt(records.ledger, 'order.seeded') ?? records.order.createdAt
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function orderMetrics(records: OrderRecords): OrderMetrics {
  const { order, ledger, gates, graph } = records

  const shipped = ledger.some((e) => e.action === 'ship.draft_opened')
  const seeded = firstAt(ledger, 'order.seeded')
  const shippedAt = firstAt(ledger, 'ship.draft_opened')
  const started = firstAt(ledger, 'run.started')

  const leadTimeMs =
    seeded !== null && shippedAt !== null ? Date.parse(shippedAt) - Date.parse(seeded) : null
  const buildTimeMs =
    started !== null && shippedAt !== null ? Date.parse(shippedAt) - Date.parse(started) : null

  const yourTimeMs = gates.reduce((sum, gate) => {
    if (gate.decision === null || gate.decision.by !== 'operator') return sum
    return sum + (Date.parse(gate.decision.at) - Date.parse(gate.raisedAt))
  }, 0)

  const reworks = countOf(ledger, 'rework.started')
  const ciRounds = countOf(ledger, 'ci.round')
  const sentBack = gates.filter((g) => g.decision?.option === 'send_back').length
  const sessions = graph
    ? graph.nodes
        .filter((n) => n.kind === 'agent' || n.kind === 'fanout')
        .reduce((sum, n) => sum + n.attempts, 0)
    : 0
  const forgeFollowUps = countOf(ledger, 'converge.followed_up')
  const decisions = order.assumptions.filter((a) => a.id.startsWith('A-Q-'))

  return {
    orderId: order.id,
    title: order.title,
    shipped,
    leadTimeMs,
    buildTimeMs,
    yourTimeMs,
    reworks,
    ciRounds,
    sentBack,
    sessions,
    forgeFollowUps,
    forgeDecisions: decisions.length,
    forgeDecisionsStruck: decisions.filter((a) => a.struck).length,
    firstPass: shipped && reworks === 0 && ciRounds === 0 && sentBack === 0,
  }
}

export function factoryMetrics(
  all: readonly OrderRecords[],
  window: '30d' | 'all',
  now: string
): FactoryMetrics {
  const cutoff = Date.parse(now) - 30 * DAY_MS
  const inWindow = window === 'all' ? all : all.filter((r) => Date.parse(seededAt(r)) >= cutoff)
  const sorted = [...inWindow].sort((a, b) => Date.parse(seededAt(b)) - Date.parse(seededAt(a)))

  const orders = sorted.map(orderMetrics)
  const shippedOrders = orders.filter((o) => o.shipped)
  const shipped = shippedOrders.length

  const leadTimes = orders.map((o) => o.leadTimeMs).filter((v): v is number => v !== null)

  const totalDecisions = orders.reduce((sum, o) => sum + o.forgeDecisions, 0)
  const struckDecisions = orders.reduce((sum, o) => sum + o.forgeDecisionsStruck, 0)

  return {
    window,
    orders,
    shipped,
    medianLeadTimeMs: median(leadTimes),
    medianYourTimeMs: shipped === 0 ? null : median(shippedOrders.map((o) => o.yourTimeMs)),
    firstPassYield:
      shipped === 0 ? null : shippedOrders.filter((o) => o.firstPass).length / shipped,
    reworksPerOrder: shipped === 0 ? null : mean(shippedOrders.map((o) => o.reworks)),
    ciRoundsPerOrder: shipped === 0 ? null : mean(shippedOrders.map((o) => o.ciRounds)),
    sessionsPerOrder: shipped === 0 ? null : mean(shippedOrders.map((o) => o.sessions)),
    forgeFollowUps: orders.reduce((sum, o) => sum + o.forgeFollowUps, 0),
    forgeDecisionsStruckShare: totalDecisions === 0 ? null : struckDecisions / totalDecisions,
  }
}
