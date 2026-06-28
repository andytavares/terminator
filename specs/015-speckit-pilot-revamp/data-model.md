# Data Model: SpecKit Pilot Revamp

**Date**: 2026-06-27
**Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

---

## Extended Phase Lifecycle (10 phases)

```typescript
type PhaseId =
  | 'constitution' // phase 1 (existing)
  | 'specify' // phase 2 (existing)
  | 'clarify' // phase 3 (existing)
  | 'plan' // phase 4 (existing)
  | 'checklist' // phase 5 (existing, optional)
  | 'tasks' // phase 6 (existing)
  | 'analyze' // phase 7 (existing)
  | 'implement' // phase 8 (existing)
  | 'self-review' // phase 9 (NEW — always required gate)
  | 'open-pr' // phase 10 (NEW — always required gate)
```

`PHASE_ORDER` constant updated to include `'self-review'` and `'open-pr'` as the last two entries.

Both new phases MUST have `required: true` and `autoApprove: false` in their `PhaseGateConfig` regardless of the workspace autonomy setting.

---

## Ticket

Represents a ticket fetched from Linear or Jira. Not persisted to disk — fetched live from the tracker API. Cached in-memory for the session.

```typescript
interface Ticket {
  source: 'linear' | 'jira'
  key: string // e.g. "ENG-482" or "PAY-1192"
  sourceUrl: string // URL to the ticket in the tracker
  title: string
  body: string // Description / body text
  acceptanceCriteria: string[] // Extracted from ticket body or dedicated field
  priority: 'urgent' | 'high' | 'medium' | 'low' | null
  sizeEstimate: string | null // e.g. "S", "M", "L", "XL" or points as string
  runRef: RunRef | null // Non-null if this ticket has been dispatched
}

interface RunRef {
  featureDir: string // e.g. "specs/015-fix-reattach-race"
  activePhase: PhaseId | null
  phaseStatus: PhaseStatus | null
}
```

---

## Run (extended)

The existing `PilotState` is extended to model a dispatched-ticket run. Each run corresponds to one `specs/NNN-slug/.pilot/state.json` file.

```typescript
// Extended PilotState
interface PilotState {
  version: 2 // bumped from 1
  featureDir: string
  phases: Record<PhaseId, PhaseState>
  settings: PilotSettings

  // NEW fields for revamp
  ticket: TicketRef | null // The ticket that seeded this run; null for manual runs
  run: RunMeta | null // Active run metadata; null until first dispatch
  queuePosition: 'active' | 'pending' | null // null for manual (non-dispatched) runs
  worktreePath: string | null // Absolute path to .wt/<slug>; null until created
  branchName: string | null // e.g. "fix/eng-482-reattach-race"
  prUrl: string | null // Set after Open PR completes
}

interface TicketRef {
  source: 'linear' | 'jira'
  key: string
  sourceUrl: string
  title: string
}

interface RunMeta {
  id: string // UUID, e.g. "a91f..."
  autonomyLevel: AutonomyLevel
  startedAt: string // ISO timestamp
  currentPhase: PhaseId | null
  status: 'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled'
}

type AutonomyLevel = 'guided' | 'standard' | 'fast'
```

---

## PhaseState (extended)

Two new fields for the revamp (all other fields unchanged):

```typescript
interface PhaseState {
  id: PhaseId
  status: PhaseStatus
  approvedHash: string | null
  approvedAt: string | null
  approvedBy: string | null
  lastRunId: string | null
  lastRunAt: string | null
  artifactPaths: string[]

  // NEW
  feedback: string | null // "Request changes" note that feeds next re-run
  batchIndex: number | null // For Implement: which tasks.md section batch (0-based)
}
```

---

## PilotSettings (extended)

Existing settings retained. New fields added:

```typescript
interface PilotSettings {
  // --- existing fields (unchanged) ---
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

  // --- NEW fields ---
  defaultAutonomy: AutonomyLevel // 'standard' by default
  batchCheckinsEnabled: boolean // true by default
  writeStatusBackOnPrOpen: boolean // true by default

  linear: LinearSettings | null
  jira: JiraSettings | null
}

interface LinearSettings {
  connected: boolean // true if a key has been stored
  teamFilter: string | null // Optional Linear team key to scope inbox
}

interface JiraSettings {
  connected: boolean
  domain: string | null // e.g. "my-company.atlassian.net"
  email: string | null // stored for display only (not the password)
  jql: string // default: "assignee = currentUser()"
}
```

**Important**: API keys/tokens for Linear and Jira are NEVER stored in `PilotSettings` / `state.json`. They live in `electron-store` (main process only). `LinearSettings.connected` and `JiraSettings.connected` are boolean flags derived at runtime by checking if a credential exists in the store.

---

## HistoryEntry (extended)

New action values for revamp:

```typescript
type HistoryAction =
  // existing
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
  // NEW
  | 'dispatched' // Ticket dispatched to run
  | 'request_changes' // Developer requested changes with a note
  | 'checkin_continue' // Batch check-in: developer chose "Continue"
  | 'checkin_pause' // Batch check-in: developer chose "Pause"
  | 'checkin_split' // Batch check-in: developer chose "Split"
  | 'pr_opened' // PR was successfully opened
  | 'run_cancelled' // Developer cancelled run
  | 'run_queued' // Run was queued (another run active)
```

---

## Self-Review phase artifacts

The Self-Review phase (phase 9) produces a structured result stored in `.pilot/self-review.json`:

```typescript
interface SelfReviewResult {
  runId: string
  completedAt: string
  formatIssues: number // output of npm run format
  lintErrors: number
  lintWarnings: number
  testCount: number // total tests passing
  newTestCount: number // tests added in this run
  coveragePct: number // overall coverage %
  coveragePass: boolean // true if >= 80%
  googleReviewBlockers: number
  googleReviewNits: number
  agentSummary: string // prose summary from the agent
  flaggedItems: string[] // pre-existing issues surfaced but not silenced
}
```

---

## Run Queue (in-memory, main process)

```typescript
// In-memory only — not persisted
interface RunQueueEntry {
  featureDir: string
  ticketKey: string
  autonomyLevel: AutonomyLevel
  queuedAt: string
}

// Keyed by workspace/repo root path
const runQueue: Map<string, RunQueueEntry[]>
const activeRun: Map<string, string> // workspacePath → active featureDir
```

---

## File layout for a dispatched run

```
specs/015-fix-reattach-race/
├── ticket.md            # seed written at dispatch (title, body, AC, source URL)
├── spec.md              # written by Specify phase
├── plan.md              # written by Plan phase
├── tasks.md             # written by Tasks phase
└── .pilot/
    ├── state.json       # PilotState v2
    ├── history.jsonl    # append-only audit log
    └── self-review.json # written by Self-Review phase

.wt/015-fix-reattach-race/   # isolated git worktree (deleted on run completion)
```

---

## Ticket seed format (`ticket.md`)

```markdown
# Ticket: <title>

**Source**: <LINEAR|JIRA> · <key>
**URL**: <sourceUrl>
**Priority**: <priority>
**Estimate**: <sizeEstimate>

## Description

<body>

## Acceptance Criteria

- <ac[0]>
- <ac[1]>
```
