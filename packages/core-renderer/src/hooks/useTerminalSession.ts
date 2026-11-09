import { createTerminalSession, splitTerminalSession } from '../terminal/session-controller'

/**
 * Thin React binding over the session controller — the controller owns the
 * create/split composition and all busy/bell/idle wiring. Module functions are
 * referentially stable, so no memoization is needed.
 */
export function useTerminalSession() {
  return { createSession: createTerminalSession, splitSession: splitTerminalSession }
}
