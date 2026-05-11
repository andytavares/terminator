import { z } from 'zod'

const PhaseIdSchema = z.enum([
  'constitution',
  'specify',
  'clarify',
  'plan',
  'checklist',
  'tasks',
  'analyze',
  'implement',
])

const PhaseStatusSchema = z.enum([
  'locked',
  'ready',
  'running',
  'awaiting_review',
  'approved',
  'stale',
  'modified',
  'failed',
])

const PhaseGateConfigSchema = z.object({
  required: z.boolean(),
  autoApprove: z.boolean(),
  perFileConfirm: z.boolean(),
})

const PilotSettingsSchema = z.object({
  defaultModel: z.string(),
  phaseGates: z.record(PhaseIdSchema, PhaseGateConfigSchema),
  disallowedPaths: z.array(z.string()),
  maxFilesPerImplementRun: z.number().int().positive(),
  maxTokensPerCommand: z.number().int().positive(),
  commandTimeoutMs: z.number().int().positive(),
  requireCleanTreeForImplement: z.boolean(),
  createCheckpointBeforeImplement: z.boolean(),
  runConsolePosition: z.enum(['bottom', 'side', 'tab']),
  reviewerIdentity: z.enum(['git', 'os', 'custom']),
  customReviewerName: z.string().nullable(),
  branchConvention: z.enum(['sequential', 'feature-slash', 'custom']),
  customBranchPattern: z.string().nullable(),
  openSidebarOnStart: z.boolean(),
})

const PhaseStateSchema = z.object({
  id: PhaseIdSchema,
  status: PhaseStatusSchema,
  approvedHash: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  lastRunId: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  artifactPaths: z.array(z.string()),
})

export const PilotStateSchema = z.object({
  version: z.literal(1),
  featureDir: z.string(),
  phases: z.record(PhaseIdSchema, PhaseStateSchema),
  settings: PilotSettingsSchema,
})

// IPC payload schemas

export const InitializePayloadSchema = z.object({
  featureDir: z.string().min(1),
})

export const FeatureListPayloadSchema = z.object({}).passthrough()

export const FeatureCreatePayloadSchema = z.object({
  name: z.string().min(1),
  createBranch: z.boolean(),
  initialPrompt: z.string().optional(),
})

export const SessionListPayloadSchema = z.object({}).passthrough()

export const PhaseApprovePayloadSchema = z.object({
  featureDir: z.string().min(1),
  phase: PhaseIdSchema,
  note: z.string().optional(),
  autoUnlockNext: z.boolean(),
})

export const PhaseRejectPayloadSchema = z.object({
  featureDir: z.string().min(1),
  phase: PhaseIdSchema,
  reason: z.string().min(1),
  modifyPrompt: z.boolean(),
})

export const PhaseRevokePayloadSchema = z.object({
  featureDir: z.string().min(1),
  phase: PhaseIdSchema,
  note: z.string().optional(),
})

export const ArtifactReadPayloadSchema = z.object({
  artifactPath: z.string().min(1),
  phase: PhaseIdSchema,
  featureDir: z.string().min(1),
})

export const ArtifactSavePayloadSchema = z.object({
  artifactPath: z.string().min(1),
  content: z.string(),
  phase: PhaseIdSchema,
  featureDir: z.string().min(1),
  approveInSameStep: z.boolean(),
  note: z.string().optional(),
})

export const HistoryLoadPayloadSchema = z.object({
  featureDir: z.string().min(1),
})

export const ImplementFileDecisionPayloadSchema = z.object({
  featureDir: z.string().min(1),
  filePath: z.string().min(1),
  decision: z.enum(['approve', 'skip']),
  note: z.string().optional(),
})

export const ImplementStopPayloadSchema = z.object({
  featureDir: z.string().min(1),
})

export const CheckpointCreatePayloadSchema = z.object({
  featureDir: z.string().min(1),
  repoRoot: z.string().min(1),
})
