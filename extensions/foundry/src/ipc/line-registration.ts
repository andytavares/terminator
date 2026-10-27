import { createRunChannels, runChannelSpecs } from './run-channels.js'
import { foundryChannel } from './channel.js'
import { OrderIdPayload } from './payloads.js'
import { createLiveOrderStore } from '../order/store.js'
import { tearDownRun } from '../line/teardown.js'
import { projectRemover } from '../line/order-project.js'
import { readTranscript } from '../runtime/transcript-tailer.js'

import type { RunChannels } from './run-channels.js'
import { reg } from './register.js'
import type { ActivationContext } from './register.js'
import { sourcesOf } from '../workspace-root.js'
import { announceLive, indexFor, orderStoreAt, queueEntriesOf } from '../state/live-index.js'
import { runtime, strandedAgents, isLiveSession } from '../runtime/runtime-state.js'
import { executingOrders, stopOrder } from '../line/run-control.js'
import { inBackground } from '../background.js'
import { executeOrderRun } from '../line/execute-run.js'
import type { OrderRun } from '../line/run-context.js'
import type { LiveStandingSources } from './standing.js'
import { isoNow, shellExecOf } from '../host-calls.js'

/** The Line's channels: the run channels, stopping a whole order, starting one over. */
export function registerLineChannels(
  context: ActivationContext,
  standingSources: LiveStandingSources
): RunChannels {
  const runs = createRuns(context, standingSources)
  reg(context.api, ...runChannelSpecs(runs))
  registerRunStop(context)
  registerRunReset(context)
  return runs
}

// The Line: an agreed order plus a shape becomes a run graph. Everything that can
// refuse does so before any agent starts: the order agreed, the shape supported here,
// the records location writable.
function createRuns(context: ActivationContext, standingSources: LiveStandingSources): RunChannels {
  const { dataRoot } = context
  return createRunChannels({
    store: createLiveOrderStore(dataRoot, indexFor),
    dataRoot,
    index: indexFor,
    sources: sourcesOf(context),
    now: isoNow,
    execute: (order, recipe, graph) => executeMarked(context, { order, recipe, graph }),
    isLive: isLiveSession,
    executing: (orderId) => executingOrders.has(orderId),
    gatesFor: standingSources.gatesFor,
    asksFor: standingSources.asksFor,
    stallsFor: standingSources.stallsFor,
    strandedFor: standingSources.strandedFor,
    strandedSessions: liveStrandedSessions,
    activityFor: transcriptActivity,
    queueEntries: queueEntriesOf(dataRoot),
  })
}

// Marked while it runs, so nothing reclaims a node out from under an
// executor that is part way through starting it.
async function executeMarked(
  { api, dataRoot }: ActivationContext,
  run: Omit<OrderRun, 'root'>
): Promise<void> {
  const { order } = run
  executingOrders.add(order.id)
  announceLive(order.id)
  const running = executeOrderRun(api, { root: dataRoot(), ...run })
  inBackground(running)
  try {
    await running
  } finally {
    executingOrders.delete(order.id)
    announceLive(order.id)
  }
}

// The sessions themselves, so the band can offer the one thing that
// answers a handed-back call: going to the terminal it was handed to.
function liveStrandedSessions(orderId: string): string[] {
  return [...strandedAgents.values()]
    .filter((a) => a.orderId === orderId && isLiveSession(a.sessionId))
    .map((a) => a.sessionId)
}

// What each agent has been doing, for the Factory view's activity
// markers. Read from the same transcript file the stall detector tails —
// no session means nothing to report, not an error.
function transcriptActivity(sessionId: string): ReturnType<typeof readTranscript> {
  const run = runtime.supervision?.runs.get(sessionId)
  return run ? readTranscript(run.transcriptPath) : []
}

// Stop the whole order, where `foundry:run-stop` ends one session: without it a
// dead run could not be got rid of, since `order.cancel` refuses a running order.
function registerRunStop({ api, dataRoot }: ActivationContext): void {
  reg(
    api,
    foundryChannel('foundry:run.stop', OrderIdPayload, ({ id }) => stopRun(dataRoot(), id))
  )
}

export async function stopRun(root: string, id: string) {
  await stopOrder(root, id, 'stopped by the operator')
  return { ok: true }
}

// Start the same order over: stop what runs, destroy every lane checkout and branch,
// the graph, gates and rung outputs, and put the order back to `agreed`. The ask,
// criteria and plan survive.
function registerRunReset(context: ActivationContext): void {
  reg(
    context.api,
    foundryChannel('foundry:run.reset', OrderIdPayload, ({ id }) => resetRun(context, id))
  )
}

export async function resetRun({ api, dataRoot }: ActivationContext, id: string) {
  const root = dataRoot()
  const store = orderStoreAt(root)
  const order = await store.load(id)
  if (order === null) return { error: `No order ${id}.` }

  await stopOrder(root, id, 'starting over')
  const result = await tearDownRun(order, {
    exec: shellExecOf(api),
    root,
    removeProjectAt: projectRemover(api.workspace),
  })
  indexFor(root).runReset(id)

  // Read back rather than reused: `stopOrder` saves, and writing the order
  // we loaded before it would put `running` back.
  const stopped = (await store.load(id)) ?? order
  // Only an agreed order can be started, and only a draft can be agreed —
  // so a reset that left it `cancelled` would be the dead end it exists to
  // undo. It was agreed once and nothing about the agreement changed.
  await store.save({ ...stopped, status: 'agreed', recipe: null, recipeOverriddenBy: null })
  await store.record({
    at: new Date().toISOString(),
    orderId: id,
    actor: 'operator',
    action: 'run.reset',
    subject: id,
    reason:
      result.removed.length === 0
        ? 'started over; there was nothing left to remove'
        : `started over; removed ${result.removed.join(', ')}`,
    evidence: [],
  })
  return { ok: true, removed: result.removed, failed: result.failed }
}
