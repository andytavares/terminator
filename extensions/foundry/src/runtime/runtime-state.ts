import type { Disposable } from '@terminator/extension-sdk'
import { app } from 'electron'
import * as path from 'node:path'

import { type ControlServer } from './control-server.js'
import { type SupervisedRunner } from './supervised-runner.js'
import { createPendingPermissions } from './pending-permissions.js'
import { type StallWatcher } from './stall-watcher.js'
import { type Supervision } from './supervision.js'
import { type MuteStore } from './feed/mutes.js'
import type { StallFiring } from './evaluate-stall.js'

/**
 * The supervision runtime's parts, held for the life of the extension.
 *
 * One record rather than module-level `let`s, so every module that reads them
 * sees the value `startSupervisionRuntime` set and `deactivate` cleared.
 */
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
  /**
   * Which runs are allowed to interrupt you.
   *
   * Muting suppresses the notification, never the entry: the feed's record stays
   * complete whether or not it interrupted anyone.
   */
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

/**
 * Where the supervision runtime keeps its files.
 *
 * Absolute, and outside every repository. It used to be
 * `resolveWorktreeBaseDir('')`, which is `join('', '.worktrees')` — a
 * *relative* path — so the `--settings` handed to claude read
 * `.worktrees/.foundry-runtime/settings/<id>.json`, which the runtime
 * resolved against the worktree it was started in. It was never there, so every
 * supervised run died on "Settings file not found" the moment it launched: the
 * card sat at WORKING with 0 turns and the console stayed empty forever.
 *
 * Beside the extension's credentials, in userData: this is the pilot's own
 * state, not repository content, and nothing here should ever land in a diff.
 */
export function runtimeStateDir(): string {
  return path.join(app.getPath('userData'), 'foundry-runtime')
}
/**
 * The notification a held tool call raised, so answering it takes the
 * notification away too. A console that leaves them behind teaches you to
 * dismiss without reading.
 */
export const raisedNotifications = new Map<string, Disposable>()

/**
 * Stalls that have fired, newest first, and whether they were judged right.
 *
 * Kept in memory rather than persisted: the point of the record is tuning the
 * thresholds against a week of real use, and a firing about a run that no longer
 * exists is not something to reload on the next start.
 */
export const stallFirings: Array<{ firing: StallFiring; featureDir: string; shadow: boolean }> = []

/**
 * Agents whose tool call was handed back to the terminal's own prompt.
 *
 * The bridge does that when nobody answers in time, and an unattended run
 * never reaches the prompt — so the agent stops there with its process alive
 * and its node still `running`, which every surface drew as a working build.
 * Keyed by session: one agent is stranded once, however many calls it lost.
 */
export const strandedAgents = new Map<string, { orderId: string; sessionId: string; at: number }>()

/**
 * How many firings to keep.
 *
 * Enough to judge a week of them by hand, which is what shadow mode is for, and
 * bounded because this is an application that stays open for days and an
 * unbounded list is a leak with a UI on it.
 */
export const MAX_STALL_FIRINGS = 200

/**
 * Whether this process is still running that agent's session.
 *
 * The runner's own register, which is emptied by `end` on a `SessionEnd`, a
 * closed tab or a dead process — and which is simply empty in a fresh
 * application. That is the whole point: every session a previous process
 * started is gone, and a graph that still says `running` is describing agents
 * that no longer exist.
 */
export function isLiveSession(sessionId: string): boolean {
  return runtime.supervisedRunner?.terminalFor(sessionId) != null
}
