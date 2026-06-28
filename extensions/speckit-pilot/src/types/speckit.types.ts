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
}

export interface PilotState {
  version: 2
  featureDir: string
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
}
