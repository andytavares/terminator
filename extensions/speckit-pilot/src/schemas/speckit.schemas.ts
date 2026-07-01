import { z } from 'zod'

export const PhaseIdSchema = z.enum([
  'constitution',
  'specify',
  'clarify',
  'plan',
  'checklist',
  'tasks',
  'analyze',
  'implement',
  'self-review',
  'open-pr',
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
  'skipped',
])

const PhaseGateConfigSchema = z.object({
  required: z.boolean(),
  autoApprove: z.boolean(),
  perFileConfirm: z.boolean(),
})

const LinearSettingsSchema = z.object({
  teamFilter: z.string().optional(),
})

const JiraSettingsSchema = z.object({
  domain: z.string(),
  email: z.string(),
  jql: z.string(),
})

export const BoardStageSchema = z.enum(['backlog', 'in-progress', 'in-review', 'done'])

export const CardTypeSchema = z.enum(['feature', 'bug', 'chore', 'spike'])

export const CardSourceSchema = z.enum(['native', 'linear', 'jira'])

export const ChecklistItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
})

export const KnowledgeRefSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  snippet: z.string(),
})

export const CardBriefSchema = z.object({
  title: z.string(),
  type: CardTypeSchema.default('feature'),
  scope: z.string().default(''),
  checklist: z.array(ChecklistItemSchema).default([]),
  attachments: z.array(z.string()).default([]),
  knowledgeRefs: z.array(KnowledgeRefSchema).default([]),
  source: CardSourceSchema.default('native'),
  createdAt: z.string(),
})

export const CardCommentSchema = z.object({
  id: z.string(),
  author: z.enum(['you', 'agent']),
  body: z.string(),
  ts: z.string(),
  appliedToRunId: z.string().nullable().optional(),
})

const PilotSettingsSchema = z.object({
  defaultModel: z.string(),
  defaultAutonomy: z.enum(['guided', 'standard', 'fast']).default('standard'),
  batchCheckinsEnabled: z.boolean().default(true),
  writeStatusBackOnPrOpen: z.boolean().default(false),
  linear: LinearSettingsSchema.nullable().default(null),
  jira: JiraSettingsSchema.nullable().default(null),
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
  maxConcurrentRuns: z.number().int().positive().default(3),
  runConstitutionPhase: z.boolean().default(false),
  logRetentionDays: z.number().int().positive().default(30),
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
  feedback: z.string().nullable().default(null),
  batchIndex: z.number().nullable().default(null),
})

const RunMetaSchema = z.object({
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  autonomyLevel: z.enum(['guided', 'standard', 'fast']),
})

const TicketRefSchema = z.object({
  source: z.enum(['linear', 'jira']),
  key: z.string(),
  sourceUrl: z.string(),
  title: z.string(),
})

// v3 schema — current canonical schema (adds card + stage)
export const PilotStateSchema = z.object({
  version: z.literal(3),
  featureDir: z.string(),
  card: CardBriefSchema,
  stage: BoardStageSchema,
  ticket: TicketRefSchema.nullable().default(null),
  run: RunMetaSchema.nullable().default(null),
  queuePosition: z.enum(['active', 'pending']).nullable().default(null),
  worktreePath: z.string().nullable().default(null),
  branchName: z.string().nullable().default(null),
  prUrl: z.string().nullable().default(null),
  phases: z.record(PhaseIdSchema, PhaseStateSchema),
  settings: PilotSettingsSchema,
})

// v2 schema — read-only, used for migration
const PilotStateV2Schema = z.object({
  version: z.literal(2),
  featureDir: z.string(),
  ticket: TicketRefSchema.nullable().default(null),
  run: RunMetaSchema.nullable().default(null),
  queuePosition: z.enum(['active', 'pending']).nullable().default(null),
  worktreePath: z.string().nullable().default(null),
  branchName: z.string().nullable().default(null),
  prUrl: z.string().nullable().default(null),
  phases: z.record(PhaseIdSchema, PhaseStateSchema),
  settings: PilotSettingsSchema,
})

