import { useCallback, useEffect, useState } from 'react'
import type { RunGraph } from '../line/run-graph.js'
import type { Standing } from '../order/standing.js'
import type { Gate } from '../gates/rules.js'
import type { CiState } from '../line/ci-state.js'

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

interface Blocked {
  id: string
  reason: string
}

export interface FloorView {
  graph: RunGraph
  /** What the operator called this order. The heading was two identifiers. */
  title?: string | null
  /**
   * Where the run stands, and whose move it is.
   *
   * Optional because this is polled and a host part way through an upgrade
   * answers without one — the panel draws the run and no band rather than
   * blanking.
   */
  standing?: Standing
  /** Gates holding this order, undecided. Answerable from here. */
  waiting?: Gate[]
  /**
   * Agents parked at their terminal's own prompt.
   *
   * A tool call nobody answered in time is handed back there, and an
   * unattended run never reaches it — so the agent stops with its process
   * alive and its node still `running`. The only thing that answers one is
   * going to that terminal, which is what these are for.
   */
  stranded?: string[]
  /** What to call each node, keyed by id — worked out where the order is. */
  labels?: Record<string, string>
  ready: string[]
  blocked: Blocked[]
  lanes?: LaneRow[]
  /**
   * Steps the graph calls running that nothing is actually running.
   *
   * An agent's terminal is a child of the application, so quitting kills every
   * one while the graph goes on saying `running`. Without this the chips for a
   * dead run and a working one are the same chips.
   */
  orphaned?: string[]
  /** The draft's CI, from the ship tail's own file. Absent means no run has shipped yet. */
  ci?: CiState | null
  /** Skills each node gets, keyed by node id. Absent nodes have none. */
  skills?: Record<string, string[]>
  /**
   * Where this order stands in the refinery's file-overlap queue.
   *
   * Null when it is not in a queue at all — nothing else agreed against the
   * same repository and base touches the same files. Present and `behind:
   * []` means it is first in line.
   */
  queue?: {
    position: number
    behind: { orderId: string; title: string; files: string[] }[]
  } | null
}

/** A tool call an agent is holding at, waiting for an answer. */
export interface PendingAsk {
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

function invoke(channel: string, payload: unknown = {}): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

export interface UseRunObservation {
  view: FloorView | null
  problem: string | null
  pending: PendingAsk[]
  refresh: () => Promise<void>
}

/**
 * The Floor's run observation, polled rather than fetched once.
 *
 * A single call on mount left every state chip a snapshot of whenever the
 * panel happened to open: a run that halted, failed or finished while you
 * were looking at it went on drawing `building` until you navigated away and
 * back.
 */
export function useRunObservation(orderId: string): UseRunObservation {
  const [view, setView] = useState<FloorView | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAsk[]>([])

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
    const timer = setInterval(() => void refresh(), LIVE_POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const pollPending = useCallback(async () => {
    const asks = (await invoke('foundry:permissions-list')) as { pending?: PendingAsk[] }
    setPending(asks.pending ?? [])
  }, [])

  useEffect(() => {
    void pollPending()
    const timer = setInterval(() => void pollPending(), LIVE_POLL_MS)
    return () => clearInterval(timer)
  }, [pollPending])

  return { view, problem, pending, refresh }
}
