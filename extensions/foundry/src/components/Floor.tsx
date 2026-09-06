import React, { useCallback, useEffect, useState } from 'react'
import { Terminal, ShieldQuestion, Square, CornerDownLeft } from 'lucide-react'
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

/** A tool call an agent is holding at, waiting for an answer. */
interface PendingAsk {
  requestId: string
  sessionId: string
  toolName: string
  summary: string
  detail: string | null
  at: number
}

/** How often the live half is refetched. Slow enough to be cheap, fast
 *  enough that an agent is not left holding a tool call for a visible pause. */
const LIVE_POLL_MS = 2000

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
  const [pending, setPending] = useState<PendingAsk[]>([])
  const [transcript, setTranscript] = useState<string[]>([])
  const [watching, setWatching] = useState<string | null>(null)
  const [redirect, setRedirect] = useState('')

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

  // The live half: what an agent is holding at, and what it has been saying.
  //
  // Polled rather than pushed because a surface that misses one event shows a
  // stale answer for ever, and a held tool call shown as answered is the worst
  // of those — the agent is genuinely stopped, waiting on somebody who has
  // been told there is nothing to do.
  const pollLive = useCallback(async () => {
    const asks = (await invoke('foundry:permissions-list')) as { pending?: PendingAsk[] }
    setPending(asks.pending ?? [])
    if (watching !== null) {
      const tail = (await invoke('foundry:run-transcript', {
        sessionId: watching,
        limit: 40,
      })) as { lines?: string[] }
      setTranscript(tail.lines ?? [])
    }
  }, [watching])

  useEffect(() => {
    void pollLive()
    const timer = setInterval(() => void pollLive(), LIVE_POLL_MS)
    return () => clearInterval(timer)
  }, [pollLive])

  const answer = useCallback(
    async (ask: PendingAsk, decision: 'allow' | 'deny') => {
      const result = (await invoke('foundry:permission-resolve', {
        requestId: ask.requestId,
        decision,
      })) as { ok: boolean; reason?: string }
      // A click that did nothing is worse than a refusal that says why.
      if (!result.ok) setProblem(result.reason ?? 'that request is no longer waiting')
      await pollLive()
    },
    [pollLive]
  )

  const handBack = useCallback(
    async (ask: PendingAsk) => {
      await invoke('foundry:permission-hand-back', { requestId: ask.requestId })
      await invoke('foundry:run-terminal', { sessionId: ask.sessionId })
      await pollLive()
    },
    [pollLive]
  )

  const control = useCallback(
    async (channel: string, payload: Record<string, unknown>) => {
      const result = (await invoke(channel, payload)) as { ok?: boolean }
      if (result.ok !== true) setProblem('that run is no longer live')
      await pollLive()
    },
    [pollLive]
  )

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
                    <>
                      <button
                        type="button"
                        className="fdry-unit-attach"
                        aria-label={`Watch ${node.id}`}
                        onClick={() => setWatching(node.sessionId)}
                      >
                        <ShieldQuestion aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="fdry-unit-attach"
                        aria-label={`Attach to ${node.id}`}
                        onClick={() => void attach(node.id)}
                      >
                        <Terminal aria-hidden="true" />
                      </button>
                    </>
                  ) : null}
                </span>
              ))}
          </div>
        </div>
      ))}

      {/* Held tool calls, oldest first — the order they must be answered in.
          This is the UI-first half of the promise: the terminal is the
          backstop, not the only way to answer. */}
      {pending.length > 0 ? (
        <section className="fdry-panel" style={{ marginTop: 12 }}>
          <h3 className="fdry-panel-h">Waiting on you — {pending.length}</h3>
          {pending.map((ask) => (
            <div key={ask.requestId} className="fdry-ask">
              <span className="fdry-ask-icon" aria-hidden="true">
                <ShieldQuestion />
              </span>
              <div className="fdry-ask-main">
                <b>{ask.summary}</b>
                <small>
                  <code>{ask.toolName}</code>
                </small>
                {ask.detail !== null ? <pre className="fdry-ask-detail">{ask.detail}</pre> : null}
              </div>
              <div className="fdry-ask-actions">
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => void answer(ask, 'allow')}
                >
                  Allow
                </button>
                <button type="button" onClick={() => void answer(ask, 'deny')}>
                  Deny
                </button>
                <button
                  type="button"
                  title="Answer it in the terminal instead"
                  onClick={() => void handBack(ask)}
                >
                  <Terminal aria-hidden="true" /> In the terminal
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {/* What the agent has been saying, and the three things you can do to it
          without leaving. */}
      {watching !== null ? (
        <section className="fdry-panel" style={{ marginTop: 12 }}>
          <h3 className="fdry-panel-h">{watching}</h3>
          <pre className="fdry-transcript">
            {transcript.length === 0 ? 'Nothing yet.' : transcript.join('\n')}
          </pre>
          <form
            className="fdry-redirect"
            onSubmit={(event) => {
              event.preventDefault()
              if (redirect.trim() === '') return
              void control('foundry:run-redirect', {
                sessionId: watching,
                message: redirect.trim(),
              })
              setRedirect('')
            }}
          >
            <input
              aria-label="Tell it what to do instead"
              placeholder="Tell it what to do instead…"
              value={redirect}
              onChange={(event) => setRedirect(event.target.value)}
            />
            <button type="submit" disabled={redirect.trim() === ''}>
              <CornerDownLeft aria-hidden="true" /> Redirect
            </button>
            <button
              type="button"
              onClick={() => void control('foundry:run-interrupt', { sessionId: watching })}
            >
              Interrupt
            </button>
            <button
              type="button"
              onClick={() =>
                void control('foundry:run-stop', {
                  sessionId: watching,
                  reason: 'stopped from the floor',
                })
              }
            >
              <Square aria-hidden="true" /> Stop
            </button>
          </form>
        </section>
      ) : null}

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
