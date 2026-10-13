/**
 * The architect's open conversation, per order.
 *
 * In memory: a session does not survive a restart, and resuming one the
 * runtime has forgotten is refused rather than silently starting a fresh agent
 * that believes it is continuing.
 */
export const intakeSessions = new Map<string, string>()

// Orders deleted while a Forge session ran for them. A session's end moves the Forge
// on (scout starts architect, architect saves its redraft); arriving after the delete,
// that would recreate the checkout, project or order.
export const deletedOrders = new Set<string>()
