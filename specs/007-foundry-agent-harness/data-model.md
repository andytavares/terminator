# Data Model: Foundry — Agentic Harness Extension

**Date**: 2026-05-28  
**Branch**: `007-foundry-agent-harness`

---

## Entities

### Harness

Workspace-level configuration. One per workspace root. Stored in `.foundry/harness.json`.

```typescript
interface Harness {
  version: 1
  workspaceRoot: string // absolute path — set at init, not stored in file
  sensors: Sensor[]
  gateDefaults: GateDefaults
  providerRef: ProviderRef | null // workspace-level provider override; null = use global default
  iterationLimit: number // default: 3
  agentsMdPath: string // always: <workspaceRoot>/AGENTS.md
}

interface GateDefaults {
  requireGateAfterEachIteration: boolean // default: true
  sensorsMustPassBeforeGate: boolean // default: true
  autoCheckpointBeforeRun: boolean // default: true
  requireCleanWorkingTree: boolean // default: true
}
```

Validation rules:

- `iterationLimit` ≥ 1, ≤ 20
- `sensors` names must be unique within a harness
- `providerRef.type` must be one of: `claude | openai | gemini | ollama | custom`

File on disk: `.foundry/harness.json` — MUST NOT contain `apiKey` or any secret field.

---

### Sensor

A shell command registered as a feedback gate.

```typescript
interface Sensor {
  name: string // unique within harness (e.g., "lint", "test", "build")
  command: string // shell command string (e.g., "eslint src --ext .ts,.tsx")
  lastResult?: SensorResult // last health-check or run result; not persisted to disk
}
```

---

### SensorResult

Output from one sensor execution.

```typescript
interface SensorResult {
  sensorName: string
  command: string
  exitCode: number
  stderrExcerpt: string // last 20 lines of stderr
  stdoutExcerpt: string // last 20 lines of stdout
  pass: boolean // exitCode === 0
  durationMs: number
  runAt: string // ISO 8601
}
```

---

### Provider

An AI backend configuration. Stored globally in app settings (not in `harness.json`). API key stored in `.foundry/keychain.enc` as a safeStorage-encrypted base64 blob, referenced by `keychainKey`.

```typescript
type ProviderType = 'claude' | 'openai' | 'gemini' | 'ollama' | 'custom'

interface Provider {
  id: string // UUID, stable across renames
  type: ProviderType
  label: string // display name (e.g., "Claude (work)")
  model: string // (e.g., "claude-sonnet-4-6", "gpt-4o")
  endpoint?: string // for ollama/custom (e.g., "http://localhost:11434")
  keychainKey?: string // key ID in keychain.enc (e.g., "foundry.provider.<id>.apikey")
  supportsStreaming: boolean // true for claude/openai/gemini; false for ollama/custom CLI mode
}

interface ProviderRef {
  providerId: string // references Provider.id
  model?: string // workspace-level model override
}
```

Validation rules:

- `claude`, `openai`, `gemini` require `keychainKey` to be set before a run can start
- `ollama` and `custom` require `endpoint`
- `supportsStreaming: false` providers cannot be used for Co-pilot mode

---

### Run

A single agent execution session. One active Spec-to-Code or Orchestrate run per workspace allowed.

```typescript
type RunMode = 'spec-to-code' | 'orchestrate' | 'co-pilot'

type RunStatus =
  | 'running'
  | 'gate' // awaiting developer gate decision
  | 'paused-error' // provider error, waiting for switch/resume
  | 'done'
  | 'rejected'
  | 'aborted'

interface Run {
  id: string // UUID v4
  mode: RunMode
  providerId: string
  model: string
  specPath?: string // for spec-to-code: path to spec file
  prompt?: string // for spec-to-code with inline text; or orchestrate task description
  status: RunStatus
  createdAt: string // ISO 8601
  completedAt?: string // ISO 8601
  workspaceRoot: string
  checkpointCommit?: string // git hash of pre-run checkpoint
  currentIteration: number // 1-indexed
  iterationLimit: number
  iterations: Iteration[]
  subAgents?: SubAgent[] // only for orchestrate mode
  fileChanges: FileChange[] // accumulated across current un-gated iteration
}
```

State transitions:

```
(new) → running → gate → running (next iteration on approve/request-changes)
                gate → done (on final approve)
                gate → rejected (on reject)
running → paused-error → running (on provider switch + resume)
running → aborted (on abort)
```

---

### Iteration

One prompt-dispatch-through-sensor cycle within a Run.

```typescript
interface Iteration {
  number: number
  promptText: string // full prompt including any [FEEDBACK]: prefix
  fileChanges: FileChange[]
  sensorResults: SensorResult[]
  gate?: Gate
  startedAt: string // ISO 8601
  completedAt?: string // ISO 8601
}
```

