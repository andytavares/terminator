import type { OrderIntake, WorkOrder } from '../order/schema.js'
import { orderStoreAt } from '../state/live-index.js'

/** How long a turn may run before the Forge stops waiting for its answer. */
const INTAKE_TURN_MS = 10 * 60_000

type IntakeState = OrderIntake['state']

/** The intake a turn in `state` leaves on the order; only a running state has a deadline. */
export function intakeAt(state: IntakeState, now: Date, reason?: string): OrderIntake {
  const running = state === 'drafting' || state === 'reviewing' || state === 'fixing'
  return {
    state,
    since: now.toISOString(),
    deadline: running ? new Date(now.getTime() + INTAKE_TURN_MS).toISOString() : null,
    ...(reason === undefined ? {} : { reason }),
  }
}

/** Write what the intake is doing through the order store, so the index and the surfaces hear. */
export async function setIntake(
  root: string,
  orderId: string,
  change: { state: IntakeState; reason?: string }
): Promise<void> {
  const intake = intakeAt(change.state, new Date(), change.reason)
  await orderStoreAt(root).update(orderId, (latest: WorkOrder) => ({ ...latest, intake }))
}
