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
import type { ToolActivity } from './transcript-tailer.js'

import { announceLive, orderStoreAt } from '../state/live-index.js'
import { stallShadowMode } from '../state/settings.js'
import {
  runtime,
  runtimeStateDir,
  raisedNotifications,
  stallFirings,
  MAX_STALL_FIRINGS,
} from './runtime-state.js'
import { notifyPerson } from './held-calls.js'
import { gotoRun, startPaletteRefresh, stopPaletteRefresh } from './palette-commands.js'
import { inBackground } from '../background.js'

// A stall, written to the order's ledger. The feature directory is
// `<root>/orders/<id>`; a firing for any other writes nothing rather than invent a place.
/** @internal */
export async function recordStall(
  featureDir: string,
  firing: { sessionId: string; signal: string; firedAt: number }
): Promise<void> {
  const orderId = path.basename(featureDir)
  const root = path.dirname(path.dirname(featureDir))
  try {
    if (orderDir(root, orderId) !== path.resolve(featureDir)) return
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

// Recordings of tool calls begun by a stall-watcher tick and not yet written, so stopping
// the runtime can wait for them.
const recordingsInFlight = new Set<Promise<void>>()

function recordToolsInFlight(
  featureDir: string,
  sessionId: string,
  activity: readonly ToolActivity[]
): void {
  const recording = recordTools(featureDir, sessionId, activity)
    .catch(() => {})
    .finally(() => recordingsInFlight.delete(recording))
  recordingsInFlight.add(recording)
}

// Brings up the control server, runner, supervision layer and stall detector, and
// returns the layer; null when it cannot start, so phases run unsupervised and
// surfaces read empty rather than throw.
export async function startSupervisionRuntime(api: ExtensionAPI): Promise<Supervision | null> {
  try {
    runtime.control = await createControlServer()
    runtime.supervisedRunner = createSupervisedRunner({
      api,
      control: runtime.control,
      stateDir: runtimeStateDir(api.paths.globalStorage),
    })
    // A run that stops making progress without asking for anything is the
    // failure nobody instruments: it looks exactly like one that is working.
    runtime.supervision = createSupervision({
      api,
      stateDir: runtimeStateDir(api.paths.globalStorage),
      onFeedChange: () => announceLive(''),
    })
    runtime.mutes = createMuteStore(
      path.join(runtimeStateDir(api.paths.globalStorage), 'mutes.json')
    )

    runtime.stallWatcher = watchForStalls(api, runtime.supervisedRunner)
    runtime.stallWatcher.start()

    startPaletteRefresh(api)
    return runtime.supervision
  } catch (error) {
    await runtimeUnavailable(api, error)
    return null
  }
}

// Without the runtime, phases fall back to the headless spawn. Said out loud: it
// decides whether tool calls are asked about or approved silently.
async function runtimeUnavailable(api: ExtensionAPI, error: unknown): Promise<void> {
  api.log.error('supervised runtime unavailable — phases will run unsupervised', error)
  await closeHalfStartedRuntime()
  api.notifications.showToast(
    'error',
    'Supervision could not start — phases will run unsupervised, approving their own tool calls',
    'foundry.runtime.unavailable'
  )
}

// Close what was opened. A failure after the control server bound left it
// listening on a port nothing would ever answer on, and nothing would ever
// close it either.
async function closeHalfStartedRuntime(): Promise<void> {
  const controlClosed = runtime.control?.close()
  runtime.control = null
  runtime.supervisedRunner?.dispose()
  runtime.supervisedRunner = null
  runtime.stallWatcher?.stop()
  runtime.stallWatcher = null
  runtime.supervision = null
  await controlClosed
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
      recordToolsInFlight(run.featureDir, run.sessionId, activity)
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

  // On the order's record as well as the console's, so the silence is legible
  // afterwards. It does not stop the run, which would need a gate rule (FR-049).
  // Why: SUPERVISION.md, "Incidents behind the code".
  inBackground(recordStall(featureDir, firing))

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
  notifyPerson(api, {
    event: { kind: 'stalled', sessionId: firing.sessionId },
    message: `A run stopped making progress (${firing.signal})`,
    // A stall is the notification you most want to act on, and acting on
    // it means reading what the agent was doing when it went quiet.
    onClick: () => gotoRun(api, 'run', firing.sessionId),
  })
}

/** Everything `startSupervisionRuntime` brought up, taken down again; settles once the control
 * server has closed and the recordings in flight are written. */
export async function stopSupervisionRuntime(): Promise<void> {
  runtime.supervision = null
  runtime.mutes = null
  for (const notification of raisedNotifications.values()) notification.dispose()
  raisedNotifications.clear()
  runtime.stallWatcher?.stop()
  runtime.stallWatcher = null
  stopPaletteRefresh()
  runtime.supervisedRunner?.dispose()
  runtime.supervisedRunner = null
  const controlClosed = runtime.control?.close()
  runtime.control = null
  await Promise.all([controlClosed, ...recordingsInFlight])
}
