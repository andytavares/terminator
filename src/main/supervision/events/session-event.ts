// The runtime-neutral session event shape.
//
// This is the only type that crosses the agent-runtime seam. Nothing here may
// reference the agent SDK, a transcript line shape, or any other runtime
// detail — that is what lets a runtime upgrade land inside
// src/main/supervision/agent-runtime/ instead of rippling through the state
// machine, the stall detector, the review queue, and every surface (FR-002 to
// FR-004, SC-007). An ESLint rule enforces the import side of that; this file
// deliberately imports nothing at all.

export const SESSION_EVENT_KINDS = [
  'session_started',
  'tool_started',
  'tool_finished',
  'permission_requested',
  'permission_resolved',
  'turn_finished',
  'session_ended',
  'setup_finished',
  'branch_merged',
] as const

interface BaseEvent {
  readonly sessionId: string
  /** Epoch ms, supplied by the caller. Consumers are pure functions of (events, now). */
  readonly at: number
}

export interface SessionStartedEvent extends BaseEvent {
  readonly kind: 'session_started'
  /** Taken from hook input, never computed. See research.md R3. */
  readonly transcriptPath: string
  readonly cwd: string
}

export interface ToolStartedEvent extends BaseEvent {
  readonly kind: 'tool_started'
  readonly toolName: string
  /** Pairs with tool_finished so an in-flight shell call can be excluded from silence (FR-015). */
  readonly callId: string
  readonly isShell: boolean
  readonly targetPath?: string
}

export interface ToolFinishedEvent extends BaseEvent {
  readonly kind: 'tool_finished'
  readonly callId: string
  readonly ok: boolean
}

export interface PermissionRequestedEvent extends BaseEvent {
  readonly kind: 'permission_requested'
  readonly requestId: string
  readonly toolName: string
  /** What is being asked for, in words. FR-007 requires the surface state it. */
  readonly summary: string
  /** The ask in full — a question's options, a command's description. */
  readonly detail?: string | null
  readonly targetHost?: string
}

export interface PermissionResolvedEvent extends BaseEvent {
  readonly kind: 'permission_resolved'
  readonly requestId: string
  readonly decision: 'allow' | 'deny'
}

export interface TurnFinishedEvent extends BaseEvent {
  readonly kind: 'turn_finished'
  readonly turns: number
  readonly costUsd: number
  readonly contextPct: number | null
}

export interface SessionEndedEvent extends BaseEvent {
  readonly kind: 'session_ended'
  readonly outcome: 'success' | 'error'
  readonly reason?: string
}

export interface SetupFinishedEvent extends BaseEvent {
  readonly kind: 'setup_finished'
  readonly exitCode: number
  readonly output: string
}

/**
 * The branch reached the trunk — by the operator merging it, or by an
 * unattended merge. Without this nothing could ever put a session in `merged`,
 * so lane ordering and downstream staleness had nothing to key off.
 */
export interface BranchMergedEvent extends BaseEvent {
  readonly kind: 'branch_merged'
  /** True when the console merged it without a person looking (FR-060). */
  readonly unattended: boolean
}

export type SessionEvent =
  | SessionStartedEvent
  | ToolStartedEvent
  | ToolFinishedEvent
  | PermissionRequestedEvent
  | PermissionResolvedEvent
  | TurnFinishedEvent
  | SessionEndedEvent
  | SetupFinishedEvent
  | BranchMergedEvent

const KIND_SET: ReadonlySet<string> = new Set(SESSION_EVENT_KINDS)

/**
 * Structural guard for the fields every event shares. Per-kind payloads are
 * validated by the Zod schemas that cross IPC; this guard exists so the seam
 * can drop anything malformed before it reaches the bus.
 */
export function isSessionEvent(value: unknown): value is SessionEvent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.kind === 'string' &&
    KIND_SET.has(candidate.kind) &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.at === 'number' &&
    Number.isFinite(candidate.at)
  )
}
