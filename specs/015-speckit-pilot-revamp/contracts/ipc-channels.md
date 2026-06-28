# IPC Channels: SpecKit Pilot Revamp

**Date**: 2026-06-27
**Spec**: [spec.md](../spec.md)

All extension-owned channels are invoked via `window.electronAPI.extensionBridge.invoke('speckit-pilot:<channel>', payload)` from the renderer and registered via `api.ipc.registerHandler()` in the main process.

Push events (main → renderer) are sent via `win.webContents.send('<event>', payload)`.

---

## Retained channels (existing, no signature change)

| Channel                           | Direction | Description                                                               |
| --------------------------------- | --------- | ------------------------------------------------------------------------- |
| `speckit:feature-list`            | invoke    | Scan `specs/` for feature dirs with `spec.md`                             |
| `speckit:check-artifacts`         | invoke    | Which phase artifact files exist for a feature dir                        |
| `speckit:pilot-state`             | invoke    | Load `.pilot/state.json` for a feature dir                                |
| `speckit:phase-approve`           | invoke    | Mark a phase approved, cascade stale                                      |
| `speckit:phase-reject`            | invoke    | Reject phase, delete artifact, reset to ready                             |
| `speckit:phase-revoke`            | invoke    | Revoke approval, mark downstream stale                                    |
| `speckit:artifact-read`           | invoke    | Read current file + last approved version for diff                        |
| `speckit:history-load`            | invoke    | Read and parse `history.jsonl`                                            |
| `speckit:implement-stop`          | invoke    | Stop the active implement subprocess                                      |
| `speckit:phase-skip`              | invoke    | Mark a phase skipped                                                      |
| `speckit:phase-unskip`            | invoke    | Restore a skipped phase to ready                                          |
| `speckit:file-write`              | invoke    | Write any file within the project                                         |
| `speckit:checkpoint-create`       | invoke    | Git checkpoint commit before implement (extended: accepts `worktreePath`) |
| `speckit:session-list`            | invoke    | Return active terminal sessions                                           |
| `speckit:implement-file-decision` | invoke    | Approve or skip a pending file write                                      |
| `speckit:state-changed`           | push      | State updated — broadcast to all windows                                  |

---

## New channels (revamp)

### Ticket integration

#### `speckit:ticket-list`

Fetch tickets from Linear and/or Jira.

**Payload**:

```typescript
{
  workspacePath: string
}
```

**Response**:

```typescript
{ tickets: Ticket[] } | { error: string }
```

**Behavior**: Calls Linear SDK and Jira REST API in parallel. Applies configured JQL for Jira. On HTTP 429, retries up to 3× with exponential back-off before returning `{ error }`. On auth failure, returns `{ error: 'NOT_CONFIGURED' }` (not `'INVALID_CREDENTIALS'` — no differentiation to avoid leaking credential state).

---

#### `speckit:credentials-set`

Store Linear or Jira credentials in `electron-store`. Never exposed to the renderer after storage.

**Payload**:

```typescript
{
  source: 'linear' | 'jira'
  // Linear:
  apiKey?: string
  // Jira:
  domain?: string
  email?: string
  apiToken?: string
}
```

**Response**: `{ ok: true } | { error: string }`

---

#### `speckit:credentials-status`

Return connection status only (not the actual credentials).

**Payload**: `{ source: 'linear' | 'jira' }`

**Response**:

```typescript
{ connected: boolean, email?: string, domain?: string }
```

---

### Dispatch & run lifecycle

#### `speckit:dispatch`

Create a new run from a ticket. Writes `ticket.md`, creates the `specs/NNN-slug/` dir, creates a git worktree, queues or starts the run.

**Payload**:

```typescript
{
  workspacePath: string
  ticket: TicketRef // source, key, sourceUrl, title
  autonomyLevel: AutonomyLevel
  phaseGates: Record<PhaseId, PhaseGateConfig>
}
```

**Response**:

```typescript
{ featureDir: string; queued: boolean } | { error: string }
```

**Behavior**:

1. Determine next sequential feature number.
2. Create `specs/NNN-<slug>/` dir and write `ticket.md`.
3. Initialize `.pilot/state.json` (v2) with `ticket`, `run`, `queuePosition`.
4. If a run is already active for this workspace: set `queuePosition: 'pending'`, return `{ featureDir, queued: true }`.
5. Else: create git worktree at `.wt/<slug>`, set `queuePosition: 'active'`, start runner for Constitution phase.

---

#### `speckit:run-cancel`

Cancel an active or queued run.

**Payload**: `{ featureDir: string; workspacePath: string }`
**Response**: `{ ok: true } | { error: string }`

---

#### `speckit:phase-request-changes`

Submit a "Request changes" note that feeds into a phase re-run.

**Payload**:

```typescript
{
  featureDir: string
  phase: PhaseId
  note: string
}
```

**Response**: `{ state: PilotState } | { error: string }`

**Behavior**: Stores `note` in `PhaseState.feedback`, sets phase status to `ready`, appends `request_changes` to history, triggers a re-run of the phase command with `--print "${note}"` appended.

---

#### `speckit:checkin-decision`

Respond to a batch check-in during Implement.

**Payload**:

```typescript
{
  featureDir: string
  decision: 'continue' | 'pause' | 'split'
  batchIndex: number
}
```

**Response**: `{ ok: true } | { error: string }`

---

#### `speckit:open-pr`

Run `gh pr create` in the worktree.

**Payload**:

```typescript
{
  featureDir: string
  workspacePath: string
  title: string
  body: string
  baseBranch: string // default: "main"
}
```

**Response**:

```typescript
{ prUrl: string } | { error: string }
```

**Behavior**:

1. Verify `gh auth status`.
2. Run `gh pr create --title "..." --body "..." --base <baseBranch>` in the worktree.
3. Parse PR URL from output.
4. Write PR URL back to `PilotState.prUrl` and `history.jsonl`.
5. If `writeStatusBackOnPrOpen: true`, post PR URL to the originating ticket via tracker API.

---

### Push events (main → renderer)

| Event                         | Payload                                                                         | When                                                     |
| ----------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `speckit:state-changed`       | `{ state: PilotState }`                                                         | Any state mutation (existing)                            |
| `speckit:run-output`          | `{ featureDir: string; line: string; ts: string }`                              | Each stdout line from the `claude --headless` subprocess |
| `speckit:run-phase-complete`  | `{ featureDir: string; phase: PhaseId; status: 'awaiting_review' \| 'failed' }` | Phase subprocess exits                                   |
| `speckit:queue-advanced`      | `{ featureDir: string }`                                                        | A queued run becomes active                              |
| `speckit:ticket-list-updated` | `{ tickets: Ticket[] }`                                                         | Background ticket refresh completes                      |
