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
  /**
   * The ask in full: a question's options, a command's description. Deciding
   * requires seeing what is being asked, and a one-line summary of an
   * unfamiliar tool is its name, not its request.
   */
  readonly detail?: string | null
  /**
   * The questions being asked and the answers each offers. A question is not a
   * yes/no: approving it tells the agent nothing about which option you meant,
   * and a flat list of labels does not say which question one answers.
   */
  readonly questions?: ReadonlyArray<{ question: string; options: readonly string[] }>
  /** Present when the action targets a network host. Off-allowlist always prompts (FR-042). */
  readonly targetHost?: string
  readonly requestedAt: number
  /** Set when the autonomy ladder resolved this without asking, so the audit trail shows it. */
  readonly autoDecision?: 'allow' | null
}

export interface SessionFailureView {
  readonly step: 'setup' | 'agent'
  readonly exitCode: number | null
  readonly output: string
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
  /**
   * The terminal the agent is running in, so a surface can put the operator in
   * front of it rather than beside it. Null before it has been opened, and
   * once the run has ended.
   */
  readonly terminalSessionId: string | null
  /** The workspace project its working copy was registered as. */
  readonly projectId: string | null
  readonly lastViewedAt: number | null
  /**
   * Why it failed, when it did. FR-034: a setup script that exited non-zero
   * must be readable from a listing surface — "failed" without the output
   * makes you open the session to learn anything, which is the whole thing
   * this console exists to avoid.
   */
  readonly failure: SessionFailureView | null
}
