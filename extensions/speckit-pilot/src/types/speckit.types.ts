export type PhaseId =
  | 'constitution'
  | 'specify'
  | 'clarify'
  | 'plan'
  | 'checklist'
  | 'tasks'
  | 'analyze'
  | 'implement'
  | 'self-review'
  | 'open-pr'

export type PhaseStatus =
  | 'locked'
  | 'ready'
  | 'running'
  | 'awaiting_review'
  | 'approved'
  | 'stale'
  | 'modified'
  | 'failed'
  | 'skipped'

export type AutonomyLevel = 'guided' | 'standard' | 'fast'

export type BoardStage = 'backlog' | 'in-progress' | 'in-review' | 'done'

export const STAGE_ORDER: BoardStage[] = ['backlog', 'in-progress', 'in-review', 'done']

export type CardType = 'feature' | 'bug' | 'chore' | 'spike'

export type CardSource = 'native' | 'linear' | 'jira'

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface KnowledgeRef {
  file: string
  line: number
  snippet: string
}

export interface CardBrief {
  title: string
  type: CardType
  scope: string
  checklist: ChecklistItem[]
  attachments: string[]
  knowledgeRefs: KnowledgeRef[]
  source: CardSource
  createdAt: string
}

export interface CardComment {
  id: string
  author: 'you' | 'agent'
  body: string
  ts: string
  appliedToRunId?: string | null
}

export interface ArtifactRevision {
  commit: string
  ts: string
  subject: string
}

export type ArtifactKind = 'spec' | 'plan' | 'tasks' | 'checklist' | 'self-review' | 'diff' | 'pr'

export interface ArtifactRef {
  kind: ArtifactKind
  path: string | null
  label: string
  exists: boolean
  revisions: ArtifactRevision[]
  prUrl?: string | null
}

export type CardRunStatus =
  | 'none'
  | 'waiting'
  | 'running'
  | 'awaiting_review'
  | 'failed'
  | 'completed'

export interface CardSummary {
  featureDir: string
  title: string
  type: CardType
  scopeLine: string
  source: CardSource
  sourceUrl: string | null
  sourceKey: string | null
  stage: BoardStage
  runStatus: CardRunStatus
  phaseSummary: { done: number; total: number; awaitingReview: boolean }
  prUrl: string | null
}

export interface PhaseState {
  id: PhaseId
  status: PhaseStatus
  approvedHash: string | null
  approvedAt: string | null
  approvedBy: string | null
  lastRunId: string | null
  lastRunAt: string | null
  artifactPaths: string[]
  feedback: string | null
  batchIndex: number | null
}

export interface PhaseGateConfig {
  required: boolean
  autoApprove: boolean
  perFileConfirm: boolean
}

export interface LinearSettings {
  teamFilter?: string
}

export interface JiraSettings {
  domain: string
  email: string
  jql: string
}

export interface JiraCreds {
  domain: string
  email: string
  apiToken: string
  jql: string
}

export interface Ticket {
  source: 'linear' | 'jira'
  key: string
  sourceUrl: string
  title: string
  body?: string
  bodyFormat?: 'markdown' | 'html'
  acceptanceCriteria?: string[]
  priority?: string
  size?: string
  runRef?: string | null
}

export interface TicketRef {
  source: 'linear' | 'jira'
  key: string
  sourceUrl: string
  title: string
}

export interface RunMeta {
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  completedAt: string | null
  autonomyLevel: AutonomyLevel
}

export interface SelfReviewResult {
  format: { passed: boolean; output: string }
  lint: { passed: boolean; errorCount: number; warningCount: number; output: string }
  coverage: { passed: boolean; percentage: number; output: string }
  googleReview: { passed: boolean; blockerCount: number; output: string }
  summary: string
}

export interface PilotSettings {
  defaultModel: string
  defaultAutonomy: AutonomyLevel
  batchCheckinsEnabled: boolean
  writeStatusBackOnPrOpen: boolean
  linear: LinearSettings | null
  jira: JiraSettings | null
  phaseGates: Record<PhaseId, PhaseGateConfig>
  disallowedPaths: string[]
  maxFilesPerImplementRun: number
  maxTokensPerCommand: number
  commandTimeoutMs: number
  requireCleanTreeForImplement: boolean
  createCheckpointBeforeImplement: boolean
  runConsolePosition: 'bottom' | 'side' | 'tab'
  reviewerIdentity: 'git' | 'os' | 'custom'
  customReviewerName: string | null
  branchConvention: 'sequential' | 'feature-slash' | 'custom'
  customBranchPattern: string | null
  openSidebarOnStart: boolean
  maxConcurrentRuns: number
  // The project already has a ratified constitution that spec-kit respects, so the
  // per-card Constitution phase is skipped by default. Set true to run it each card.
  runConstitutionPhase: boolean
  // Persisted step logs older than this many days are pruned. Default 30.
  logRetentionDays: number
}

