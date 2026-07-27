// Every action the console directs at a producer goes through a command the
// producer registered on the published Extension API (FR-077). The console
// never reaches into a producer by any other means.
//
// When a producer has not registered the command an action needs, the item is
// rendered read-only with a stated reason rather than failing (FR-078). A
// button that silently does nothing is worse than one that explains itself.

export type ProducerAction = 'approveGate' | 'rejectGate' | 'advancePhase' | 'sendBack'

export interface ProducerHandlers {
  approveGate?(workItemId: string, gate: string): Promise<void>
  rejectGate?(workItemId: string, gate: string, notes: string): Promise<void>
  advancePhase?(workItemId: string): Promise<void>
  sendBack?(workItemId: string, phase: string, notes: string): Promise<void>
}

export interface ActionResult {
  readonly ok: boolean
  readonly reason: string | null
}

export interface ProducerRegistry {
  register(producerId: string, handlers: ProducerHandlers): void
  unregister(producerId: string): void
  supports(producerId: string, action: ProducerAction): boolean
  invoke(
    producerId: string,
    action: ProducerAction,
    args: readonly unknown[]
  ): Promise<ActionResult>
}

const ACTION_LABELS: Record<ProducerAction, string> = {
  approveGate: 'approving a gate',
  rejectGate: 'rejecting a gate',
  advancePhase: 'advancing the phase',
  sendBack: 'sending work back',
}

export function createProducerRegistry(): ProducerRegistry {
  const producers = new Map<string, ProducerHandlers>()

  return {
    register(producerId: string, handlers: ProducerHandlers): void {
      producers.set(producerId, handlers)
    },

    unregister(producerId: string): void {
      producers.delete(producerId)
    },

    supports(producerId: string, action: ProducerAction): boolean {
      return typeof producers.get(producerId)?.[action] === 'function'
    },

    async invoke(
      producerId: string,
      action: ProducerAction,
      args: readonly unknown[]
    ): Promise<ActionResult> {
      const handlers = producers.get(producerId)
      if (handlers === undefined) {
        return { ok: false, reason: `no producer named ${producerId} is registered` }
      }

      const handler = handlers[action]
      if (typeof handler !== 'function') {
        // Read-only rather than broken: the item still renders, the action is
        // simply unavailable and says so.
        return {
          ok: false,
          reason: `${producerId} does not provide ${ACTION_LABELS[action]}`,
        }
      }

      try {
        await (handler as (...a: unknown[]) => Promise<void>)(...args)
        return { ok: true, reason: null }
      } catch (error) {
        // A producer throwing is the producer's failure, reported as such —
        // never allowed to take a console surface down with it.
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
