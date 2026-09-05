import type { AgentState, TerminalSession } from '../../shared/types/index'

// This module is the pure core of the sidebar: it decides *what* is shown from
// (data, view, now) and knows nothing about React, the stores, or the clock.
// Keeping it free of those imports is what makes the layout reversible and the
// behaviour exhaustively testable — do not import anything but types here.

/**
 * How the branch list is bucketed.
 *
 * Narrowed from five. `project` and `branch` collapsed into the row itself once
 * a branch became the listed item, and `status` became redundant when every row
 * started carrying its own state glyph (FR-038).
 */
export type GroupKey = 'workspace' | 'none'
export type SortKey = 'recent' | 'oldest' | 'name' | 'status' | 'manual'

export interface SessionFilters {
  query?: string
  states?: AgentState[]
  projectIds?: string[]
  hideStale?: boolean
  staleOnly?: boolean
}

export interface SessionView {
  id: string
  name: string
  groupBy: GroupKey
  sortBy: SortKey
  filters: SessionFilters
  builtIn?: boolean
}

/** Severity order, shared by every surface that ranks states so none disagree. */
export const STATUS_ORDER: AgentState[] = ['awaiting-input', 'working', 'idle', 'exited']

/**
 * A session is stale when it has exited, or when it has been quiet for longer
 * than the threshold. A session waiting on you is never stale however long it
 * waits — it is blocked on you, which is the opposite of abandoned.
 *
 * `now` is a parameter, never read from the clock, so staleness recomputes as
 * time passes and stays testable at its boundaries.
 */
export function isStale(session: TerminalSession, now: number, staleAfterMs: number): boolean {
  if (session.agentState === 'exited') return true
  if (session.agentState === 'awaiting-input') return false
  return now - session.lastActivityAt > staleAfterMs
}
