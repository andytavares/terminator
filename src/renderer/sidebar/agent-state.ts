import type { AgentState, TerminalSession } from '../../shared/types/index'

/**
 * Where a session's AgentState comes from. One implementation exists today;
 * the seam is here so a better signal can replace it without the UI changing.
 */
export interface AgentStateSource {
  derive(session: TerminalSession): AgentState
}

/**
 * Derives state from the only three signals core owns: PTY exit, the terminal
 * bell, and byte flow.
 *
 * `awaiting-input` is inferred from the bell, so an agent that waits without
 * ringing it reads as idle. Core cannot use Claude Code hooks — they belong to
 * the speckit-pilot extension and Principle II forbids core consuming an
 * extension's internals — and a shell-launched agent emits none.
 */
export class BellAndBusySource implements AgentStateSource {
  derive(session: TerminalSession): AgentState {
    if (session.status === 'closed') return 'exited'
    // Bell outranks byte flow: a session that rings while still printing is
    // asking for you, which is the costlier signal to miss.
    if ((session.bellCount ?? 0) > 0) return 'awaiting-input'
    if (session.busy) return 'working'
    return 'idle'
  }
}
