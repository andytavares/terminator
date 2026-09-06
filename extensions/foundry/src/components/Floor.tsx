import React, { useCallback, useEffect, useState } from 'react'
import { Terminal } from 'lucide-react'
import type { RunGraph, RunNode } from '../line/run-graph.js'

// Where you watch, not where you act.
//
// Everything actionable has already been lifted out into the inbox, so this
// surface is read-only by design — with one exception. Attach drops you into
// any running agent's live session, because however good a structured view
// gets, there are moments when the only useful thing is to be in the terminal
// typing at it.

interface Blocked {
  id: string
  reason: string
}

/** One repository this order spans, and what it is waiting for. */
interface LaneRow {
  ord: number
  repo: string
  role: 'producer' | 'consumer' | null
  collisions: string[]
  blockedBy: number[]
  /** Why this lane cannot merge yet, in the rule's own words. Null when it can. */
  hold: string | null
}

interface FloorView {
  graph: RunGraph
  ready: string[]
  blocked: Blocked[]
  lanes?: LaneRow[]
}

const STATE_LABEL: Record<RunNode['state'], string> = {
  waiting: 'waiting',
  ready: 'ready',
  running: 'building',
  verifying: 'verifying',
  passed: 'verified',
  failed: 'failed',
  blocked: 'blocked',
  skipped: 'skipped',
}

function invoke(channel: string, payload: unknown = {}): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

/**
 * The repository, where the order names one.
 *
 * "lane 2" is a number the operator did not choose and cannot map to
 * anything; `cli-flow` is where the work is happening.
 */
function laneName(view: FloorView, lane: number): string {
  if (lane === 0) return 'steps'
  const named = view.lanes?.find((row) => row.ord === lane)
  return named === undefined ? `lane ${lane}` : named.repo
}

export interface FloorProps {
  readonly orderId: string
}

export function Floor({ orderId }: FloorProps): JSX.Element {
  const [view, setView] = useState<FloorView | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const next = (await invoke('foundry:run.observe', { id: orderId })) as
      | FloorView
      | { error: string }
    if ('error' in next) {
      setProblem(next.error)
      return
    }
    setProblem(null)
    setView(next)
  }, [orderId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const attach = useCallback(
    async (nodeId: string) => {
      const r = (await invoke('foundry:session.attach', { orderId, nodeId })) as
        | { terminalSessionId: string }
        | { error: string }
      if ('error' in r) setProblem(r.error)
    },
    [orderId]
  )

  if (problem !== null && view === null) return <p className="fdry-note">{problem}</p>
  if (view === null) return <div className="fdry-empty">Loading the run…</div>

  const lanes = [...new Set(view.graph.nodes.map((n) => n.lane ?? 0))].sort((a, b) => a - b)

  return (
    <div className="fdry-shell">
      <h2 className="fdry-panel-h">
        {view.graph.orderId} · {view.graph.recipe}
      </h2>

      {/* Only where there is more than one repository. A single-lane order
          gets no merge-order section at all, because "1 of 1, merges first"
          is ceremony over nothing (FR-068). */}
      {(view.lanes?.length ?? 0) > 1 ? (
        <section className="fdry-panel" style={{ marginBottom: 12 }}>
          <h3 className="fdry-panel-h">Merge order</h3>
          <ol className="fdry-merge">
            {view.lanes?.map((row) => (
              <li key={row.ord} className={row.hold === null ? '' : 'is-held'}>
                <b>{row.repo}</b>
                {row.role === null ? null : <span className="fdry-role">{row.role}</span>}
                {row.collisions.length > 0 ? (
                  <small>shares {row.collisions.join(', ')}</small>
                ) : null}
                {row.hold === null ? (
                  <small>free to merge</small>
                ) : (
                  <small className="fdry-hold">{row.hold}</small>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {lanes.map((lane) => (
        <div key={lane} className="fdry-lane">
          <div className="fdry-lane-name">
            <b>{laneName(view, lane)}</b>
          </div>
          <div className="fdry-units">
            {view.graph.nodes
              .filter((n) => (n.lane ?? 0) === lane)
              .map((node) => (
                <span key={node.id} className={`fdry-unit is-${node.state}`}>
                  {node.id}
                  <u>{STATE_LABEL[node.state]}</u>
                  {node.sessionId !== null ? (
                    <button
                      type="button"
                      className="fdry-unit-attach"
                      aria-label={`Attach to ${node.id}`}
                      onClick={() => void attach(node.id)}
                    >
                      <Terminal aria-hidden="true" />
                    </button>
                  ) : null}
                </span>
              ))}
          </div>
        </div>
      ))}

      {view.blocked.length > 0 ? (
        <section className="fdry-panel" style={{ marginTop: 12 }}>
          <h3 className="fdry-panel-h">Blocked</h3>
          {view.blocked.map((entry) => (
            <p key={entry.id} className="fdry-note">
              <b>{entry.id}</b> — {entry.reason}
            </p>
          ))}
        </section>
      ) : null}

      {problem !== null ? <p className="fdry-problem">{problem}</p> : null}
    </div>
  )
}
