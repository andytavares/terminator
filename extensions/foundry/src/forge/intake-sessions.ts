/**
 * The architect's open conversation, per order.
 *
 * In memory: a session does not survive a restart, and resuming one the
 * runtime has forgotten is refused rather than silently starting a fresh agent
 * that believes it is continuing.
 */
export const intakeSessions = new Map<string, string>()

/**
 * Orders deleted while a Forge session was still running for them.
 *
 * Deleting the project ends the session's terminal, and a session ending is
 * what moves the Forge on: the scout's end starts the architect, the
 * architect's end saves its redraft. Arriving after the delete, each of those
 * cut the checkout again, opened a new project, or wrote the order back.
 */
export const deletedOrders = new Set<string>()
