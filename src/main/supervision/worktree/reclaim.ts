import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { SupervisedSession } from '../../../shared/types/supervision.js'

// Working copies outlive the sessions that made them.
//
// A crash between `git worktree add` and the session being registered leaves a
// directory nothing knows about. A session that ended still holds its checkout
// until someone reclaims it. Neither is visible from anywhere, and both consume
// a port span and a few hundred megabytes of node_modules each, so they
// accumulate silently — which is exactly the class of failure this console
// exists to make visible rather than to add to.

export type ReclaimReason = 'orphan' | 'finished'

export interface ReclaimableWorktree {
  readonly path: string
  /**
   * `orphan` — nothing in the registry references it, so no session can be
   * harmed by removing it. `finished` — its session reached a terminal state
   * and has nothing left to do with it.
   */
  readonly reason: ReclaimReason
  /** Null for an orphan: there is no session to name. */
  readonly sessionId: string | null
  readonly branch: string | null
  readonly repoPath: string | null
}

/** States after which a session has no further use for its working copy. */
const FINISHED: ReadonlySet<string> = new Set(['merged', 'failed'])

function directoriesIn(root: string): string[] {
  try {
    return readdirSync(root)
      .map((entry) => join(root, entry))
      .filter((path) => {
        try {
          return statSync(path).isDirectory()
        } catch {
          // Removed between the listing and the stat: not ours to report.
          return false
        }
      })
  } catch {
    // No worktree root yet, which is the normal state of a fresh install.
    return []
  }
}

/**
 * What can be removed, and why. Never reports a working copy belonging to a
 * session that is still doing something: `starting`, `working`, `needs_input`,
 * `stalled` and `ready` all still need theirs — `ready` most of all, since its
 * diff has not been reviewed yet.
 */
export function findReclaimable(
  worktreeRoot: string,
  sessions: readonly SupervisedSession[]
): ReclaimableWorktree[] {
  const byPath = new Map(sessions.map((session) => [session.worktreePath, session]))

  const reclaimable: ReclaimableWorktree[] = []
  for (const path of directoriesIn(worktreeRoot)) {
    const session = byPath.get(path)

    if (session === undefined) {
      reclaimable.push({ path, reason: 'orphan', sessionId: null, branch: null, repoPath: null })
      continue
    }

    if (FINISHED.has(session.runtimeState)) {
      reclaimable.push({
        path,
        reason: 'finished',
        sessionId: session.id,
        branch: session.branch,
        repoPath: session.repoPath,
      })
    }
  }

  return reclaimable.sort((a, b) => a.path.localeCompare(b.path))
}
