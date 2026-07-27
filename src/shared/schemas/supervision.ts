import { z } from 'zod'
import { RUNTIME_STATES, AUTONOMY_LEVELS } from '../types/supervision.js'

// Runtime validation for everything that crosses IPC. Malformed payloads are
// rejected here rather than reaching a surface.

export { RUNTIME_STATES, AUTONOMY_LEVELS }
export type {
  RuntimeState,
  AutonomyLevel,
  DiffSummary,
  PendingPermission,
  SupervisedSession,
} from '../types/supervision.js'

export const runtimeStateSchema = z.enum(RUNTIME_STATES)

export const autonomyLevelSchema = z.enum(AUTONOMY_LEVELS)

export const diffSummarySchema = z.object({
  files: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
})

export const pendingPermissionSchema = z.object({
  requestId: z.string().min(1),
  toolName: z.string().min(1),
  // FR-007 requires the surface name what is being requested, so an empty
  // summary is a malformed request rather than a permissible one.
  summary: z.string().min(1),
  detail: z.string().nullable().optional(),
  questions: z.array(z.object({ question: z.string(), options: z.array(z.string()) })).optional(),
  targetHost: z.string().min(1).optional(),
  requestedAt: z.number(),
  autoDecision: z.literal('allow').nullish(),
})

const epochMs = z.number().int().nonnegative()

export const supervisedSessionSchema = z.object({
  id: z.string().min(1),
  workItemId: z.string().min(1).nullable(),
  laneOrd: z.number().int().positive().nullable(),
  repoPath: z.string().min(1),
  worktreePath: z.string().min(1),
  branch: z.string().min(1),
  transcriptPath: z.string().min(1).nullable(),
  runtimeState: runtimeStateSchema,
  stateSince: epochMs,
  lastToolActivityAt: epochMs.nullable(),
  lastNetChangeAt: epochMs.nullable(),
  openShellCallId: z.string().min(1).nullable(),
  turns: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  // Null is "unknown", which is not the same as zero.
  contextPct: z.number().min(0).max(100).nullable(),
  pendingPermission: pendingPermissionSchema.nullable(),
  diffSummary: diffSummarySchema,
  autonomyLevel: autonomyLevelSchema,
  runtimeSessionId: z.string().nullable(),
  lastViewedAt: epochMs.nullable(),
  failure: z
    .object({
      step: z.enum(['setup', 'agent']),
      exitCode: z.number().int().nullable(),
      output: z.string(),
    })
    .nullable(),
})

export const supervisedSessionListSchema = z.array(supervisedSessionSchema)

export const statusSummarySchema = z.object({
  needsInput: z.number().int().nonnegative(),
  working: z.number().int().nonnegative(),
  awaitingReview: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Age in ms of the oldest blocked session, or null when nothing is blocked (FR-025). */
  oldestBlockedMs: z.number().int().nonnegative().nullable(),
})

export type StatusSummary = z.infer<typeof statusSummarySchema>
