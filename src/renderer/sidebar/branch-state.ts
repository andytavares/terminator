import { STATUS_ORDER } from './view-model'
import type { AgentState, TerminalSession } from '../../shared/types/index'

/**
 * The one state a branch row shows, folded from the terminals open on it.
 *
 * Severity comes from STATUS_ORDER rather than a second list of its own: the
 * sidebar gutter, the tab glyph and the board lanes all read that constant, so
 * they cannot disagree about which state outranks which.
 *
 * A branch with no terminals is idle, not exited. Folding an empty list would
 * otherwise land on the last entry in the order, and a branch you have not
 * opened yet is not a finished one.
 */
export function aggregateBranchState(sessions: TerminalSession[]): AgentState {
  let best = STATUS_ORDER.length
  for (const session of sessions) {
    const rank = STATUS_ORDER.indexOf(session.agentState)
    if (rank !== -1 && rank < best) best = rank
  }
  return best === STATUS_ORDER.length ? 'idle' : STATUS_ORDER[best]
}

/**
 * How many terminals are in `state`.
 *
 * A row's count is paired with its glyph, so it counts the state the glyph is
 * showing rather than totalling everything on the branch — "two waiting"
 * answers the question the row exists to answer; "three terminals" does not.
 */
export function countInState(sessions: TerminalSession[], state: AgentState): number {
  return sessions.reduce((n, session) => (session.agentState === state ? n + 1 : n), 0)
}
