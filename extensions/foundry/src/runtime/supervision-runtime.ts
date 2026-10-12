import type { ExtensionAPI } from '@terminator/extension-sdk'
import * as path from 'node:path'

import { orderDir } from '../data-root.js'
import { createControlServer } from './control-server.js'
import { createSupervisedRunner, type SupervisedRunner } from './supervised-runner.js'
import { createStallWatcher, type StallWatcher } from './stall-watcher.js'
import { createSupervision, type Supervision } from './supervision.js'
import { createMuteStore } from './feed/mutes.js'
import { recordTools } from '../factory/timeline-store.js'
import type { StallFiring } from './evaluate-stall.js'

import { announceLive, orderStoreAt } from '../state/live-index.js'
import { stallShadowMode } from '../state/settings.js'
import {
  runtime,
  runtimeStateDir,
  raisedNotifications,
  stallFirings,
  MAX_STALL_FIRINGS,
} from './runtime-state.js'
import { notify } from './held-calls.js'
import { gotoRun, startPaletteRefresh, stopPaletteRefresh } from './palette-commands.js'

/**
 * A stall, written where the order's history is read.
 *
 * The feature directory *is* the order directory, so its basename is the order
 * id — and `orderDir` refuses anything that is not one, so a firing for a run
 * that is not an order's writes nothing rather than inventing a place for it.
 */
export async function recordStall(
  featureDir: string,
  firing: { sessionId: string; signal: string; firedAt: number }
): Promise<void> {
  const orderId = path.basename(featureDir)
  const root = path.dirname(path.dirname(featureDir))
  try {
    orderDir(root, orderId)
  } catch {
    return
  }
  try {
    await orderStoreAt(root).record({
      at: new Date(firing.firedAt).toISOString(),
      orderId,
      actor: 'rule:line',
      action: 'run.stalled',
      subject: firing.sessionId,
      reason: `An agent stopped making progress (${firing.signal}). Its terminal is still there and its work is still in the worktree; nothing was thrown away.`,
      evidence: [],
    })
  } catch {
    // A stall that cannot be recorded is still a stall. The console has it.
  }
}

/**
 * Brings up the control server, the runner, the supervision layer and the stall
 * detector, and returns the layer so a caller can read what is running.
 *
 * Returns null when the runtime could not start: phases then fall back to the
 * unsupervised spawn, and every surface reads empty rather than throwing.
 */
export async function startSupervisionRuntime(api: ExtensionAPI): Promise<Supervision | null> {
  try {
    runtime.control = await createControlServer()
    runtime.supervisedRunner = createSupervisedRunner({
      api,
      control: runtime.control,
      stateDir: runtimeStateDir(api.paths.userData),
    })
    // A run that stops making progress without asking for anything is the
    // failure nobody instruments: it looks exactly like one that is working.
    runtime.supervision = createSupervision({
      api,
      stateDir: runtimeStateDir(api.paths.userData),
      onFeedChange: () => announceLive(''),
    })
    runtime.mutes = createMuteStore(path.join(runtimeStateDir(api.paths.userData), 'mutes.json'))

    runtime.stallWatcher = watchForStalls(api, runtime.supervisedRunner)
    runtime.stallWatcher.start()

    startPaletteRefresh(api)
    return runtime.supervision
  } catch (error) {
    // Without it, phases fall back to the headless spawn. Said out loud: the
    // difference is whether tool calls are asked about or approved silently.
    api.log.error('supervised runtime unavailable — phases will run unsupervised', error)
    // Close what was opened. A failure after the control server bound left it
    // listening on a port nothing would ever answer on, and nothing would ever
    // close it either.
    void runtime.control?.close()
    runtime.control = null
    runtime.supervisedRunner?.dispose()
    runtime.supervisedRunner = null
    runtime.stallWatcher?.stop()
    runtime.stallWatcher = null
    runtime.supervision = null
    api.notifications.showToast(
      'error',
      'Supervision could not start — phases will run unsupervised, approving their own tool calls',
      'foundry.runtime.unavailable'
    )
    return null
  }
}

