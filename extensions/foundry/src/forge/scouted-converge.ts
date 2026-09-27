import type { ConvergeStarted } from '../ipc/forge-channels.js'
import type { WorkOrder } from '../order/schema.js'

/**
 * Before the very first draft, the scout reads the repository so the
 * architect starts from code it has already seen rather than a guess.
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
   * Start the scout, read-only, ahead of the first draft.
   *
   * `onStarted` fires the moment the scout's session exists, before its turn
   * ends — that is what lets `convergeMaybeScouted` answer `converge` as soon
   * as *something* is running, rather than waiting out the scout's whole read
   * of the repository. `onFinished` fires exactly once, when the scout's turn
   * is over: the order it collected, or null if it was refused before it
   * ever started, or wrote nothing.
   */
  readonly startScout: (
    order: WorkOrder,
    onStarted: (sessionId: string) => void,
    onFinished: (updated: WorkOrder | null) => void
  ) => void
  /** One architect turn (and the follow-ups it starts on its own). */
  readonly startArchitect: (order: WorkOrder, message: string) => Promise<ConvergeStarted>
  /**
   * The architect's later start still has to land in the ledger the way
   * `lastIntake` reads it, or every surface keeps saying the scout is what is
   * running long after it has handed off. Nothing else records this: the
   * usual recorder is `runArchitectTurn`, and by the time this architect turn
   * starts, `runArchitectTurn` has already returned — answered by the scout.
   */
  readonly recordArchitectStarted: (
    order: WorkOrder,
    message: string,
    started: ConvergeStarted
  ) => Promise<void>
}

/**
 * `converge`, scouted ahead of a first draft.
 *
 * `converge`'s contract (see `forge-channels.ts`) is to answer once a turn
 * has *started*, not once it has finished — the redraft lands later, through
 * the store. Wrapping the whole scout-then-architect chain in one promise
 * broke that: on a first draft the channel waited out the scout's entire
 * turn before answering at all, so on a host with no `claude` binary the
 * scout never finished and the channel never answered (PR #210, ac0b65e0).
 *
 * This answers with the scout's own session as soon as it exists, and starts
 * the architect off the scout's `onFinished` without anyone awaiting it. A
 * scout refused before it ever started has no session to answer with, so the
 * architect's own result is this call's only answer.
 */
export function convergeMaybeScouted(
  deps: ScoutedConvergeDeps,
  order: WorkOrder,
  message: string
): Promise<ConvergeStarted> {
  if (!isFirstDraft(order)) return deps.startArchitect(order, message)

  return new Promise<ConvergeStarted>((resolve) => {
    let answered = false
    const answer = (started: ConvergeStarted): void => {
      if (answered) return
      answered = true
      resolve(started)
    }

    deps.startScout(
      order,
      (sessionId) => answer({ ok: true, sessionId }),
      (updated) => {
        void (async () => {
          const scouted = updated ?? order
          const started = await deps.startArchitect(scouted, message)
          await deps.recordArchitectStarted(scouted, message, started)
          answer(started)
        })()
      }
    )
  })
}
