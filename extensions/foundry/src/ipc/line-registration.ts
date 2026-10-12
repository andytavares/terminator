import { createRunChannels, runChannelSpecs } from './run-channels.js'
import { foundryChannel } from './channel.js'
import { OrderIdPayload } from './payloads.js'
import { createLiveOrderStore } from '../order/store.js'
import { tearDownRun } from '../line/teardown.js'
import { computeQueueEntries } from '../line/refinery-entries.js'
import { projectRemover } from '../line/order-project.js'
import { readTranscript } from '../runtime/transcript-tailer.js'

import type { RunChannels } from './run-channels.js'
import { reg } from './register.js'
import type { ActivationContext } from './register.js'
import { resolveSources } from '../workspace-root.js'
import { announceLive, indexFor, orderStoreAt } from '../state/live-index.js'
import { runtime, strandedAgents, isLiveSession } from '../runtime/runtime-state.js'
import { executingOrders, stopOrder } from '../line/run-control.js'
import { executeRun } from '../line/execute-run.js'
import type { LiveStandingSources } from './standing.js'

/**
 * The Line's channels: the run channels, stopping a whole order, and starting
 * one over.
 */
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

// ── The Line ───────────────────────────────────────────────────────────
//
// An agreed order plus a shape of work becomes a run graph. Everything that
// can refuse does so before any agent starts: the order has to be agreed,
// the shape has to be one this repository can actually support, and the
// records location has to be writable.
function createRuns(
  { api, dataRoot }: ActivationContext,
  standingSources: LiveStandingSources
): RunChannels {
  return createRunChannels({
    store: createLiveOrderStore(dataRoot, indexFor),
    dataRoot,
    index: indexFor,
    sources: () => resolveSources(api, dataRoot()),
    now: () => new Date().toISOString(),
    // Marked while it runs, so nothing reclaims a node out from under an
    // executor that is part way through starting it.
    execute: async (order, recipe, graph) => {
      executingOrders.add(order.id)
      announceLive(order.id)
      try {
        await executeRun(api, { root: dataRoot(), order, recipe, graph })
      } finally {
        executingOrders.delete(order.id)
        announceLive(order.id)
      }
    },
    isLive: isLiveSession,
    executing: (orderId) => executingOrders.has(orderId),
    gatesFor: standingSources.gatesFor,
    asksFor: standingSources.asksFor,
    stallsFor: standingSources.stallsFor,
    strandedFor: standingSources.strandedFor,
    // The sessions themselves, so the band can offer the one thing that
    // answers a handed-back call: going to the terminal it was handed to.
    strandedSessions: (orderId) =>
      [...strandedAgents.values()]
        .filter((a) => a.orderId === orderId && isLiveSession(a.sessionId))
        .map((a) => a.sessionId),
    // What each agent has been doing, for the Factory view's activity
    // markers. Read from the same transcript file the stall detector tails —
    // no session means nothing to report, not an error.
    activityFor: (sessionId) => {
      const run = runtime.supervision?.runs.get(sessionId)
      return run ? readTranscript(run.transcriptPath) : []
    },
    queueEntries: () => computeQueueEntries(dataRoot(), orderStoreAt(dataRoot())),
  })
}

// Stop the whole order, as opposed to one agent.
//
// `foundry:run-stop` ends one session; this ends the run. The distinction is
// the reason a dead run could never be got rid of: the only order-level stop
// was a gate option that did nothing, and `order.cancel` refuses a running
// order and points back at that gate.
function registerRunStop({ api, dataRoot }: ActivationContext): void {
  reg(
    api,
    foundryChannel('foundry:run.stop', OrderIdPayload, async ({ id }) => {
      await stopOrder(dataRoot(), id, 'stopped by the operator')
      return { ok: true }
    })
  )
}

// Start the same order over.
//
// Stop whatever is still running, destroy everything the run made — every
// lane's checkout and branch, the graph, the gates, the rung outputs — and
// put the order back to `agreed` so it can be run again from node zero. The
// ask, the criteria and the plan survive, which is the whole difference
// between this and making a fourth order for the same sentence.
function registerRunReset(context: ActivationContext): void {
  reg(
    context.api,
    foundryChannel('foundry:run.reset', OrderIdPayload, ({ id }) => resetRun(context, id))
  )
}

async function resetRun({ api, dataRoot }: ActivationContext, id: string) {
  const root = dataRoot()
  const store = orderStoreAt(root)
  const order = await store.load(id)
  if (order === null) return { error: `No order ${id}.` }

  await stopOrder(root, id, 'starting over')
  const result = await tearDownRun(order, {
    exec: (o) => api.shell.exec(o),
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
