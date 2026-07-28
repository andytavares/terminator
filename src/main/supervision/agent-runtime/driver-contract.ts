import type { PermissionDecision } from './permission-bridge.js'

// What the rest of the console is allowed to know about however an agent is
// being run.
//
// Kept separate from any implementation of it so the composition root, the
// assigner and the service depend on the shape rather than on the runtime. It
// is the seam that made replacing the whole agent runtime — from an in-process
// SDK to a process in a terminal — a change to two files rather than to the
// state machine, the stall detector and every surface (SC-007, ADR-027).

export interface StartSessionOptions {
  sessionId: string
  /** Lane tasks and artefact paths are composed upstream (FR-039). */
  prompt: string
  /** The provisioned working copy. */
  cwd: string
  /** Resolves a request without prompting when the autonomy ladder allows it. */
  autoDecide?: (toolName: string, input: unknown) => PermissionDecision | null
  /** Where the operator wants the session's terminal to appear. */
  placement?: TerminalPlacement
}

/**
 * Enough for the shell to put the session somewhere the operator will find it.
 *
 * The workspace is passed rather than inferred: the console has no ambient
 * notion of which one is in front of you, and guessing would put an agent's
 * terminal in a workspace you were not looking at.
 */
export interface OpenedTerminal {
  readonly terminalSessionId: string
  /** The workspace project the working copy was registered as, if any. */
  readonly projectId: string | null
}

export interface TerminalPlacement {
  workspaceId: string | null
  branch: string
  repoPath: string
}

export interface SessionDriver {
  /** Resolves once the session is *launched*, not when it finishes. */
  start(options: StartSessionOptions): Promise<void>
  /** Resolves when the run ends. For orderly shutdown and for tests. */
  completion(sessionId: string): Promise<void>
  /**
   * Ends the current turn, leaving the session open. A redirect sent after
   * this reaches the agent — which is the whole point of interrupting rather
   * than stopping.
   */
  interrupt(sessionId: string): Promise<void>
  /**
   * Ends the run. An optional reason is delivered first, best effort, so the
   * agent's own record says why it stopped rather than simply ending.
   *
   * Returns false when there was no live run to stop — after a restart, or
   * once the run has already ended. The caller has to end the session itself
   * in that case, or a session with no agent behind it stays `working` forever
   * and the Stop button does nothing.
   */
  stop(sessionId: string, reason?: string): Promise<boolean>
  /** Sends a further message to a running session — a reply, or a redirect. */
  send(sessionId: string, message: string): Promise<void>
  resolvePermission(sessionId: string, requestId: string, decision: PermissionDecision): void
  /** Ends the session and closes the terminal it was running in. */
  dispose(sessionId: string): void
  /**
   * The terminal this session is running in, so a surface can put the operator
   * in front of the agent rather than beside it. Null once the run has ended.
   */
  terminalFor(sessionId: string): string | null
}
