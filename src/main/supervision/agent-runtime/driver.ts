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
  /**
   * Ends the current turn, leaving the session open. A redirect sent after
   * this reaches the agent — which is the whole point of interrupting rather
   * than stopping.
   */
  interrupt(sessionId: string): Promise<void>
  /**
   * Ends the run. An optional reason is delivered first, best effort, so the
   * agent's own record says why it stopped rather than simply ending.
   */
  stop(sessionId: string, reason?: string): Promise<void>
  /** Sends a further message to a running session — a reply, or a redirect. */
  send(sessionId: string, message: string): Promise<void>
  resolvePermission(sessionId: string, requestId: string, decision: PermissionDecision): void
}

interface RunningSession {
  bridge: PermissionBridge
  interrupt: () => Promise<void>
  stop: (reason?: string) => Promise<void>
  send: (message: string) => void
  completed: Promise<void>
}

/**
 * The prompt, as a stream the console can push onto.
 *
 * Both of the things the operator needs on a stalled session require this: the
 * runtime documents `interrupt()` as available in streaming input mode only,
 * and a follow-up message has nowhere to go when the prompt is a plain string.
 * With a string prompt both silently do nothing.
 */
function createPromptStream(first: string): {
  stream: AsyncIterable<unknown>
  push: (text: string) => void
  close: () => void
} {
  const pending: string[] = [first]
  let wake: (() => void) | null = null
  let closed = false

  const message = (text: string): unknown => ({
    type: 'user' as const,
    session_id: '',
    parent_tool_use_id: null,
    message: { role: 'user' as const, content: [{ type: 'text' as const, text }] },
  })

  return {
    stream: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          while (pending.length > 0) yield message(pending.shift() as string)
          if (closed) return
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
      },
    },
    push(text: string): void {
      if (closed) return
      pending.push(text)
      wake?.()
      wake = null
    },
    close(): void {
      closed = true
      wake?.()
      wake = null
    },
  }
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

      const prompts = createPromptStream(prompt)

      const run = query({
        // Streaming input, not a string: see createPromptStream.
        prompt: prompts.stream,
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
        let reported = false
        try {
          for await (const message of run) {
            if (!isResultMessage(message)) continue
            reported = true
            for (const event of resultToSessionEvent(message as never, now())) publish(event)
          }

          // A run can end without a result — interrupting it produces exactly
          // that. Saying nothing would leave the session `working` forever,
          // which is the silent failure this console exists to catch.
          if (!reported) {
            publish({ kind: 'session_ended', sessionId, outcome: 'success', at: now() })
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
          prompts.close()
          running.delete(sessionId)
        }
      })()

      running.set(sessionId, {
        bridge,
        completed,
        interrupt: async () => {
          // The turn only. Closing the stream here would end the session, and
          // then a redirect sent afterwards would go nowhere — which is what
          // interrupting is for.
          await run.interrupt?.()
        },
        stop: async (reason?: string) => {
          // The reason goes in before the stream closes, so it lands in the
          // agent's own durable record rather than only in ours.
          if (reason !== undefined && reason.trim() !== '') prompts.push(reason.trim())
          await run.interrupt?.()
          // Closing the stream is what actually ends the run.
          prompts.close()
        },
        send: (message: string) => prompts.push(message),
      })
    },

    async completion(sessionId: string): Promise<void> {
      await running.get(sessionId)?.completed
    },

    async send(sessionId: string, message: string): Promise<void> {
      const session = running.get(sessionId)
      if (session === undefined) {
        // Reported, never swallowed: a reply that goes nowhere must say so.
        throw new Error('this session is no longer running')
      }
      session.send(message)
    },

    async stop(sessionId: string, reason?: string): Promise<void> {
      await running.get(sessionId)?.stop(reason)
    },

    async interrupt(sessionId: string): Promise<void> {
      await running.get(sessionId)?.interrupt()
    },

    resolvePermission(sessionId: string, requestId: string, decision: PermissionDecision): void {
      running.get(sessionId)?.bridge.resolve(requestId, decision)
    },
  }
}
