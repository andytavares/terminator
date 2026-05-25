export type PhaseId =
  | 'constitution'
  | 'specify'
  | 'clarify'
  | 'plan'
  | 'checklist'
  | 'tasks'
  | 'analyze'
  | 'implement'

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

export interface PhaseState {
  id: PhaseId
  status: PhaseStatus
  approvedHash: string | null
  approvedAt: string | null
  approvedBy: string | null
  lastRunId: string | null
  lastRunAt: string | null
  artifactPaths: string[]
}

export interface PhaseGateConfig {
  required: boolean
  autoApprove: boolean
  perFileConfirm: boolean
}

export interface PilotSettings {
  defaultModel: string
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
  version: 1
  featureDir: string
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
]

export const DEFAULT_PHASE_GATE: PhaseGateConfig = {
  required: true,
  autoApprove: false,
  perFileConfirm: false,
}

export const DEFAULT_SETTINGS: PilotSettings = {
  defaultModel: 'claude-opus-4-6',
  phaseGates: Object.fromEntries(
    PHASE_ORDER.map((id) => [
      id,
      id === 'implement'
        ? { required: true, autoApprove: false, perFileConfirm: true }
        : id === 'checklist'
          ? { required: false, autoApprove: false, perFileConfirm: false }
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
