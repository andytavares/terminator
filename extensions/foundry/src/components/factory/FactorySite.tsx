import React, { useCallback, useState } from 'react'
import type { Standing } from '../../order/standing.js'
import type { FactoryMetrics } from '../../factory/metrics.js'
import { MetricsTiles, WindowToggle } from '../MetricsTiles.js'
import type { Signal } from '../../sensors/types.js'
import type { CiState } from '../../line/ci-state.js'
import { DocumentChip } from '../DocumentChip.js'
import type { DocumentLink } from '../../line/document-kind.js'
import { HallThumbnail } from './HallThumbnail.js'
import { ciLabel } from '../../line/ci-label.js'
import { Button } from '@terminator/extension-ui'
import { usePushed, ANY_RECORD } from '../../renderer/use-pushed.js'
import { invoke } from '@terminator/extension-sdk/renderer'
import { usePromotion, useSignalFeed } from '../../renderer/use-signals.js'

// The Factory's front door: every order in the workspace, as a hall card, in
// place of the list rows `Orders.tsx` draws in List mode.

export interface FactoryOrderRow {
  readonly id: string
  readonly title: string
  readonly status: string
  /** Absent, like `standing`, from a host part way through an upgrade. */
  readonly createdAt?: string
  /** The document the author handed back outside the checkout; absent or null when none. */
  readonly document?: DocumentLink | null
  /**
   * Where the order stands, and whose move it is.
   *
   * Optional for the same reason `Orders.tsx`'s own row carries it as
   * optional: the list is polled, and a host part way through an upgrade
   * answers without one — the card shows the title alone rather than
   * guessing.
   */
  readonly standing?: Standing
  /**
   * Where this order's CI stands, in brief.
   *
   * Null when nothing has shipped a pull yet, and absent (like `standing`)
   * when the host answering the list has never heard of CI.
   */
  readonly ci?: {
    readonly status: CiState['status']
    readonly round: number
    readonly max: number
  } | null
  /**
   * Where this order stands in the refinery's file-overlap queue.
   *
   * Null when it is not in a queue at all, and absent (like `standing`) when
   * the host answering the list has never heard of the refinery.
   */
  readonly queue?: {
    readonly position: number
    readonly behind: {
      readonly orderId: string
      readonly title: string
      readonly files: string[]
    }[]
  } | null
}

interface QueueChainToken {
  readonly id: string
  readonly title: string
  readonly position: number
}

interface QueueChain {
  readonly tokens: readonly QueueChainToken[]
  /** Shared-file count between each token and the next one — one shorter than `tokens`. */
  readonly joins: readonly number[]
}

/** Which orders are joined, through any number of others: a union-find over their ids. */
class Joins {
  private readonly parent = new Map<string, string>()

