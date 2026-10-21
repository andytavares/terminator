import { HOME_MEASURES, plural } from '@terminator/extension-sdk'
import type { ExtensionAPI } from '@terminator/extension-sdk'

import { surfacedQuestions } from '../forge/interview.js'
import type { FactoryMetrics } from '../factory/metrics.js'
import { documentKindOf, OPEN_LABEL } from '../line/document-kind.js'
import type { Gate } from '../gates/rules.js'
import type { WorkOrder } from '../order/schema.js'
import type { Standing } from '../order/standing.js'

// What Foundry tells Home, as pure data: one ask per order waiting on the operator,
// one facet per order in flight, and two measures. Core draws it (ADR 117); nothing
// here reads a record or calls the host.

type HomeFeed = Parameters<ExtensionAPI['home']['publish']>[0]
type HomeAsk = HomeFeed['asks'][number]
type HomeMeasure = HomeFeed['measures'][number]
type ThreadFacet = HomeFeed['facets'][number]
type WorkKey = ThreadFacet['workKey']

const DAY_MS = 24 * 60 * 60 * 1000

/** Everything the feed needs to know about one live order. */
export interface OrderRow {
  readonly order: WorkOrder
  readonly standing: Standing
  /** The gate holding the order, when one is. */
  readonly gate: Gate | null
  /** When the standing began: the gate's raise time, else the order's last event. */
  readonly since: string
  /** The order's last event. */
  readonly updatedAt: string
  /** When the order shipped, when it has. */
  readonly closedAt: string | null
  /** The first draft pull request the order opened, when it opened one. */
  readonly pullUrl: string | null
}

export interface HomeFeedInput {
  readonly rows: readonly OrderRow[]
  readonly metrics: FactoryMetrics
  readonly now: string
}

export function buildFoundryHomeFeed({ rows, metrics, now }: HomeFeedInput): HomeFeed {
  return {
    asks: rows.filter((row) => row.standing.turn === 'you').map(askOf),
    facets: rows.flatMap((row) => facetsOf(row, now)),
    measures: measuresOf(metrics),
  }
}

// The moves a gate offers that need nothing more from the operator: raising a budget
// wants a limit, taking over wants a session, stopping and holding are not a decision
// to make from a list.
const NEEDS_MORE_THAN_A_CLICK = new Set(['hold', 'stop', 'raise', 'take_over'])
const OPEN: HomeAsk['actions'][number] = { id: 'open', label: 'Open' }

function movesOf(gate: Gate | null): HomeAsk['actions'] {
  const moves = (gate?.options ?? [])
    .filter((option) => !NEEDS_MORE_THAN_A_CLICK.has(option.id))
    .slice(0, 2)
    .map(({ id, label }, index) => ({ id, label, ...(index === 0 ? { primary: true } : {}) }))
  return moves.length === 0 ? [{ ...OPEN, primary: true }] : [...moves, OPEN]
}

function askOf({ order, standing, gate, since }: OrderRow): HomeAsk {
  const { title, kind } = askKindOf(order, standing)
  return {
    id: gate === null ? `order:${order.id}` : `gate:${gate.id}`,
    kind,
    title,
    detail: standing.headline,
    where: orderWhere(order),
    facts: askFactsOf(order, standing),
    workKey: foundryWorkKeyOf(order),
    since,
    actions: movesOf(gate),
    open: { command: 'open-order', args: { orderId: order.id } },
  }
}

function askKindOf(order: WorkOrder, standing: Standing): Pick<HomeAsk, 'title' | 'kind'> {
  if (standing.gateId !== null) return { title: 'Foundry needs a decision', kind: 'decide' }
  if (standing.kind === 'asking') return { title: 'Foundry is asking', kind: 'answer' }
  if (standing.kind === 'shaping') {
    const asking = surfacedQuestions(order.openQuestions).length > 0
    return asking
      ? { title: 'Foundry is asking', kind: 'answer' }
      : { title: 'Foundry needs a decision', kind: 'decide' }
  }
  return { title: 'Foundry stopped', kind: 'fix' }
}

