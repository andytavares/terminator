import type { PendingPermission, RuntimeState, SupervisedSession } from '../types/supervision.js'
import type { StatusSummary } from '../schemas/supervision.js'

// Lives in shared/ because both processes need it: the main process ranks for
// notifications and the renderer ranks for the Attention Queue. It is pure and
// depends only on shared types, so it bundles into either side cleanly.
//
// One query, three renderings. The Attention Queue, the Standup Feed and the
// palette all answer "what needs me, ranked" — so it is built once, here, as a
// pure function. If a surface finds it needs its own variant of this, that is a
// signal the substrate is wrong rather than a reason to fork the ranking.

export type AttentionReason = Extract<
  RuntimeState,
  'needs_input' | 'stalled' | 'failed' | 'ready' | 'unknown'
>

export interface AttentionItem {
  readonly sessionId: string
  readonly repoPath: string
  /** So two sessions in one repository are tellable apart. */
  readonly branch: string
  readonly reason: AttentionReason
  readonly waitingMs: number
  readonly pendingPermission: PendingPermission | null
  /**
   * Why it failed, carried onto the queue itself. "Failed" with the reason
   * hidden behind a click is exactly the trip this console exists to save
   * (FR-034).
   */
  readonly failure: { step: 'setup' | 'agent'; exitCode: number | null; output: string } | null
}

// Ordered by how much the operator is needed, not by project and not by
// arrival. A blocking request stops an agent dead; a stall is an agent burning
// time silently; a failure is already over; finished work can wait a little.
const PRIORITY: Record<AttentionReason, number> = {
  needs_input: 0,
  stalled: 1,
  failed: 2,
  unknown: 3,
  ready: 4,
}

function reasonOf(session: SupervisedSession): AttentionReason | null {
  const state = session.runtimeState
  return state in PRIORITY ? (state as AttentionReason) : null
}

export function rankAttention(
  sessions: readonly SupervisedSession[],
  now: number
): AttentionItem[] {
  return sessions
    .flatMap((session) => {
      const reason = reasonOf(session)
      if (reason === null) return []
      return [
        {
          sessionId: session.id,
          repoPath: session.repoPath,
          branch: session.branch,
          reason,
          waitingMs: Math.max(0, now - session.stateSince),
          pendingPermission: session.pendingPermission,
          failure: session.failure,
        },
      ]
    })
    .sort(
      (a, b) =>
        PRIORITY[a.reason] - PRIORITY[b.reason] ||
        // Within a band, the one waiting longest needs you most.
        b.waitingMs - a.waitingMs
    )
}

/** Running means "the console is doing something for you right now". */
const RUNNING: ReadonlySet<RuntimeState> = new Set<RuntimeState>(['starting', 'working'])

/** Blocked means "waiting on the operator" — including a stall, which simply never asked. */
const BLOCKED: ReadonlySet<RuntimeState> = new Set<RuntimeState>(['needs_input', 'stalled'])

export function summariseStatus(
  sessions: readonly SupervisedSession[],
  now: number
): StatusSummary {
  const blockedAges = sessions
    .filter((s) => BLOCKED.has(s.runtimeState))
    .map((s) => Math.max(0, now - s.stateSince))

  return {
    needsInput: sessions.filter((s) => s.runtimeState === 'needs_input').length,
    // `starting` counts as working: the operator's question is whether
    // anything is running, and a session whose worktree is being provisioned
    // is running. Counting only `working` reported "all clear" the moment
    // after you pressed Start.
    working: sessions.filter((s) => RUNNING.has(s.runtimeState)).length,
    awaitingReview: sessions.filter((s) => s.runtimeState === 'ready').length,
    failed: sessions.filter((s) => s.runtimeState === 'failed').length,
    // Null, not zero: nothing blocked is a different statement from "blocked
    // for no time", and the status bar must not imply the latter.
    oldestBlockedMs: blockedAges.length === 0 ? null : Math.max(...blockedAges),
  }
}
