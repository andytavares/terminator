import type { SessionEvent } from '../events/session-event.js'
import { createPermissionBridge, type PermissionDecision } from './permission-bridge.js'
import { buildLaunchSpec, type LaunchSpec } from './claude-launch.js'
import type { ControlServer } from './control-server.js'
import type {
  OpenedTerminal,
  SessionDriver,
  StartSessionOptions,
  TerminalPlacement,
} from './driver-contract.js'
import { countTurns } from './transcript-tailer.js'

// Starting an agent by typing into a terminal.
//
// The console used to drive the agent itself, in this process, with no
// terminal anywhere. Everything it knew came back through an SDK callback, and
// everything it could not see — what the agent actually printed, what it was
// part-way through, what you would have said to it if you could — was simply
// unavailable. You could watch a session for thirty minutes and have nothing
// to look at.
//
// So the agent runs where you can see it: `claude` in a real terminal, in the
// session's own working copy, in a project in your workspace. This driver
// never speaks to the agent's process directly. It writes to that terminal,
// exactly as a person would, and everything the agent has to say comes back
// through its hooks and its transcript. The operator can type in the same
// terminal at any time without the console losing track — which is the point.

export interface PtyDriverOptions {
  publish: (event: SessionEvent) => void
  now: () => number
  control: ControlServer
  /** Where the per-session settings files go. */
  settingsDirectory: string
  hookScriptPath: string
  /**
   * Opens a terminal in the working copy, registering it as a project in the
   * operator's workspace, and says where it ended up. Supplied by the
   * application shell, because terminals belong to projects and projects
   * belong to workspaces — this module has no business creating either. Null
   * when no terminal could be opened at all.
   */
  openTerminal: (spec: LaunchSpec, placement?: TerminalPlacement) => Promise<OpenedTerminal | null>
  /** Types into a terminal. A newline is the caller's to include. */
  write: (terminalSessionId: string, data: string) => void
  /** Ends a terminal and whatever is running in it. */
  closeTerminal: (terminalSessionId: string) => void
  /**
   * Reads what the working copy has changed, so it is known before the session
   * is recorded as over.
   *
   * Ordering is the whole point: reaching `ready` requires a non-empty diff,
   * and a diff measured after the fact arrives too late to affect it. Without
   * this, a session that changed plenty was still recorded as having finished
   * without changing anything.
   */
  measureDiff?: (sessionId: string) => Promise<void>
}

interface RunningSession {
  bridge: ReturnType<typeof createPermissionBridge>
  terminalSessionId: string | null
  release: () => void
  completed: Promise<void>
  finish: () => void
}

/**
 * Escape, which is what the operator would press.
 *
 * Claude Code stops the turn on it and keeps the session open, so a redirect
 * typed afterwards actually reaches the agent. That distinction is the whole
 * difference between interrupting and stopping, and it is the thing the SDK
 * driver got wrong for months: its interrupt closed the input stream, so every
 * interrupt-and-redirect delivered nothing at all.
 */
const INTERRUPT = '\x1b'

/** Ends the conversation the way a person would, so the runtime writes its record. */
const EXIT = '/exit\r'