  find(id: string): string {
    let root = id
    while (this.parent.has(root)) root = this.parent.get(root) as string
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

/** What the list says of the queues: each order's title and place, who sits behind whom, and over how many files. */
interface QueueFacts {
  readonly title: Map<string, string>
  readonly position: Map<string, number>
  readonly shared: Map<string, number>
  readonly joins: Joins
}

const pairKey = (a: string, b: string): string => [a, b].sort().join('|')

function queueFacts(rows: readonly FactoryOrderRow[]): QueueFacts {
  const facts: QueueFacts = {
    title: new Map(),
    position: new Map(),
    shared: new Map(),
    joins: new Joins(),
  }
  for (const row of rows) {
    facts.title.set(row.id, row.title)
    if (row.queue != null) facts.position.set(row.id, row.queue.position)
  }
  for (const row of rows) {
    if (row.queue == null) continue
    for (const entry of row.queue.behind) {
      facts.title.set(entry.orderId, entry.title)
      facts.joins.union(row.id, entry.orderId)
      facts.shared.set(pairKey(row.id, entry.orderId), entry.files.length)
    }
  }
  return facts
}

/** Every order named, grouped with the ones it is joined to. */
function groupsOf({ title, joins }: QueueFacts): Set<string>[] {
  const groups = new Map<string, Set<string>>()
  for (const id of title.keys()) {
    const root = joins.find(id)
    const group = groups.get(root) ?? new Set<string>()
    group.add(id)
    groups.set(root, group)
  }
  return [...groups.values()]
}

/** One group as a chain, in queue order, with the files shared at each join. */
function chainOf(group: ReadonlySet<string>, { title, position, shared }: QueueFacts): QueueChain {
  const tokens = [...group]
    .map((id) => ({ id, title: title.get(id) ?? id, position: position.get(id) ?? 0 }))
    .sort((a, b) => a.position - b.position)
  const joins = tokens
    .slice(1)
    .map((token, index) => shared.get(pairKey(tokens[index].id, token.id)) ?? 0)
  return { tokens, joins }
}

// The refinery's queues as chains of orders that overlap on disk, grouped by
// connected component: two orders sharing files are one queue whatever repository.
function refineryChains(rows: readonly FactoryOrderRow[]): QueueChain[] {
  const facts = queueFacts(rows)
  return groupsOf(facts)
    .filter((group) => group.size >= 2)
    .map((group) => chainOf(group, facts))
}

/** Finished, with nothing left for anyone to do. A shipped order still
 *  holding a gate is the operator's move, and stays with the active ones. */
function isCompleted(row: FactoryOrderRow): boolean {
  return row.standing === undefined ? row.status === 'shipped' : row.standing.kind === 'done'
}

interface GridProps {
  readonly rows: readonly FactoryOrderRow[]
  readonly onOpen: (order: FactoryOrderRow) => void
}

function HallGrid({ rows, onOpen }: GridProps): JSX.Element {
  return (
    <div className="fdry-hall-grid">
      {rows.map((row) => (
        <HallCard key={row.id} row={row} onOpen={onOpen} />
      ))}
    </div>
  )
}

/** What a card's thumbnail is drawn again for: a change in status, standing or CI round. */
function refreshKeyOf(row: FactoryOrderRow): string {
  return `${row.status}:${row.standing?.kind ?? ''}:${row.ci?.status ?? ''}:${row.ci?.round ?? ''}`
}

// A link cannot sit inside the card's button, so the card is a box holding both:
// the button opens the order, and the document's link sits below it.
function HallCard({ row, onOpen }: { readonly row: FactoryOrderRow } & Pick<GridProps, 'onOpen'>) {
  return (
    <div className={isCompleted(row) ? 'fdry-hall-card is-done' : 'fdry-hall-card'}>
      <HallCardButton row={row} onOpen={onOpen} />
      {row.document ? (
        <span className="fdry-order-links fdry-hall-card-links">
          <DocumentChip document={row.document} />
        </span>
      ) : null}
    </div>
  )
}

function HallCardButton({
  row,
  onOpen,
}: { readonly row: FactoryOrderRow } & Pick<GridProps, 'onOpen'>) {
  return (
    <button type="button" className="fdry-hall-card-open" onClick={() => onOpen(row)}>
      {row.standing?.turn === 'you' ? (
        <span className="fdry-hall-card-beacon" aria-hidden="true" />
      ) : null}
      <HallThumbnail orderId={row.id} title={row.title} refreshKey={refreshKeyOf(row)} />
      <b className="fdry-hall-card-title">{row.title}</b>
      {row.standing === undefined ? null : (
        <span className="fdry-hall-card-state">{row.standing.label}</span>
      )}
      {row.ci ? <span className="fdry-hall-card-ci">{ciLine(row.ci)}</span> : null}
    </button>
  )
}

export interface FactorySiteProps {
  readonly repoRoot: string | null
  readonly onOpen: (order: FactoryOrderRow) => void
}

/** The CI round in the words every other surface uses (`ciLabel`). A row
 *  carries no reason, so an unmeasured CI says only that. */
function ciLine(ci: NonNullable<FactoryOrderRow['ci']>): string {
  return `CI · ${ci.status === 'not_measured' ? 'not measured yet' : ciLabel({ ...ci, reason: '' })}`
}

function newestFirst(a: FactoryOrderRow, b: FactoryOrderRow): number {
  const byTime = (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  return byTime !== 0 ? byTime : b.id.localeCompare(a.id)
}

/** How often the sensors' signals are asked for. Sensors record on their own
 *  tick and announce nothing; orders and metrics are pushed. */
const SIGNALS_POLL_MS = 4000

async function readOrders(): Promise<FactoryOrderRow[]> {
  const r = (await invoke('foundry:order.list')) as { orders?: FactoryOrderRow[] }
  // Newest first, with the id breaking ties rather than whatever order the
  // store returned: a grid that reshuffles itself between polls is unreadable.
  return [...(r.orders ?? [])].sort(newestFirst)
}

async function readMetrics(window: '30d' | 'all'): Promise<FactoryMetrics | null> {
  const r = (await invoke('foundry:factory.metrics', { window })) as
    | FactoryMetrics
    | { error: string }
  return 'error' in r ? null : r
}

/** Every order, and the factory's numbers over the window chosen; both pushed. */
function useSiteRecords() {
  const [rows, setRows] = useState<FactoryOrderRow[]>([])
  const [window_, setWindow] = useState<'30d' | 'all'>('30d')
  const [metrics, setMetrics] = useState<FactoryMetrics | null>(null)
  const readMetricsFor = useCallback(() => readMetrics(window_), [window_])
  const showMetrics = useCallback((read: FactoryMetrics | null): void => {
    if (read !== null) setMetrics(read)
  }, [])
  usePushed(readOrders, setRows, { kinds: ANY_RECORD })
  usePushed(readMetricsFor, showMetrics, { kinds: ANY_RECORD })
  return { rows, window_, setWindow, metrics }
}

/** The sensors' signals on the dock, and promoting one into a draft. */
function useDock() {
  const { signals, sensors, refreshSignals } = useSignalFeed(SIGNALS_POLL_MS)
  return { signals, ...usePromotion(sensors, refreshSignals) }
}

type Dock = ReturnType<typeof useDock>

export function FactorySite({ onOpen }: FactorySiteProps): JSX.Element {
  const { rows, window_, setWindow, metrics } = useSiteRecords()
  const dock = useDock()
  return (
    <div className="fdry-site">
      <aside className="fdry-status-wall" aria-label="Status wall">
        <h3 className="fdry-panel-h">Status wall</h3>
        <WindowToggle value={window_} onChange={setWindow} />
        {metrics === null ? (
          <p className="fdry-note">Loading…</p>
        ) : (
          <MetricsTiles metrics={metrics} />
        )}
      </aside>
      <div className="fdry-site-main">
        {dock.signals.length > 0 ? <SignalDock dock={dock} /> : null}
        <OrderHalls rows={rows} onOpen={onOpen} />
        <Refinery chains={refineryChains(rows)} />
      </div>
    </div>
  )
}

function SignalDock({ dock }: { readonly dock: Dock }) {
  return (
    <div className="fdry-dock" aria-label="Dock">
      <h3 className="fdry-panel-h">Dock</h3>
      {dock.signalProblem !== null ? <p className="fdry-problem">{dock.signalProblem}</p> : null}
      {dock.promoted !== null ? <p className="fdry-note">{dock.promoted}</p> : null}
      <div className="fdry-dock-crates">
        {dock.signals.map((signal) => (
          <Crate key={signal.id} signal={signal} dock={dock} />
        ))}
      </div>
    </div>
  )
}

function Crate({ signal, dock }: { readonly signal: Signal; readonly dock: Dock }) {
  return (
    <div className="fdry-crate">
      <b>{signal.title}</b>
      <span className="fdry-crate-meta">
        ×{signal.occurrences} · {signal.severity}
      </span>
      {dock.promoting === signal.id ? (
        <DockPromoteForm signal={signal} dock={dock} />
      ) : (
        <Button
          variant="primary"
          size="sm"
          className="fdry-crate-action"
          onClick={() => dock.startPromote(signal)}
        >
          Promote
        </Button>
      )}
    </div>
  )
}

function DockPromoteForm({ signal, dock }: { readonly signal: Signal; readonly dock: Dock }) {
  return (
    <div className="fdry-crate-promote">
      <label>
        Repository
        <input
          type="text"
          value={dock.repoDraft}
          placeholder="/path/to/repo"
          onChange={(event) => dock.setRepoDraft(event.target.value)}
        />
      </label>
      <Button
        variant="primary"
        size="sm"
        disabled={dock.repoDraft.trim() === ''}
        onClick={() => void dock.confirmPromote(signal.id)}
      >
        Confirm promote
      </Button>
      <Button size="sm" onClick={() => dock.setPromoting(null)}>
        Cancel
      </Button>
    </div>
  )
}

function OrderHalls({ rows, onOpen }: GridProps) {
  if (rows.length === 0) {
    return <p className="fdry-note">No orders yet. Start one from the List view.</p>
  }
  const completed = rows.filter(isCompleted)
  const active = rows.filter((row) => !isCompleted(row))
  return (
    <>
      <section className="fdry-hall-section" aria-label="Active">
        <h3 className="fdry-panel-h">Active</h3>
        {active.length === 0 ? (
          <p className="fdry-note">Nothing running.</p>
        ) : (
          <HallGrid rows={active} onOpen={onOpen} />
        )}
      </section>
      {completed.length > 0 ? (
        <section className="fdry-hall-section" aria-label="Completed">
          <h3 className="fdry-panel-h fdry-group-h--done">Completed</h3>
          <HallGrid rows={completed} onOpen={onOpen} />
        </section>
      ) : null}
    </>
  )
}

/** Which orders sit behind which on disk; nothing when none is queued (R5). */
function Refinery({ chains }: { readonly chains: readonly QueueChain[] }) {
  if (chains.length === 0) return null
  return (
    <section className="fdry-refinery" aria-label="Refinery">
      <h3 className="fdry-panel-h">Refinery</h3>
      {chains.map((chain) => (
        <div key={chain.tokens[0].id} className="fdry-refinery-track">
          {chain.tokens.map((token, index) => (
            <React.Fragment key={token.id}>
              {index > 0 ? <ChainJoin files={chain.joins[index - 1]} /> : null}
              <span className="fdry-refinery-token">{token.title}</span>
            </React.Fragment>
          ))}
        </div>
      ))}
    </section>
  )
}

function ChainJoin({ files }: { readonly files: number }) {
  return (
    <span className="fdry-refinery-join">
      {files} {files === 1 ? 'shared file' : 'shared files'}
    </span>
  )
}
