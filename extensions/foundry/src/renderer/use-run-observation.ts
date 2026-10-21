import { useCallback, useState } from 'react'
import { usePushed, ANY_RECORD } from './use-pushed.js'
import type { RunGraph } from '../line/run-graph.js'
import type { Standing } from '../order/standing.js'
import type { Gate } from '../gates/rules.js'
import type { CiState } from '../line/ci-state.js'
import type { DocumentLink } from '../line/document-outcome.js'
import { invoke } from '@terminator/extension-sdk/renderer'

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
  /** The pull requests the run opened. `cwd` is the checkout a review opens against. */
  pulls?: { repo: string; url: string; number: number; cwd: string }[]
  /** The ticket the order came from; null for an idea typed in. */
  source?: { key: string; url: string } | null
  /** The document the author handed back outside the checkout; null when there is none. */
  document?: DocumentLink | null
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

async function readPending(): Promise<PendingAsk[]> {
  const asks = (await invoke('foundry:permissions-list')) as { pending?: PendingAsk[] }
  return asks.pending ?? []
}

export interface UseRunObservation {
  view: FloorView | null
  problem: string | null
  pending: PendingAsk[]
  refresh: () => Promise<void>
}

/**
 * The Floor's run observation, read again whenever Foundry says this order's
 * records or live state changed rather than fetched once.
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

  const readObservation = useCallback(
    async () =>
      (await invoke('foundry:run.observe', { id: orderId })) as FloorView | { error: string },
    [orderId]
  )
  const showObservation = useCallback((next: FloorView | { error: string }): void => {
    if ('error' in next) {
      setProblem(next.error)
      return
    }
    setProblem(null)
    setView(next)
  }, [])

  const refresh = useCallback(
    () => readObservation().then(showObservation),
    [readObservation, showObservation]
  )

  usePushed(readObservation, showObservation, { kinds: ANY_RECORD, orderId })
  usePushed(readPending, setPending, { kinds: ['live'] })

  return { view, problem, pending, refresh }
}
