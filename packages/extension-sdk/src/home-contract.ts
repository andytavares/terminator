/** The measure ids Home reads by name (ADR 117). An extension publishes a measure under one of
 * these ids to have Home place it on a card; any other id is not drawn. */
export const HOME_MEASURES = {
  /** Pull requests (or other units of work) that shipped in the window. */
  shipped: 'shipped',
  /** Share of automated work that needed no human rework. */
  firstPass: 'first-pass',
  /** Minutes a change waited for its first review. */
  reviewWait: 'review-wait',
  /** Days in the window with any contribution, one point per day. */
  contributionsDays: 'contributions-days',
  /** Orders (automated work items) shipped in the window. */
  ordersShipped: 'orders-shipped',
} as const

/** The id of the ask action that hands an ask's problem to an agent. Home shows "Send to agent"
 * on a failing check only when an ask on the same work carries an action with this id. */
export const SEND_TO_AGENT_ACTION = 'send-to-agent'