function watchForStalls(api: ExtensionAPI, runner: SupervisedRunner): StallWatcher {
  // How much each run's working copy has grown since the previous look. The
  // watcher reads transcripts and nothing else, so without this the loop
  // signal could never tell circling from steady work — and never fired.
  const lastSeenChange = new Map<string, number>()
  return createStallWatcher({
    runs: () => runner.watchable(),
    // Each tool call, recorded once, beside the order's run graph — what the
    // Factory view plays back after the fact.
    onActivity: (run, activity) => {
      void recordTools(run.featureDir, run.sessionId, activity).catch(() => {})
    },
    netChangeSince: (sessionId) => {
      const diff = runtime.supervision?.runs.get(sessionId)?.diff
      if (diff === undefined) return 1
      const total = diff.added + diff.removed
      const growth = total - (lastSeenChange.get(sessionId) ?? 0)
      lastSeenChange.set(sessionId, total)
      return growth
    },
    onFiring: (firing, featureDir) => onStallFiring(api, firing, featureDir),
  })
}

function onStallFiring(api: ExtensionAPI, firing: StallFiring, featureDir: string): void {
  const shadow = stallShadowMode(api)
  stallFirings.unshift({ firing, featureDir, shadow })
  if (stallFirings.length > MAX_STALL_FIRINGS) stallFirings.length = MAX_STALL_FIRINGS
  runtime.supervision?.runs.setState(firing.sessionId, 'stalled', firing.firedAt)

  // On the order's own record as well as the console's.
  //
  // The detector is timely and nothing consumes it. Measured on a live
  // run: the builder fell silent at 07:27:08, this fired at 07:34:21,
  // and the run went on waiting until the wall-clock budget stopped it
  // at 07:52:10 — eighteen minutes after the console already knew. The
  // executor is not told, and shadow mode is on by default, so those
  // eighteen minutes left no trace anywhere an operator reads afterwards:
  // the ledger said "budget exceeded", which is true and explains nothing.
  //
  // This does not stop the run — doing that needs a gate rule, which is a
  // decision about FR-049 rather than a fix. It makes the silence
  // legible, which is the part that was simply missing.
  void recordStall(featureDir, firing)

  // Attributed to the pilot, not the agent: the agent did not say this,
  // and a feed that blurs the two is one you stop trusting.
  const entry = runtime.supervision?.feed.post({
    at: firing.firedAt,
    sessionId: firing.sessionId,
    author: 'console',
    summary: `stopped making progress (${firing.signal}) in ${path.basename(featureDir)}`,
  })
  api.window.broadcast('foundry:stall-fired', { firing, featureDir, shadow })
  announceLive('')
  if (shadow) return
  // Muted runs are recorded and shown, never surfaced — which is the only
  // alternative to turning the detector off wholesale when one run is
  // noisy.
  if (
    entry !== undefined &&
    runtime.supervision !== null &&
    !runtime.supervision.feed.shouldNotify(entry, runtime.mutes?.list() ?? [])
  ) {
    return
  }
  // An indication, not an interruption: a stall is not blocked on an
  // answer the way a held tool call is.
  notify(
    api,
    { kind: 'stalled', sessionId: firing.sessionId },
    `A run stopped making progress (${firing.signal})`,
    undefined,
    // A stall is the notification you most want to act on, and acting on
    // it means reading what the agent was doing when it went quiet.
    () => gotoRun(api, 'run', firing.sessionId)
  )
}

/** Everything `startSupervisionRuntime` brought up, taken down again. */
export function stopSupervisionRuntime(): void {
  runtime.supervision = null
  runtime.mutes = null
  for (const notification of raisedNotifications.values()) notification.dispose()
  raisedNotifications.clear()
  runtime.stallWatcher?.stop()
  runtime.stallWatcher = null
  stopPaletteRefresh()
  runtime.supervisedRunner?.dispose()
  runtime.supervisedRunner = null
  void runtime.control?.close()
  runtime.control = null
}
