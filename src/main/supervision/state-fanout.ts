// Two audiences want supervision state changes: the renderer, over IPC, and any
// extension that subscribed through the published API. The composition root owns
// the fan-out so neither audience knows about the other, and so one bad
// subscriber cannot starve the other of state.

/** The shape an extension subscriber receives. */
export interface ExtensionStateEvent {
  sessionId: string
  from: string
  to: string
  at: number
}

export type ExtensionStateHandler = (event: ExtensionStateEvent) => void

export interface StateFanout {
  /** Called by the service on every observed transition. */
  publish(change: { sessionId: string; to: string; at: number }): void
  subscribe(handler: ExtensionStateHandler): () => void
  readonly subscriberCount: number
}

export function createStateFanout(options: {
  toRenderer(change: { sessionId: string; to: string; at: number }): void
  onSubscriberError(error: unknown): void
}): StateFanout {
  const subscribers = new Set<ExtensionStateHandler>()

  return {
    publish(change) {
      // The renderer first and outside the loop: SC-001 budgets two seconds for
      // a blocked session to become visible, and an extension must not be able
      // to delay that.
      options.toRenderer(change)

      for (const handler of subscribers) {
        try {
          handler({ sessionId: change.sessionId, from: '', to: change.to, at: change.at })
        } catch (error) {
          // A subscriber blowing up must not stop the rest being told.
          options.onSubscriberError(error)
        }
      }
    },

    subscribe(handler) {
      subscribers.add(handler)
      return () => subscribers.delete(handler)
    },

    get subscriberCount() {
      return subscribers.size
    },
  }
}
