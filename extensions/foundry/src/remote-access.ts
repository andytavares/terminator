/**
 * The channels the remote browser client's Foundry view may call (ADR 094:
 * extension channels are local-only unless declared). Each only reads what
 * Foundry already holds in memory. Left out on purpose: anything that writes,
 * starts or steers a run, repairs records as it reads (`attention`,
 * `inbox.list`), or returns a file's content (`run-transcript`).
 */
export const REMOTE_READ_CHANNELS: ReadonlySet<string> = new Set([
  'foundry:ask-model',
  'foundry:factory.metrics',
  'foundry:feed-list',
  'foundry:models-list',
  'foundry:order.list',
  'foundry:order.states',
  'foundry:permissions-list',
  'foundry:rules.inForce',
  'foundry:run.activity',
  'foundry:run.recipes',
  'foundry:run.timeline',
  'foundry:sensors.list',
  'foundry:signals.list',
  'foundry:stalls-list',
  'foundry:ui.view',
])