---

### Gate

A human checkpoint at the end of an Iteration.

```typescript
type GateDecision = 'approve' | 'request-changes' | 'reject'

interface Gate {
  id: string // UUID v4
  iterationNumber: number
  fileChanges: FileChange[]
  sensorResults: SensorResult[]
  decision?: GateDecision
  note?: string // required for 'request-changes'; prepended as [FEEDBACK]: in next prompt
  actor: string // 'user'
  decidedAt?: string // ISO 8601
}
```

---

### FileChange

A file modified by the agent during a run iteration.

```typescript
type FileChangeStatus = 'new' | 'modified' | 'deleted'

interface FileChange {
  filePath: string // absolute path
  status: FileChangeStatus
  linesAdded: number
  linesRemoved: number
  unifiedDiff: string // git-style unified diff against last committed version
}
```

---

### SubAgent

One node in the Orchestrate run's DAG.

```typescript
type SubAgentStatus = 'pending' | 'running' | 'gate' | 'done' | 'rejected'

interface SubAgent {
  agentId: string // short ID used as DAG node ID (e.g., "agent-1")
  role: string // human-readable role description
  dependsOn: string[] // agentId[] — upstream dependencies
  inputFrom: string[] // agentId[] — agents whose output this agent receives as input
  outputArtifacts: string[] // file paths expected as output
  status: SubAgentStatus
  runId?: string // UUID of the Run created when this sub-agent executes
  position?: { x: number; y: number } // React Flow node position
}
```

Validation rules:

- DAG must be a directed acyclic graph (cycle detection: Kahn's algorithm)
- Node count: 2–8 (FR-025)
- A sub-agent with `status !== 'done'` blocks all sub-agents that `dependsOn` it

---

### HistoryEntry

One completed or aborted run record, written as a single JSON line to `.foundry/history.jsonl`.

```typescript
interface HistoryEntry {
  runId: string
  mode: RunMode
  providerId: string
  providerLabel: string
  model: string
  specPath?: string
  promptSummary: string // first 200 chars of spec/prompt
  status: RunStatus
  tokenCountIn: number
  tokenCountOut: number
  sensorSummary: string // e.g., "3/3 pass"
  gateDecisions: GateDecisionSummary[]
  filesChangedCount: number
  durationMs: number
  createdAt: string // ISO 8601
  completedAt: string // ISO 8601
  subAgentRunIds?: string[] // for orchestrate mode
}

interface GateDecisionSummary {
  iterationNumber: number
  decision: GateDecision
  note?: string
  decidedAt: string // ISO 8601
}
```

File format: one JSON object per line, newline-delimited. Never pruned. UI paginates (200 entries default, load-more for older records).

---

### CopilotMessage

One message in a Co-pilot conversation turn. Used by `copilot.store.ts` and `CopilotView.tsx`.

```typescript
interface CopilotMessage {
  id: string // UUID v4
  role: 'user' | 'agent'
  content: string
  timestamp: string // ISO 8601
  filesModified?: string[] // file paths the agent mentioned modifying in this message
}
```

---

### HarnessHealthEvent

Tracked in main process in-memory (not persisted). Drives the health status bar via `foundry:health-changed` push events.

```typescript
type HealthEventKind = 'sensor-failure' | 'feedforward-gap' | 'stale-reference'

interface HarnessHealthEvent {
  kind: HealthEventKind
  sensorName?: string // for sensor-failure
  specPath?: string // for feedforward-gap
  agentsMdLine?: number // for stale-reference
  agentsMdRef?: string // the stale path reference
  consecutiveCount: number // triggers alert at 3
  lastOccurredAt: string // ISO 8601
}
```

---

## File Layout on Disk

```text
<workspaceRoot>/
├── AGENTS.md                 # Feedforward guides (managed by Foundry setup wizard)
└── .foundry/
    ├── harness.json          # Harness config (no secrets)
    ├── keychain.enc          # safeStorage-encrypted API key blobs (base64 JSON map)
    └── history.jsonl         # Append-only run history (unbounded)
```

---

## State Transitions: Run Status

```
           ┌─────────────────────────────────────────────┐
           │                                             │
  [new]──▶ running ──▶ gate ──▶ running (next iter)     │
                │        │         │                     │
                │        ▼         │                     │
                │       done ◀─────┘ (final approve)     │
                │        │                               │
                │        ▼ (reject)                      │
                │      rejected                          │
                │                                        │
                ▼ (abort)                                │
             aborted                                     │
                                                         │
          paused-error ◀── running (on provider error)  │
                │                                        │
                └──▶ running (on provider switch) ───────┘
```