export interface PilotState {
  version: 3
  featureDir: string
  card: CardBrief
  stage: BoardStage
  ticket: TicketRef | null
  run: RunMeta | null
  queuePosition: 'active' | 'pending' | null
  worktreePath: string | null
  branchName: string | null
  prUrl: string | null
  phases: Record<PhaseId, PhaseState>
  settings: PilotSettings
}

export interface HistoryEntry {
  ts: string
  actor: string
  action:
    | 'run_start'
    | 'run_complete'
    | 'run_failed'
    | 'approved'
    | 'rejected'
    | 'revoked'
    | 'modified'
    | 'stale'
    | 'skipped'
    | 'unskipped'
    | 'file_approved'
    | 'file_skipped'
    | 'request_changes'
    | 'run_cancelled'
    | 'pr_opened'
    | 'comment'
    | 'artifact_modified'
  phase: PhaseId
  runId?: string
  hash?: string
  inputs?: string[]
  note?: string
  filePath?: string
}

export interface PendingFileWrite {
  taskId: string
  filePath: string
  isNew: boolean
  linesAdded: number
  linesRemoved: number
  diffContent: string
  decision: 'pending' | 'approved' | 'skipped'
}

export interface RunRecord {
  id: string
  phase: PhaseId
  startedAt: string
  sessionId: string
  commandInjected: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  pendingFileWrites: PendingFileWrite[]
}

export interface Feature {
  name: string
  dir: string
  specPath: string
  lastModified: number
}

export const PHASE_LABELS: Record<PhaseId, string> = {
  constitution: 'Constitution',
  specify: 'Specify',
  clarify: 'Clarify',
  plan: 'Plan',
  checklist: 'Checklist',
  tasks: 'Tasks',
  analyze: 'Analyze',
  implement: 'Implement',
  'self-review': 'Self-review',
  'open-pr': 'Open PR',
}

export const PHASE_ORDER: PhaseId[] = [
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
]

export const DEFAULT_PHASE_GATE: PhaseGateConfig = {
  required: true,
  autoApprove: false,
  perFileConfirm: false,
}

export const DEFAULT_SETTINGS: PilotSettings = {
  defaultModel: 'claude-opus-4-6',
  defaultAutonomy: 'standard',
  batchCheckinsEnabled: true,
  writeStatusBackOnPrOpen: false,
  linear: null,
  jira: null,
  phaseGates: Object.fromEntries(
    PHASE_ORDER.map((id) => [
      id,
      id === 'implement'
        ? { required: true, autoApprove: false, perFileConfirm: true }
        : id === 'checklist'
          ? { required: false, autoApprove: false, perFileConfirm: false }
          : id === 'self-review' || id === 'open-pr'
            ? { required: true, autoApprove: false, perFileConfirm: false }
            : { ...DEFAULT_PHASE_GATE },
    ])
  ) as Record<PhaseId, PhaseGateConfig>,
  disallowedPaths: ['.env*', 'secrets/**', '*.pem', '*.key'],
  maxFilesPerImplementRun: 25,
  maxTokensPerCommand: 50000,
  commandTimeoutMs: 300000,
  requireCleanTreeForImplement: true,
  createCheckpointBeforeImplement: true,
  runConsolePosition: 'bottom',
  reviewerIdentity: 'git',
  customReviewerName: null,
  branchConvention: 'sequential',
  customBranchPattern: null,
  openSidebarOnStart: true,
  maxConcurrentRuns: 3,
  runConstitutionPhase: false,
  logRetentionDays: 30,
}

/** A card with no run started yet defaults to this brief when created empty. */
export function createDefaultBrief(title: string, source: CardSource = 'native'): CardBrief {
  return {
    title,
    type: 'feature',
    scope: '',
    checklist: [],
    attachments: [],
    knowledgeRefs: [],
    source,
    createdAt: new Date().toISOString(),
  }
}
