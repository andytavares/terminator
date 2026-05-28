/* v8 ignore file */
import type {
  Harness,
  Provider,
  SensorResult,
  Run,
  RunMode,
  SubAgent,
  GateDecision,
  HistoryEntry,
  HarnessHealthEvent,
  CopilotMessage,
  FileChange,
} from './foundry.types.js'

// ─── Harness ────────────────────────────────────────────────────────────────

export interface HarnessReadPayload {
  workspaceRoot: string
}
export type HarnessReadResponse = { harness: Harness } | { notFound: true } | { error: string }

export interface HarnessWritePayload {
  workspaceRoot: string
  harness: Harness
}
export type HarnessWriteResponse = { ok: true } | { error: string }

export interface AgentsMdReadPayload {
  workspaceRoot: string
}
export type AgentsMdReadResponse = { content: string } | { notFound: true } | { error: string }

export interface AgentsMdWritePayload {
  workspaceRoot: string
  content: string
}
export type AgentsMdWriteResponse = { ok: true } | { error: string }

export interface AgentsMdScanPayload {
  workspaceRoot: string
}
export type AgentsMdScanResponse =
  | { staleRefs: Array<{ line: number; ref: string }> }
  | { error: string }

// ─── Provider ───────────────────────────────────────────────────────────────

export type ProviderListResponse = { providers: Provider[] } | { error: string }

export interface ProviderSavePayload {
  provider: Provider
  apiKey?: string
}
export type ProviderSaveResponse = { provider: Provider } | { error: string }

export interface ProviderDeletePayload {
  providerId: string
}
export type ProviderDeleteResponse = { ok: true } | { error: string }

export interface ProviderTestPayload {
  providerId: string
  workspaceRoot: string
}
export type ProviderTestResponse = { ok: true; latencyMs: number } | { error: string }

// ─── Sensor ─────────────────────────────────────────────────────────────────

export interface SensorRunPayload {
  sensorName: string
  command: string
  workspaceRoot: string
}
export type SensorRunResponse = { result: SensorResult } | { error: string }

export interface SensorsRunAllPayload {
  workspaceRoot: string
}
export type SensorsRunAllResponse = { results: SensorResult[] } | { error: string }

// ─── Git ─────────────────────────────────────────────────────────────────────

export interface GitStatusPayload {
  workspaceRoot: string
}
export type GitStatusResponse = { isDirty: boolean; modifiedFiles: string[] } | { error: string }

export interface GitCheckpointPayload {
  workspaceRoot: string
  runId: string
}
export type GitCheckpointResponse = { commitHash: string } | { error: string }

export interface GitStashPayload {
  workspaceRoot: string
}
export type GitStashResponse = { ok: true } | { error: string }

export interface GitRevertFilesPayload {
  workspaceRoot: string
  filePaths: string[]
}
export type GitRevertFilesResponse = { ok: true; reverted: string[] } | { error: string }

export interface GitDiffFilePayload {
  workspaceRoot: string
  filePath: string
}
export type GitDiffFileResponse =
  | { unifiedDiff: string; linesAdded: number; linesRemoved: number }
  | { error: string }

// ─── Run ────────────────────────────────────────────────────────────────────

export interface RunCreatePayload {
  workspaceRoot: string
  mode: RunMode
  providerId: string
  model: string
  specPath?: string
  prompt?: string
  iterationLimit?: number
  subAgents?: SubAgent[]
}
export type RunCreateResponse = { run: Run } | { error: string }

export interface RunGateDecidePayload {
  runId: string
  workspaceRoot: string
  decision: GateDecision
  note?: string
}
export type RunGateDecideResponse = { run: Run } | { error: string }

export interface RunAbortPayload {
  runId: string
  workspaceRoot: string
}
export type RunAbortResponse = { ok: true } | { error: string }

export interface RunSwitchProviderPayload {
  runId: string
  workspaceRoot: string
  providerId: string
  model: string
}
export type RunSwitchProviderResponse = { run: Run } | { error: string }

export interface RunListPayload {
  workspaceRoot: string
}
export type RunListResponse = { runs: Run[] } | { error: string }

// ─── Orchestrate ─────────────────────────────────────────────────────────────

export interface OrchestratePlanPayload {
  workspaceRoot: string
  taskDescription: string
  providerId: string
  model: string
}
export type OrchestratePlanResponse = { subAgents: SubAgent[] } | { error: string }

export interface DagValidatePayload {
  subAgents: SubAgent[]
}
export type DagValidateResponse = { valid: true } | { valid: false; cycleNodes: string[] }

// ─── Co-pilot ────────────────────────────────────────────────────────────────

export interface CopilotSendPayload {
  workspaceRoot: string
  providerId: string
  model: string
  message: string
  conversationHistory: CopilotMessage[]
}
export type CopilotSendResponse = { ok: true } | { error: string }

export interface CopilotRevertFilePayload {
  workspaceRoot: string
  filePath: string
}
export type CopilotRevertFileResponse = { ok: true } | { error: string }

export interface CopilotAcceptAllPayload {
  workspaceRoot: string
}
export type CopilotAcceptAllResponse = { ok: true } | { error: string }

export interface CopilotAbortPayload {
  workspaceRoot: string
  filesModifiedThisTurn: string[]
}
export type CopilotAbortResponse = { ok: true } | { error: string }

// ─── History ─────────────────────────────────────────────────────────────────

export interface HistoryLoadPayload {
  workspaceRoot: string
  offset?: number
  limit?: number
}
export type HistoryLoadResponse =
  | { entries: HistoryEntry[]; total: number; hasMore: boolean }
  | { error: string }

export interface HistoryComparePayload {
  workspaceRoot: string
  runIdA: string
  runIdB: string
}
export type HistoryCompareResponse = { runA: HistoryEntry; runB: HistoryEntry } | { error: string }

// ─── Push event payloads (main → renderer) ───────────────────────────────────

export interface RunEventPush {
  runId: string
  event: RunEvent
}
export interface CopilotEventPush {
  type: 'token' | 'file-changed' | 'done' | 'error'
  token?: string
  filePath?: string
  fileChange?: FileChange
  error?: string
}
export interface HealthChangedPush {
  events: HarnessHealthEvent[]
}
export interface RunStatusChangedPush {
  runId: string
  status: string
}
export interface CopilotResetPush {
  workspaceRoot: string
}

// ─── RunEvent (provider streaming) ───────────────────────────────────────────

export type RunEvent =
  | { type: 'token'; token: string }
  | { type: 'file-changed'; filePath: string; change: FileChange }
  | { type: 'done'; tokenCountIn: number; tokenCountOut: number }
  | { type: 'error'; message: string }
