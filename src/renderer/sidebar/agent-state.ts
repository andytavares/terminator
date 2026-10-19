import type { AgentState, TerminalSession } from '../../shared/types/index'

/**
 * Where a session's AgentState comes from. One implementation exists today;
 * the seam is here so a better signal can replace it without the UI changing.
 */
interface AgentStateSource {
  derive(session: TerminalSession): AgentState
}

/**
 * Derives state from the signals core owns: PTY exit, the terminal bell, byte
 * flow, a numbered choice prompt read off the screen when output settles, and
 * the question a Claude Code Notification hook reported (`agentAsk`, installed
 * by core beside its SessionStart hook).
 *
 * Without an ask, `awaiting-input` is inferred from the bell and the screen, so
 * an agent that waits without either reads as idle; a shell-launched agent
 * that is not Claude Code emits no hook at all.
 */
export class BellAndBusySource implements AgentStateSource {
  derive(session: TerminalSession): AgentState {
    if (session.status === 'closed') return 'exited'
    // Bell outranks byte flow: a session that rings while still printing is
    // asking for you, which is the costlier signal to miss. A numbered choice
    // left on screen asks just as plainly, and agents rarely ring (054).
    if (session.agentAsk !== undefined) return 'awaiting-input'
    if ((session.bellCount ?? 0) > 0 || session.choicePrompt !== undefined) return 'awaiting-input'
    if (session.busy) return 'working'
    return 'idle'
  }
}

const signals = new BellAndBusySource()

/** A session's state, from its signals: the `agentState` a session is stored with never changes. */
export function agentStateOf(session: TerminalSession): AgentState {
  return signals.derive(session)
}
