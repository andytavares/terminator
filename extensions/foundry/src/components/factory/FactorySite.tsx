import React, { useCallback, useEffect, useState } from 'react'
import type { Standing } from '../../order/standing.js'
import type { FactoryMetrics } from '../../factory/metrics.js'
import { MetricsTiles, WindowToggle } from '../MetricsTiles.js'

// The Factory's front door: every order in the workspace, as a hall card, in
// place of the list rows `Orders.tsx` draws in List mode.

export interface FactoryOrderRow {
  readonly id: string
  readonly title: string
  readonly status: string
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
  readonly ci?: { readonly status: string; readonly round: number; readonly max: number } | null
}

export interface FactorySiteProps {
  readonly repoRoot: string | null
  readonly onOpen: (order: FactoryOrderRow) => void
}

function invoke(channel: string, payload: unknown = {}): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

/** How often the grid is refetched. Slower than a live run's own poll: this
 *  is a door, not a dashboard. */
const POLL_MS = 4000

export function FactorySite({ onOpen }: FactorySiteProps): JSX.Element {
  const [rows, setRows] = useState<FactoryOrderRow[]>([])
  const [window_, setWindow] = useState<'30d' | 'all'>('30d')
  const [metrics, setMetrics] = useState<FactoryMetrics | null>(null)

  const refresh = useCallback(async () => {
    const r = (await invoke('foundry:order.list')) as { orders?: FactoryOrderRow[] }
    // Sorted by id rather than left in whatever order the store returned it:
    // a grid that reshuffles itself between polls is unreadable.
    setRows([...(r.orders ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const refreshMetrics = useCallback(async () => {
    const r = (await invoke('foundry:factory.metrics', { window: window_ })) as
      | FactoryMetrics
      | { error: string }
    if ('error' in r) return
    setMetrics(r)
  }, [window_])

  useEffect(() => {
    void refreshMetrics()
    const timer = setInterval(() => void refreshMetrics(), POLL_MS)
    return () => clearInterval(timer)
  }, [refreshMetrics])

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
      {rows.length === 0 ? (
        <p className="fdry-note">No orders yet. Start one from the List view.</p>
      ) : (
        <div className="fdry-hall-grid">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className="fdry-hall-card"
              onClick={() => onOpen(row)}
            >
              {row.standing?.turn === 'you' ? (
                <span className="fdry-hall-card-beacon" aria-hidden="true" />
              ) : null}
              <b>{row.title}</b>
              {row.standing === undefined ? null : (
                <span className="fdry-hall-card-state">{row.standing.label}</span>
              )}
              {row.ci ? (
                <span className="fdry-hall-card-ci">{`CI ${row.ci.round}/${row.ci.max} · ${row.ci.status}`}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
