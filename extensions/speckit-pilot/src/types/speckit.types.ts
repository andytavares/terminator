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

// A card runs through either the full SpecKit pipeline or a short quick-fix
// pipeline (plan → implement → review) for small changes.
export type RunMode = 'speckit' | 'quick'

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
  // The tracker's suggested VCS branch name (Linear provides one per issue).
  branchName?: string | null
  // Whether the tracker considers this ticket done. Used to auto-advance the
  // matching card to the "done" board stage (Linear only, for now).
  completed?: boolean
}

export interface TicketRef {
  source: 'linear' | 'jira'
  key: string
  sourceUrl: string
  title: string
  // The tracker's suggested VCS branch name, carried through so worktree
  // creation can reuse it instead of inventing a branch name.
  branchName?: string | null
}

export interface RunMeta {
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: string
  completedAt: string | null
  autonomyLevel: AutonomyLevel
}

/**
 * What the self-review checks found.
 *
 * Every field is nullable because "not measured" has to be sayable: the checks
 * run as separate steps and any of them can be skipped (a repository with no
 * lint script) or never reached. A zero would read as "no errors", and a review
 * that claims that when it does not know is worse than one that says nothing.
 *
 * `output` is null by design — each step streams to the run console live, and
 * capturing it per step would mean piping, which costs the live view.
 */
export interface SelfReviewResult {
  format: { passed: boolean | null; output: string | null }
  lint: {
    passed: boolean | null
    errorCount: number | null
    warningCount: number | null
    output: string | null
  }
  coverage: { passed: boolean | null; percentage: number | null; output: string | null }
  googleReview: { passed: boolean | null; blockerCount: number | null; output: string | null }
  summary: string
}

export interface PilotSettings {
  defaultModel: string
  defaultAutonomy: AutonomyLevel
  batchCheckinsEnabled: boolean
  writeStatusBackOnPrOpen: boolean
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
  // Which pipeline this card runs through (defaults to full SpecKit).
  mode: RunMode
  ticket: TicketRef | null
  run: RunMeta | null
  queuePosition: 'active' | 'pending' | null
  worktreePath: string | null
  branchName: string | null
  /**
   * What the worktree was cut from.
   *
   * Persisted because a card can be provisioned now and started later, when
   * the queue drains — and a run measured against `main` instead reports the
   * difference between two branches rather than the work it did.
   */
  baseBranch?: string | null
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
    | 'reset'
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

// Quick-fix runs skip the upfront spec/analysis phases: just plan the change,
// implement it, run the review gate, then open the PR. Any phase not listed here
// is marked 'skipped' when a card runs in quick mode.
export const QUICK_PHASES: PhaseId[] = ['plan', 'implement', 'self-review', 'open-pr']

export const DEFAULT_PHASE_GATE: PhaseGateConfig = {
  required: true,
  autoApprove: false,
  perFileConfirm: false,
}

export const DEFAULT_SETTINGS: PilotSettings = {
  // An alias, not a pinned id: `--model opus` is documented as resolving to
  // the latest of that family, so this default cannot go a generation stale
  // sitting here — which is exactly what the pinned `claude-opus-4-6` it
  // replaces did.
  defaultModel: 'opus',
  defaultAutonomy: 'standard',
  batchCheckinsEnabled: true,
  writeStatusBackOnPrOpen: false,
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