function askFactsOf(order: WorkOrder, standing: Standing): string[] {
  const lanes = order.plan.lanes.length
  const { wallClockMinutes } = order.budgets
  return [
    standing.detail,
    ...(order.status === 'draft' ? [`${lanes} ${plural(lanes, 'lane', 'lanes')}`] : []),
    ...(wallClockMinutes === null ? [] : [`about ${wallClockMinutes} min of agent time`]),
  ]
}

/** A ticket order is keyed by its ticket; any other by where its branch lives. */
/** "Workout Timer · order "Interval presets"": the repo folder's name and the order's title. */
function orderWhere(order: WorkOrder): string {
  const repo = order.context.repos[0]?.path.split('/').at(-1)
  return [repo, `order "${order.title}"`].filter(Boolean).join(' · ')
}

function foundryWorkKeyOf(order: WorkOrder): WorkKey | null {
  const { tracker, key } = order.source
  if (tracker !== null && key !== null) return { tracker, key }
  return branchKeyOf(order)
}

function branchKeyOf(order: WorkOrder): WorkKey | null {
  const repo = order.context.repos[0]
  if (repo === undefined) return null
  const branch = order.source.branch ?? repo.headBranch
  const named = branch === '' ? (order.plan.lanes[0]?.branch ?? '') : branch
  return named === '' ? null : { repoRoot: repo.path, branch: named }
}

function facetsOf(row: OrderRow, now: string): ThreadFacet[] {
  const workKey = foundryWorkKeyOf(row.order)
  if (workKey === null || isLongShipped(row, now)) return []
  const { order, standing } = row
  return [
    {
      workKey,
      kind: 'order',
      stage: stageOf(row),
      whoseMove: standing.turn === 'you' ? 'you' : 'agents',
      title: order.title,
      line: standing.headline,
      tone: toneOf(standing),
      ...(row.pullUrl === null ? {} : { url: row.pullUrl }),
      ...documentLinksOf(order),
      closedAt: row.closedAt,
      updatedAt: row.updatedAt,
    },
  ]
}

function documentLinksOf({ document }: WorkOrder): Pick<ThreadFacet, 'links'> {
  if (document?.url === undefined) return {}
  return { links: [{ label: OPEN_LABEL[documentKindOf(document)], url: document.url }] }
}

function isLongShipped({ order, closedAt }: OrderRow, now: string): boolean {
  if (order.status !== 'shipped') return false
  return closedAt === null || Date.parse(now) - Date.parse(closedAt) > DAY_MS
}

function stageOf({ order, pullUrl }: OrderRow): ThreadFacet['stage'] {
  if (order.status === 'shipped') return 'shipped'
  if (order.status === 'draft') return 'shaping'
  return pullUrl === null ? 'building' : 'in-review'
}

const STOPPED_KINDS: readonly Standing['kind'][] = [
  'stranded',
  'halted',
  'stalled',
  'adrift',
  'failed',
  'stopped',
]

function toneOf(standing: Standing): ThreadFacet['tone'] {
  if (STOPPED_KINDS.includes(standing.kind)) return 'bad'
  if (standing.turn === 'you') return 'waiting'
  return standing.kind === 'done' ? 'good' : 'neutral'
}

function measuresOf(metrics: FactoryMetrics): HomeMeasure[] {
  const measures: HomeMeasure[] = [
    {
      id: HOME_MEASURES.ordersShipped,
      question: 'Foundry orders shipped',
      detail: 'orders',
      value: metrics.shipped,
      unit: 'count',
      window: '30d',
      series: [],
    },
  ]
  if (metrics.firstPassYield !== null) {
    measures.push({
      id: HOME_MEASURES.firstPass,
      question: 'How often do Foundry orders pass first time?',
      detail: 'of Foundry orders passed their checks on the first try',
      value: Math.round(metrics.firstPassYield * 100),
      unit: 'percent',
      window: '30d',
      series: [],
    })
  }
  return measures
}
