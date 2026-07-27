// Shared supervision types, used by both processes. Runtime validation lives in
// src/shared/schemas/supervision.ts; these are the inferred shapes.

/**
 * The derived condition of a supervised session (data-model.md §3).
 *
 * `unknown` is not in FR-001's enumeration. It exists because FR-009 forbids
 * reporting a session as `working` without evidence: a restart that finds no
 * durable record needs somewhere honest to land.
 */
export const RUNTIME_STATES = [
  'starting',
  'working',
  'needs_input',
  'stalled',
  'ready',
  'failed',
  'merged',
  'unknown',
] as const

export type RuntimeState = (typeof RUNTIME_STATES)[number]

/**
 * The ceiling on what a session may do without prompting, chosen at assign
 * time rather than per interrupt (FR-041). Each level auto-approves a strictly
 * larger set than the one before it.
 */
export const AUTONOMY_LEVELS = ['read', 'edit', 'build', 'ship'] as const

export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number]

export interface DiffSummary {
  readonly files: number
  readonly added: number
  readonly removed: number
}

export interface PendingPermission {
  readonly requestId: string
  readonly toolName: string
  /** What is being requested, in words — FR-007 requires surfaces state it. */
  readonly summary: string
  /** Present when the action targets a network host. Off-allowlist always prompts (FR-042). */
  readonly targetHost?: string
  readonly requestedAt: number
  /** Set when the autonomy ladder resolved this without asking, so the audit trail shows it. */
  readonly autoDecision?: 'allow' | null
}

export interface SupervisedSession {
  readonly id: string
  readonly workItemId: string | null
  readonly laneOrd: number | null
  readonly repoPath: string
  readonly worktreePath: string
  readonly branch: string
  /**
   * From hook input, never computed (research.md R3). Null until the runtime
   * reports one — a session that has not started yet has no transcript, and
   * pretending otherwise drops it from every listing surface.
   */
  readonly transcriptPath: string | null
  readonly runtimeState: RuntimeState
  readonly stateSince: number
  readonly lastToolActivityAt: number | null
  /** Net of reverts. Drives the loop signal (FR-013). */
  readonly lastNetChangeAt: number | null
  /** Set while a shell call is in flight, so its interval is excluded from silence (FR-015). */
  readonly openShellCallId: string | null
  readonly turns: number
  readonly costUsd: number
  /** Null means unknown, which is not the same as zero. */
  readonly contextPct: number | null
  readonly pendingPermission: PendingPermission | null
  readonly diffSummary: DiffSummary
  readonly autonomyLevel: AutonomyLevel
  /** Drives the "since you last looked" panel (FR-027). */
  readonly lastViewedAt: number | null
}
