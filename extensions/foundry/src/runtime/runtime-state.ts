import type { Disposable } from '@terminator/extension-sdk'
import * as path from 'node:path'

import { type ControlServer } from './control-server.js'
import { type SupervisedRunner } from './supervised-runner.js'
import { createPendingPermissions } from './pending-permissions.js'
import { type StallWatcher } from './stall-watcher.js'
import { type Supervision } from './supervision.js'
import { type MuteStore } from './feed/mutes.js'
import type { StallFiring } from './evaluate-stall.js'
import { endAndWait } from './end-session.js'

// The supervision runtime's parts for the life of the extension: one record, not
// module `let`s, so every reader sees what `startSupervisionRuntime` set.
export const runtime: {
  // The loopback endpoint the agents' hooks answer on, and the runner that owns
  // their terminals. Started once for the extension rather than per run: a port
  // per agent would be a port per card.
  control: ControlServer | null
  supervisedRunner: SupervisedRunner | null
  stallWatcher: StallWatcher | null
  // What is running, what it changed, what needs looking at, and what must not
  // start yet.
  supervision: Supervision | null
  // Which runs may interrupt you. Muting stops the notification, never the entry: the
  // feed stays complete.
  mutes: MuteStore | null
} = {
  control: null,
  supervisedRunner: null,
  stallWatcher: null,
  supervision: null,
  mutes: null,
}

// What is waiting on the operator, across every card. Without somewhere to
// hold these the surface has nothing to render and a phase sits at its hook.
export const pendingPermissions = createPendingPermissions()

// Where the supervision runtime keeps its files: absolute, in Foundry's
// `globalStorage`, outside every repository. A relative path once made every
// supervised run die on "Settings file not found" (SUPERVISION.md, "Incidents behind the code").
export function runtimeStateDir(globalStorage: string): string {
  return path.join(globalStorage, 'runtime')
}
// The notification each held call raised, so answering it removes the notification:
// leftovers teach you to dismiss without reading.
export const raisedNotifications = new Map<string, Disposable>()

// Stalls that fired, newest first, and whether they were judged right. In memory: they
// tune thresholds over a week of use, and a dead run's firing is not worth reloading.
export const stallFirings: Array<{ firing: StallFiring; featureDir: string; shadow: boolean }> = []

// Agents whose tool call went back to the terminal's prompt, which an unattended run
// never reaches: alive, still `running`, and drawn as working unless recorded here.
// Keyed by session: an agent is stranded once, however many calls it lost.
export const strandedAgents = new Map<string, { orderId: string; sessionId: string; at: number }>()

// How many firings to keep: enough to judge a week by hand (what shadow mode is for),
// bounded because the application stays open for days.
export const MAX_STALL_FIRINGS = 200

// Whether this process runs that agent's session: the runner's register, emptied on
// session end and empty in a fresh application, so a graph still saying `running`
// for a previous process's agents is recognised as describing nothing.
export function isLiveSession(sessionId: string): boolean {
  return runtime.supervisedRunner?.terminalFor(sessionId) != null
}

/** Stop a session this process runs and wait until it is gone: one process per conversation. */
export async function endLiveSession(sessionId: string, reason: string): Promise<void> {
  await endAndWait({ stop: stopSupervisedSession, isLive: isLiveSession }, { sessionId, reason })
}

function stopSupervisedSession(sessionId: string, reason: string): boolean {
  return runtime.supervisedRunner?.stop(sessionId, reason) ?? false
}
