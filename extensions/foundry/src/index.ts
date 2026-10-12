import type { ExtensionAPI } from '@terminator/extension-sdk'

import { disposables } from './ipc/register.js'
import type { ActivationContext } from './ipc/register.js'
import { noteUntrackedDataRoot, resolveFoundryDataRoot } from './workspace-root.js'
import { connectIndexes } from './state/live-index.js'
import { runtime } from './runtime/runtime-state.js'
import { startSupervisionRuntime, stopSupervisionRuntime } from './runtime/supervision-runtime.js'
import { startSensorTick, stopSensorTick } from './sensors/sensor-tick.js'
import { startRefineryTick, stopRefineryTick } from './line/refinery-run.js'
import { executingOrders, adoptedRoots } from './line/run-control.js'
import { createDeciding, createStandingSources } from './ipc/standing.js'
import { createForgeLoop } from './forge/forge-loop.js'
import { registerForgeChannels } from './ipc/forge-registration.js'
import { registerLineChannels } from './ipc/line-registration.js'
import { registerInboxChannels } from './ipc/inbox-registration.js'
import { registerRecordChannels } from './ipc/record-registration.js'
import { registerSupervisionChannels } from './ipc/supervision-registration.js'
import { registerModelChannels } from './ipc/model-registration.js'
import {
  trackTerminalSessions,
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
  connectIndexes(api)
  // Kept, so a phase can wait for it. Activation cannot be async — the host
  // calls it synchronously — but a dispatch that arrives in the meantime used
  // to find no supervised runner and fall back to a headless
  // `bypassPermissions` spawn: an invisible agent approving its own tool calls,
  // which is the whole thing this replaced.
  runtime.runtimeStarting = startSupervisionRuntime(api)
  void runtime.runtimeStarting

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
  registerInboxChannels(context, { standingSources, runs, loop })
  registerRecordChannels(context, signalStore)
  registerSupervisionChannels(api)
  registerModelChannels(api)

  trackTerminalSessions(api)
  registerSettings(api)
  registerViewChannels(api)
  registerCommands(api)
}

export function deactivate(): void {
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
}
