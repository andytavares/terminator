import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import type { SessionEvent } from '../events/session-event.js'
import { resultToSessionEvent } from './to-session-event.js'
import { buildSupervisionHooks } from './hooks.js'
import {
  createPermissionBridge,
  type PermissionBridge,
  type PermissionDecision,
} from './permission-bridge.js'

// The one module that starts an agent, and the only importer of the runtime
// SDK anywhere under src/ — enforced by an ESLint rule and by
// tests/unit/config/eslint-boundaries.spec.ts.
//
// `query` is injectable so the driver can be exercised without spawning a real
// agent, and so a signature change in the runtime breaks here rather than in
// the state machine, the detector, or a surface (SC-007).

export interface StartSessionOptions {
  sessionId: string
  /** Lane tasks and artefact paths are composed upstream (FR-039). */
  prompt: string
  /** The provisioned working copy. */
  cwd: string
  /** Resolves a request without prompting when the autonomy ladder allows it. */
  autoDecide?: (toolName: string, input: unknown) => PermissionDecision | null
}

export interface SessionDriverOptions {
  query?: typeof sdkQuery
  publish: (event: SessionEvent) => void
  now: () => number
}

export interface SessionDriver {
  /** Resolves once the session is *launched*, not when it finishes. */
  start(options: StartSessionOptions): Promise<void>
  /** Resolves when the run ends. For orderly shutdown and for tests. */
  completion(sessionId: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  resolvePermission(sessionId: string, requestId: string, decision: PermissionDecision): void
}

interface RunningSession {
  bridge: PermissionBridge
  interrupt: () => Promise<void>
  completed: Promise<void>
}

function isResultMessage(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'result'
  )
}

export function createSessionDriver(options: SessionDriverOptions): SessionDriver {
  const { publish, now } = options
  const query = options.query ?? sdkQuery
  const running = new Map<string, RunningSession>()

  return {
    async start(start: StartSessionOptions): Promise<void> {
      const { sessionId, prompt, cwd, autoDecide } = start
      const bridge = createPermissionBridge({ sessionId, publish, now, autoDecide })

      const run = query({
        prompt,
        options: {
          cwd,
          // The only documented source of "blocked on the operator" — the
          // Notification hook does not fire for permission prompts (FR-010).
          canUseTool: (toolName: string, input: unknown) => bridge.canUseTool(toolName, input),
          hooks: buildSupervisionHooks({ publish, now }),
        },
      } as never) as AsyncIterable<unknown> & { interrupt?: () => Promise<void> }

      // Consuming the run is what takes minutes or hours. Starting must not
      // wait for it, or the session could never be interrupted or answered
      // while it was in flight — which is the entire point of the console.
      const completed = (async () => {
        try {
          for await (const message of run) {
            if (!isResultMessage(message)) continue
            for (const event of resultToSessionEvent(message as never, now())) publish(event)
          }
        } catch (error) {
          // A run that dies without reporting would leave the session `working`
          // forever — exactly the silent failure this feature exists to catch.
          publish({
            kind: 'session_ended',
            sessionId,
            outcome: 'error',
            reason: error instanceof Error ? error.message : String(error),
            at: now(),
          })
        } finally {
          // Any prompt still outstanding can no longer be answered; leaving its
          // promise pending would hang the runtime's turn.
          bridge.rejectAll('Session ended')
          running.delete(sessionId)
        }
      })()

      running.set(sessionId, {
        bridge,
        completed,
        interrupt: async () => {
          await run.interrupt?.()
        },
      })
    },

    async completion(sessionId: string): Promise<void> {
      await running.get(sessionId)?.completed
    },

    async interrupt(sessionId: string): Promise<void> {
      await running.get(sessionId)?.interrupt()
    },

    resolvePermission(sessionId: string, requestId: string, decision: PermissionDecision): void {
      running.get(sessionId)?.bridge.resolve(requestId, decision)
    },
  }
}
