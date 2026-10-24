import type { AgentState, TerminalSession } from '../../shared/types/index'

/**
 * Where a session's AgentState comes from. One implementation exists today;
 * the seam is here so a better signal can replace it without the UI changing.
 */
interface AgentStateSource {
  derive(session: TerminalSession): AgentState
}

/**
 * Derives state from the signals core owns: PTY exit, the question and the
 * turn that Claude Code's own hooks report (`agentAsk`, `agentTurn`, installed
 * by core beside its SessionStart hook), and, where no hook speaks, guesses:
 * the terminal bell, a numbered choice read off the screen, and byte flow.
 *
 * Order: exited; a reported ask; a bell or on-screen choice (a guess, flagged
 * by `inferredAsk`); a reported turn in progress is working; a terminal that
 * has reported hooks but is between turns is idle even while bytes flow
 * (redraws, a spinner); otherwise byte flow decides. A shell-launched agent
 * that is not Claude Code emits no hook at all, so it stays on the guesses.
 */
export class BellAndBusySource implements AgentStateSource {
  derive(session: TerminalSession): AgentState {
    if (session.status === 'closed') return 'exited'
    if (session.agentAsk !== undefined || inferredAskSignal(session) !== null) {
      return 'awaiting-input'
    }
    if (session.agentTurn === true) return 'working'
    if (session.agentTurn !== undefined) return 'idle'
    return session.busy ? 'working' : 'idle'
  }
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
