import { isSessionEvent, type SessionEvent } from './session-event.js'

// In-process fan-out for session events. Every consumer of supervision state —
// the state machine, the stall detector, the review queue, the IPC bridge —
// subscribes here rather than talking to the agent-runtime seam directly.

export type SessionEventHandler = (event: SessionEvent) => void

export type Unsubscribe = () => void

export interface EventBusOptions {
  /** Where subscriber failures go. Without a sink they are swallowed, which hides real bugs. */
  onError?: (error: unknown, event: SessionEvent) => void
  /**
   * A published value that is not a session event at all. Events arrive from
   * hooks and a transcript whose shapes are not published contracts, so this
   * is reachable in production, not only from a typed caller.
   */
  onInvalid?: (value: unknown) => void
}

export interface EventBus {
  subscribe(handler: SessionEventHandler): Unsubscribe
  publish(event: SessionEvent): void
}

export function createEventBus(options: EventBusOptions = {}): EventBus {
  const handlers = new Set<SessionEventHandler>()

  return {
    subscribe(handler: SessionEventHandler): Unsubscribe {
      handlers.add(handler)
      // Idempotent: unsubscribing twice is a no-op, not an error.
      return () => {
        handlers.delete(handler)
      }
    },

    publish(event: SessionEvent): void {
      // Typed callers cannot get here wrong, but the runtime shapes feeding
      // this bus are not published contracts. A malformed event reaching the
      // state machine would corrupt state silently; dropping it does not.
      if (!isSessionEvent(event)) {
        options.onInvalid?.(event)
        return
      }

      // Snapshot first. A handler that subscribes during delivery must not
      // receive the event that triggered it, and one that unsubscribes must
      // not corrupt the iteration.
      for (const handler of [...handlers]) {
        if (!handlers.has(handler)) continue
        try {
          handler(event)
        } catch (error) {
          // One subscriber failing must not stop the rest. A surface that
          // throws while rendering cannot be allowed to starve the state
          // machine of the remaining stream.
          options.onError?.(error, event)
        }
      }
    },
  }
}
