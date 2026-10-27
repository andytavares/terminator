import type { AgentState, TerminalSession } from '../../shared/types/index'

/**
 * Where a session's AgentState comes from. One implementation exists today;
 * the seam is here so a better signal can replace it without the UI changing.
 */
interface AgentStateSource {
  derive(session: TerminalSession): AgentState
}

// Facts first: PTY exit, then the ask and the turn Claude Code's hooks report (`agentAsk`,
// `agentTurn`). Then guesses: a bell or on-screen choice (flagged by `inferredAskSignal`).
// A hooked agent between turns is idle however its terminal prints; otherwise byte flow decides.
export class BellAndBusySource implements AgentStateSource {
  derive(session: TerminalSession): AgentState {
    if (session.status === 'closed') return 'exited'
    if (session.surface === 'agent') return agentTabState(session)
    if (session.agentAsk !== undefined || inferredAskSignal(session) !== null) {
      return 'awaiting-input'
    }
    if (session.agentTurn === true) return 'working'
    if (session.agentTurn !== undefined) return 'idle'
    return session.busy ? 'working' : 'idle'
  }
}

/** An agent tab has no bell or byte flow: its turn and ask are the whole truth. */
function agentTabState(session: TerminalSession): AgentState {
  if (session.agentAsk !== undefined) return 'awaiting-input'
  return session.agentTurn === true ? 'working' : 'idle'
}

/** Which guess says the session is asking, when no hook did: the bell outranks a screen choice. */
export function inferredAskSignal(session: TerminalSession): 'bell' | 'choice' | null {
  if (session.agentAsk !== undefined) return null
  if ((session.bellCount ?? 0) > 0) return 'bell'
  return session.choicePrompt !== undefined ? 'choice' : null
}

const signals = new BellAndBusySource()

/** A session's state, from its signals: the `agentState` a session is stored with never changes. */
export function agentStateOf(session: TerminalSession): AgentState {
  return signals.derive(session)
}