// v1 schema — read-only, used for migration
const PilotStateV1Schema = z.object({
  version: z.literal(1),
  featureDir: z.string(),
  phases: z.record(PhaseIdSchema, PhaseStateSchema),
  settings: PilotSettingsSchema,
})

// Lenient reader that accepts v1, v2, or v3; persistence normalises to v3 shape
export const PilotStateAnyVersionSchema = z.union([
  PilotStateSchema,
  PilotStateV2Schema,
  PilotStateV1Schema,
])

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
  worktreePath: z.string().optional(),
})

export const TicketListPayloadSchema = z.object({
  workspacePath: z.string().min(1),
})

export const CredentialsSetPayloadSchema = z.object({
  source: z.enum(['linear', 'jira']),
  apiKey: z.string().optional(),
  domain: z.string().optional(),
  email: z.string().optional(),
  apiToken: z.string().optional(),
  jql: z.string().optional(),
})

export const CredentialsStatusPayloadSchema = z.object({
  source: z.enum(['linear', 'jira']),
})

export const DispatchPayloadSchema = z.object({
  workspacePath: z.string().min(1),
  ticket: TicketRefSchema,
  autonomyLevel: z.enum(['guided', 'standard', 'fast']),
  phaseGates: z.record(
    PhaseIdSchema,
    z.object({ required: z.boolean(), autoApprove: z.boolean(), perFileConfirm: z.boolean() })
  ),
})

export const RunCancelPayloadSchema = z.object({
  featureDir: z.string().min(1),
  workspacePath: z.string().min(1),
})

export const PhaseRequestChangesPayloadSchema = z.object({
  featureDir: z.string().min(1),
  phase: PhaseIdSchema,
  note: z.string().min(1),
})

export const PhaseCommentPayloadSchema = z.object({
  featureDir: z.string().min(1),
  phase: PhaseIdSchema,
  note: z.string().min(1),
})

export const CheckinDecisionPayloadSchema = z.object({
  featureDir: z.string().min(1),
  decision: z.enum(['continue', 'pause', 'split', 'redirect']),
  batchIndex: z.number().int(),
  redirectNote: z.string().optional(),
})

export const OpenPrPayloadSchema = z.object({
  featureDir: z.string().min(1),
  workspacePath: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  baseBranch: z.string().default('main'),
})

export const SelfReviewReadPayloadSchema = z.object({
  featureDir: z.string().min(1),
})

// --- Board / card payload schemas ---

const CardBriefInputSchema = z.object({
  title: z.string(),
  type: CardTypeSchema.optional(),
  scope: z.string().optional(),
  checklist: z.array(ChecklistItemSchema).optional(),
  attachments: z.array(z.string()).optional(),
  knowledgeRefs: z.array(KnowledgeRefSchema).optional(),
  source: CardSourceSchema.optional(),
})

export const CardListPayloadSchema = z.object({
  repoRoot: z.string().min(1),
})

export const CardCreatePayloadSchema = z.object({
  repoRoot: z.string().min(1),
  brief: CardBriefInputSchema,
  ticket: TicketRefSchema.optional(),
})

export const CardUpdatePayloadSchema = z.object({
  featureDir: z.string().min(1),
  brief: CardBriefInputSchema.partial(),
})

export const CardMovePayloadSchema = z.object({
  featureDir: z.string().min(1),
  workspacePath: z.string().min(1),
  toStage: BoardStageSchema,
})

export const CardCommentPayloadSchema = z.object({
  featureDir: z.string().min(1),
  body: z.string().min(1),
})

export const CommentListPayloadSchema = z.object({
  featureDir: z.string().min(1),
})

export const ArtifactListPayloadSchema = z.object({
  featureDir: z.string().min(1),
})

export const KnowledgeSearchPayloadSchema = z.object({
  repoRoot: z.string().min(1),
  query: z.string().min(1),
})
