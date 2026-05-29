/* v8 ignore file */
// ─── Harness ────────────────────────────────────────────────────────────────

export interface GateDefaults {
  requireGateAfterEachIteration: boolean
  sensorsMustPassBeforeGate: boolean
  autoCheckpointBeforeRun: boolean
  requireCleanWorkingTree: boolean
}

export interface Sensor {
  name: string
  command: string
}

export type ProviderType = 'claude' | 'openai' | 'gemini' | 'ollama' | 'custom'

export interface ProviderRef {
  providerId: string
  model?: string
}

export interface Harness {
  version: 1
  sensors: Sensor[]
  gateDefaults: GateDefaults
  providerRef: ProviderRef | null
  iterationLimit: number
  agentsMdPath: string
}

// ─── Provider ───────────────────────────────────────────────────────────────

export interface Provider {
  id: string
  type: ProviderType
  label: string
  model: string
  endpoint?: string
  keychainKey?: string
  supportsStreaming: boolean
}

// ─── SensorResult ───────────────────────────────────────────────────────────

export interface SensorResult {
  sensorName: string
  command: string
  exitCode: number
  stderrExcerpt: string
  stdoutExcerpt: string
  pass: boolean
  durationMs: number
  runAt: string
}

// ─── Run log ────────────────────────────────────────────────────────────────

export type RunLogKind = 'system' | 'agent' | 'file' | 'sensor' | 'ok' | 'error'

export interface RunLogEntry {
  ts: string
  kind: RunLogKind
  message: string
}

// ─── Run ────────────────────────────────────────────────────────────────────

export type RunMode = 'spec-to-code' | 'orchestrate' | 'co-pilot'

export type RunStatus = 'running' | 'gate' | 'paused-error' | 'done' | 'rejected' | 'aborted'

export type FileChangeStatus = 'new' | 'modified' | 'deleted'

export interface FileChange {
  filePath: string
  status: FileChangeStatus
  linesAdded: number
  linesRemoved: number
  unifiedDiff: string
}

export type GateDecision = 'approve' | 'request-changes' | 'reject'

export interface Gate {
  id: string
  iterationNumber: number
  fileChanges: FileChange[]
  sensorResults: SensorResult[]
  decision?: GateDecision
  note?: string
  actor: string
  decidedAt?: string
}

export interface Iteration {
  number: number
  promptText: string
  fileChanges: FileChange[]
  sensorResults: SensorResult[]
  gate?: Gate
  startedAt: string
  completedAt?: string
}

export type SubAgentStatus = 'pending' | 'running' | 'gate' | 'done' | 'rejected'

export interface SubAgent {
  agentId: string
  role: string
  dependsOn: string[]
  inputFrom: string[]
  outputArtifacts: string[]
  status: SubAgentStatus
  runId?: string
  position?: { x: number; y: number }
}

export interface Run {
  id: string
  mode: RunMode
  providerId: string
  model: string
  specPath?: string
  prompt?: string
  status: RunStatus
  createdAt: string
  completedAt?: string
  workspaceRoot: string
  checkpointCommit?: string
  currentIteration: number
  iterationLimit: number
  iterations: Iteration[]
  subAgents?: SubAgent[]
  fileChanges: FileChange[]
  sensorResults?: SensorResult[]
  worktreePath?: string
  worktreeBranch?: string
  /** Accumulated token counts across all iterations — written to history at completion */
  tokenCountIn?: number
  tokenCountOut?: number
  /** Terminator project.id created for this run's worktree — used for cleanup on completion */
  terminalProjectId?: string
}

// ─── History ────────────────────────────────────────────────────────────────

export interface GateDecisionSummary {
  iterationNumber: number
  decision: GateDecision
  note?: string
  decidedAt: string
}

export interface HistoryEntry {
  runId: string
  mode: RunMode
  providerId: string
  providerLabel: string
  model: string
  specPath?: string
  promptSummary: string
  status: RunStatus
  tokenCountIn: number
  tokenCountOut: number
  sensorSummary: string
  gateDecisions: GateDecisionSummary[]
  filesChangedCount: number
  durationMs: number
  createdAt: string
  completedAt: string
  subAgentRunIds?: string[]
}

// ─── Co-pilot ───────────────────────────────────────────────────────────────

export interface CopilotMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: string
  filesModified?: string[]
}

// ─── Health ─────────────────────────────────────────────────────────────────

export type HealthEventKind = 'sensor-failure' | 'feedforward-gap' | 'stale-reference'

export interface HarnessHealthEvent {
  kind: HealthEventKind
  sensorName?: string
  specPath?: string
  agentsMdLine?: number
  agentsMdRef?: string
  consecutiveCount: number
  lastOccurredAt: string
}