export function createPtyDriver(options: PtyDriverOptions): SessionDriver {
  const { publish, now, control } = options
  const running = new Map<string, RunningSession>()

  return {
    async start(start: StartSessionOptions): Promise<void> {
      const { sessionId, prompt, cwd, autoDecide, placement } = start

      // The same bridge the SDK driver used. It was never SDK-shaped: it turns
      // a tool call into console state and a decision back into an answer, and
      // only the last translation differs here.
      const bridge = createPermissionBridge({ sessionId, publish, now, autoDecide })

      let finish = (): void => {}
      const completed = new Promise<void>((resolve) => {
        finish = resolve
      })

      const spec = buildLaunchSpec({
        sessionId,
        cwd,
        prompt,
        settingsDirectory: options.settingsDirectory,
        hookScriptPath: options.hookScriptPath,
        controlUrl: control.url,
        controlEventUrl: control.eventUrl,
        controlToken: control.token,
      })
      const { transcriptPath } = spec

      const release = control.register(sessionId, {
        decide: async (request) => {
          const result = await bridge.canUseTool(request.toolName, request.input)
          return result
        },
        onEvent: (kind) => {
          // The diff is read before either report, because both of them are
          // decisions the state machine makes by looking at it — and after the
          // fact is too late to affect the outcome.
          void (async () => {
            try {
              await options.measureDiff?.(sessionId)
            } catch {
              // A working copy that has already gone, or a git that failed.
              // Reported as no change, which is what it was already.
            }

            if (kind === 'stop') {
              // The agent stopped responding and is waiting. Not an ending:
              // running in a terminal it sits at its prompt rather than
              // exiting, and anything typed at it carries on the same session.
              //
              // Cost and context window are left unreported rather than
              // guessed. They came from the runtime's own result message, which
              // a terminal does not produce and the transcript does not carry.
              publish({
                kind: 'turn_finished',
                sessionId,
                turns: countTurns(transcriptPath),
                costUsd: 0,
                contextPct: null,
                at: now(),
              })
              return
            }

            publish({ kind: 'session_ended', sessionId, outcome: 'success', at: now() })
            endRun(sessionId)
          })()
        },
      })

      const opened = await options.openTerminal(spec, placement)
      const terminalSessionId = opened?.terminalSessionId ?? null

      running.set(sessionId, { bridge, terminalSessionId, release, completed, finish })

      if (terminalSessionId === null) {
        // No terminal, no agent. Said out loud rather than left to the stall
        // detector to notice in eight minutes' time.
        publish({
          kind: 'session_ended',
          sessionId,
          outcome: 'error',
          reason: 'no terminal could be opened for this session',
          at: now(),
        })
        endRun(sessionId)
        return
      }

      publish({ kind: 'session_started', sessionId, transcriptPath, cwd, at: now() })
      options.write(terminalSessionId, `${spec.command}\r`)
    },

    async completion(sessionId: string): Promise<void> {
      await running.get(sessionId)?.completed
    },

    async send(sessionId: string, message: string): Promise<void> {
      const session = running.get(sessionId)
      if (session?.terminalSessionId == null) {
        // Reported, never swallowed: a reply that goes nowhere must say so.
        throw new Error('this session is no longer running')
      }
      // Typed, exactly as the operator would. Claude Code queues input arriving
      // mid-turn, so a redirect does not need the agent to be idle first.
      options.write(session.terminalSessionId, `${message}\r`)
    },

    async interrupt(sessionId: string): Promise<void> {
      const session = running.get(sessionId)
      if (session?.terminalSessionId == null) return
      options.write(session.terminalSessionId, INTERRUPT)
    },

    async stop(sessionId: string, reason?: string): Promise<boolean> {
      const session = running.get(sessionId)
      if (session?.terminalSessionId == null) return false
      const terminal = session.terminalSessionId

      // Stop the turn first, or the reason queues behind whatever it is
      // part-way through and the session outlives the instruction to end.
      options.write(terminal, INTERRUPT)
      if (reason !== undefined && reason.trim() !== '') {
        // Into the agent's own record, not only ours: coming back to a
        // half-finished diff tomorrow, this is what says why it stopped.
        options.write(terminal, `${reason.trim()}\r`)
      }
      options.write(terminal, EXIT)
      return true
    },

    resolvePermission(sessionId: string, requestId: string, decision: PermissionDecision): void {
      running.get(sessionId)?.bridge.resolve(requestId, decision)
    },

    /**
     * Ends the session and takes its terminal with it. Discarding a session
     * removes the working copy underneath it, and a terminal sitting in a
     * directory that no longer exists is worse than no terminal.
     */
    dispose(sessionId: string): void {
      const terminal = running.get(sessionId)?.terminalSessionId
      if (terminal != null) options.closeTerminal(terminal)
      endRun(sessionId)
    },

    terminalFor(sessionId: string): string | null {
      return running.get(sessionId)?.terminalSessionId ?? null
    },
  }

  function endRun(sessionId: string): void {
    const session = running.get(sessionId)
    if (session === undefined) return
    running.delete(sessionId)
    // Anything still waiting can no longer be answered from here; leaving a
    // promise pending would hold the agent's tool call open forever.
    session.bridge.rejectAll('Session ended')
    session.release()
    session.finish()
  }
}
