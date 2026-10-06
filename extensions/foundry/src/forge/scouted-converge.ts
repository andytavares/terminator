import type { ConvergeStarted } from '../ipc/forge-channels.js'
import type { WorkOrder } from '../order/schema.js'

/**
 * Before the very first draft, the scout reads the repository — beside the
 * architect, not ahead of it.
 *
 * Only for a first draft: `provenance.decisions` is empty until a proposal
 * has been applied, and `context.entryPoints` is empty until something has
 * populated it — an amending turn has both, and gets no scout of its own.
 */
function isFirstDraft(order: WorkOrder): boolean {
  return order.provenance.decisions.length === 0 && order.context.entryPoints.length === 0
}

export interface ScoutedConvergeDeps {
  /**
   * Start the scout, read-only. It records what it found on the order when its
   * turn ends; nothing here waits for that.
   */
  readonly startScout: (order: WorkOrder) => void
  /** One architect turn (and the follow-ups it starts on its own). */
  readonly startArchitect: (order: WorkOrder, message: string) => Promise<ConvergeStarted>
}

/**
 * `converge`, with the scout running beside a first draft (ADR 084).
 *
 * The architect used to start off the scout's `onFinished`, which put the
 * scout's 80 seconds in front of every first draft. It starts now, at once,
 * from the order as it stands; the scout's findings land on the order when it
 * finishes, for the red team and the Line, and are never merged into the
 * first draft. The answer is the architect's own start, which is also what
 * `runArchitectTurn` records as `converge.started`.
 */
export function convergeMaybeScouted(
  deps: ScoutedConvergeDeps,
  order: WorkOrder,
  message: string
): Promise<ConvergeStarted> {
  if (isFirstDraft(order)) {
    try {
      deps.startScout(order)
    } catch {
      // A scout that cannot start must not cost the draft its architect.
    }
  }
  return deps.startArchitect(order, message)
}

/**
 * The architect's saved draft, keeping what the scout collected.
 *
 * Two turns write the same order and the later save wins: a draft built from
 * the order as it stood when the architect started would erase findings the
 * scout stored in the meantime. What the architect wrote stays; the scout's
 * entries are added only where the draft lacks them.
 */
export function withScoutContext(drafted: WorkOrder, stored: WorkOrder | null): WorkOrder {
  if (stored === null) return drafted
  const union = (a: readonly string[], b: readonly string[]): string[] => [
    ...a,
    ...b.filter((item) => !a.includes(item)),
  ]
  const { entryPoints, priorArt, conventions } = drafted.context
  const next = {
    entryPoints: union(entryPoints, stored.context.entryPoints),
    priorArt: union(priorArt, stored.context.priorArt),
    conventions: union(conventions, stored.context.conventions),
  }
  const unchanged =
    next.entryPoints.length === entryPoints.length &&
    next.priorArt.length === priorArt.length &&
    next.conventions.length === conventions.length
  return unchanged ? drafted : { ...drafted, context: { ...drafted.context, ...next } }
}
