import type { ExtensionAPI } from '@terminator/extension-sdk'

import { disposables } from './ipc/register.js'
import type { ActivationContext } from './ipc/register.js'
import { noteUntrackedDataRoot, resolveFoundryDataRoot } from './workspace-root.js'
import { moveFromSharedUserData } from './storage-folder.js'
import { connectIndexes } from './state/live-index.js'
import { startSupervisionRuntime, stopSupervisionRuntime } from './runtime/supervision-runtime.js'
import { startSensorTick, stopSensorTick } from './sensors/sensor-tick.js'
import { startRefineryTick, stopRefineryTick } from './line/refinery-run.js'
import { executingOrders, adoptedRoots } from './line/run-control.js'
import { createDeciding, createStandingSources } from './ipc/standing.js'
import { createForgeLoop } from './forge/forge-loop.js'
import { registerForgeChannels } from './ipc/forge-registration.js'
import { registerLineChannels } from './ipc/line-registration.js'
import { startFoundryHomePublisher } from './home/publish.js'
import type { HomePublisher } from './home/publish.js'
import { registerInboxChannels } from './ipc/inbox-registration.js'
import { registerRecordChannels } from './ipc/record-registration.js'
import { registerSupervisionChannels } from './ipc/supervision-registration.js'
import { registerModelChannels } from './ipc/model-registration.js'
import {
  registerViewChannels,
  registerCommands,
  clearPendingNewOrder,
} from './ipc/ui-registration.js'
import { registerSettings } from './state/settings-schema.js'

/**
 * Foundry's entry point: activation composes the modules that own each part.
 *
 * The data root is resolved on every read and handed down as an absolute
 * path: an order can span repositories, so "the working directory" is
 * ambiguous and two writers resolving it independently could disagree.
 */
export function activate(api: ExtensionAPI): void {
  // Before anything opens the records or the runtime state.
  moveFromSharedUserData(api)
  // Home is told after every change; the publisher exists once the inbox it decides through does.
  let home: HomePublisher | null = null
  connectIndexes(api, () => home?.scheduleFoundryPublish())
  // Activation cannot be async — the host calls it synchronously — so the
  // runtime comes up in the background.
  void startSupervisionRuntime(api)

  const context: ActivationContext = { api, dataRoot: () => resolveFoundryDataRoot(api) }
  // Said once, and only when the default location is in use. Foundry will not
  // add the ignore entry itself — that would be editing a file no order asked
  // to change — so the operator is told what it costs and what avoids it.
  noteUntrackedDataRoot(api, context.dataRoot())

  const signalStore = startSensorTick(context)
  startRefineryTick(context)

  const deciding = createDeciding()
  const standingSources = createStandingSources(context.dataRoot, deciding)
  // The loop agrees and starts a ready order through channels built after it.
  const loop = createForgeLoop(context, { deciding, channels: () => ({ forge, runs }) })
  const forge = registerForgeChannels(context, { standingSources, loop })
  const runs = registerLineChannels(context, standingSources)
  const inbox = registerInboxChannels(context, { standingSources, runs, loop })
  home = startFoundryHomePublisher(context, { standingSources, decide: inbox.decide })
  homePublisher = home
  home.scheduleFoundryPublish()
  registerRecordChannels(context, signalStore)
  registerSupervisionChannels(api)
  registerModelChannels(api)

  registerSettings(api)
  registerViewChannels(api)
  registerCommands(api, forge)
}

// The publisher of the active session, so deactivation can stop its pending publish.
let homePublisher: HomePublisher | null = null

export async function deactivate(): Promise<void> {
  const homeStopped = homePublisher?.dispose()
  homePublisher = null
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
  // Or a reactivated extension never looks again at what the last session left
  // in a records location it has already seen this process.
  adoptedRoots.clear()
  executingOrders.clear()
  stopSensorTick()
  stopRefineryTick()
  clearPendingNewOrder()
  stopSupervisionRuntime()
  // Last, so everything else is already stopped while a read in flight ends.
  await homeStopped
}
