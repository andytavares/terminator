# IPC Channels: Foundry Extension

**Date**: 2026-05-28  
**Extension**: `terminator.foundry`  
**Prefix**: `foundry:`  
**Registered by**: `extensions/foundry/src/index.ts` via `api.ipc.registerHandler()`  
**Invoked from renderer via**: `window.electronAPI.extensionBridge.invoke('foundry:<action>', payload)`

All channels follow the existing extension IPC contract:

- Payload and response are plain JSON-serializable objects.
- Errors are returned as `{ error: string }` — never thrown to the renderer.
- Channel names are namespaced with `foundry:` prefix.

---

## Harness Channels

### `foundry:harness-read`

Read the harness configuration for a workspace.

**Payload**

```typescript
{
  workspaceRoot: string
}
```

**Response**

```typescript
{ harness: Harness } | { notFound: true } | { error: string }
```

---

### `foundry:harness-write`

Write (create or update) the harness configuration.

**Payload**

```typescript
{
  workspaceRoot: string
  harness: Harness
}
```

**Response**

```typescript
{ ok: true } | { error: string }
```

---

### `foundry:agents-md-read`

Read the AGENTS.md file at the workspace root.

**Payload**

```typescript
{
  workspaceRoot: string
}
```

**Response**

```typescript
{ content: string } | { notFound: true } | { error: string }
```

---

### `foundry:agents-md-write`

Write AGENTS.md to the workspace root.

**Payload**

```typescript
{
  workspaceRoot: string
  content: string
}
```

**Response**

```typescript
{ ok: true } | { error: string }
```

---

### `foundry:agents-md-scan`

Scan AGENTS.md for file path references that do not exist on disk.

**Payload**

```typescript
{
  workspaceRoot: string
}
```

**Response**

```typescript
{ staleRefs: Array<{ line: number; ref: string }> } | { error: string }
```

---

## Provider Channels

### `foundry:provider-list`

Return all configured providers from app settings.

**Payload**: `{}`  
**Response**

```typescript
{ providers: Provider[] } | { error: string }
```

---

### `foundry:provider-save`

Save a provider configuration. If `apiKey` is present in payload, encrypt and store it in `.foundry/keychain.enc`; strip it from the saved `Provider` record.

**Payload**

```typescript
{ provider: Provider; apiKey?: string }
```

**Response**

```typescript
{ provider: Provider } | { error: string }
```

---

### `foundry:provider-delete`

Delete a provider and remove its keychain entry.

**Payload**

```typescript
{
  providerId: string
}
```

**Response**

```typescript
{ ok: true } | { error: string }
```

---

### `foundry:provider-test`

Run a minimal ping/test call to a provider and return latency.

**Payload**

```typescript
{
  providerId: string
  workspaceRoot: string
}
```

**Response**

```typescript
{ ok: true; latencyMs: number } | { error: string }
```

---

## Sensor Channels

### `foundry:sensor-run`

Execute a single sensor command and return the result.

**Payload**

```typescript
{
  sensorName: string
  command: string
  workspaceRoot: string
}
```

**Response**

```typescript
{ result: SensorResult } | { error: string }
```

---

### `foundry:sensors-run-all`

Execute all configured sensors sequentially and return all results.

**Payload**

```typescript
{
  workspaceRoot: string
}
```

**Response**

```typescript
{ results: SensorResult[] } | { error: string }
```

---

## Git Channels

### `foundry:git-status`

Check if the working tree is dirty.

**Payload**

```typescript
{
  workspaceRoot: string
}
```

**Response**

```typescript
{ isDirty: boolean; modifiedFiles: string[] } | { error: string }
```

---

### `foundry:git-checkpoint`

Create a squashable checkpoint commit before a run.

**Payload**

```typescript
{
  workspaceRoot: string
  runId: string
}
```

**Response**

```typescript
{ commitHash: string } | { error: string }
```

---

### `foundry:git-stash`

Stash the current working tree changes.

**Payload**

```typescript
{
  workspaceRoot: string
}
```

**Response**

```typescript
{ ok: true } | { error: string }
```

---

### `foundry:git-revert-files`

Revert specific files via `git checkout --`.

**Payload**

```typescript
{ workspaceRoot: string; filePaths: string[] }
```

**Response**

```typescript
{ ok: true; reverted: string[] } | { error: string }
```

---

### `foundry:git-diff-file`

Get the unified diff for a file against its last committed version.

**Payload**

```typescript
{
  workspaceRoot: string
  filePath: string
}
```

**Response**

```typescript
{ unifiedDiff: string; linesAdded: number; linesRemoved: number } | { error: string }
```

---

## Run Channels

### `foundry:run-create`

Create and start a new run.

**Payload**

```typescript
{
  workspaceRoot: string
  mode: RunMode
  providerId: string
  model: string
  specPath?: string
  prompt?: string
  iterationLimit?: number
  subAgents?: SubAgent[]   // for orchestrate mode: confirmed plan
}
```

**Response**

```typescript
{ run: Run } | { error: string }
```

---

### `foundry:run-gate-decide`

Submit a gate decision for the current gate.

**Payload**

```typescript
{
  runId: string
  workspaceRoot: string
  decision: GateDecision
  note?: string    // required for 'request-changes'
}
```

**Response**

```typescript
{ run: Run } | { error: string }
```

---

### `foundry:run-abort`

Abort the active run, reverting un-gated file changes.

**Payload**

```typescript
{
  runId: string
  workspaceRoot: string
}
```

**Response**

```typescript
{ ok: true } | { error: string }
```

---

### `foundry:run-switch-provider`

Switch provider on a paused-error run and resume.

**Payload**

```typescript
{
  runId: string
  workspaceRoot: string
  providerId: string
  model: string
}
```

**Response**

```typescript
{ run: Run } | { error: string }
```

---

### `foundry:run-list`

List active and recent runs for a workspace.

**Payload**

```typescript
{
  workspaceRoot: string
}
```

**Response**

```typescript
{ runs: Run[] } | { error: string }
```

---

### `foundry:orchestrate-plan`

Ask the active provider to decompose a task into a DAG plan.

**Payload**

```typescript
{
  workspaceRoot: string
  taskDescription: string
  providerId: string
  model: string
}
```

**Response**

```typescript
{ subAgents: SubAgent[] } | { error: string }
```

---

### `foundry:dag-validate`

Validate a DAG for cycles and return any cycle info.

**Payload**

```typescript
{ subAgents: SubAgent[] }
```

**Response**

```typescript
{ valid: true } | { valid: false; cycleNodes: string[] }
```

---

## Co-pilot Channels

### `foundry:copilot-send`

Send a user message in the co-pilot session.

**Payload**

```typescript
{
  workspaceRoot: string
  providerId: string
  model: string
  message: string
  conversationHistory: CopilotMessage[]
}
```

**Response** (streamed via `foundry:copilot-event` push channel, then):

```typescript
{ ok: true } | { error: string }
```

---

### `foundry:copilot-revert-file`

Revert a single file in co-pilot mode.

**Payload**

```typescript
{
  workspaceRoot: string
  filePath: string
}
```

**Response**

```typescript
{ ok: true } | { error: string }
```

---

### `foundry:copilot-accept-all`

Accept all pending co-pilot file changes (clears the diff panel state).

**Payload**

```typescript
{
  workspaceRoot: string
}
```

**Response**

```typescript
{ ok: true } | { error: string }
```

---

### `foundry:copilot-abort`

Abort the co-pilot conversation turn, reverting all files modified in the current turn.

**Payload**

```typescript
{ workspaceRoot: string; filesModifiedThisTurn: string[] }
```

**Response**

```typescript
{ ok: true } | { error: string }
```

---

## History Channels

### `foundry:history-load`

Load a page of history entries from `.foundry/history.jsonl`.

**Payload**

```typescript
{ workspaceRoot: string; offset?: number; limit?: number }
// default limit: 200; offset: 0
```

**Response**

```typescript
{ entries: HistoryEntry[]; total: number; hasMore: boolean } | { error: string }
```

---

### `foundry:history-compare`

Read the raw output artifacts for two runs to enable side-by-side comparison.

**Payload**

```typescript
{
  workspaceRoot: string
  runIdA: string
  runIdB: string
}
```

**Response**

```typescript
{ runA: HistoryEntry; runB: HistoryEntry } | { error: string }
```

---

## Push (Broadcast) Channels

These channels are pushed from main process to renderer via `BrowserWindow.webContents.send()`.

| Channel                      | Payload                                                   | When                                                                                |
| ---------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `foundry:run-event`          | `{ runId, event: RunEvent }`                              | Whenever the run engine emits a token, file-change, sensor result, or status change |
| `foundry:copilot-event`      | `{ type: 'token'\|'file-changed'\|'done'\|'error', ... }` | During co-pilot response streaming                                                  |
| `foundry:health-changed`     | `{ events: HarnessHealthEvent[] }`                        | When a health alert is added or resolved                                            |
| `foundry:run-status-changed` | `{ runId, status: RunStatus }`                            | When a run changes status (gate open, abort, complete)                              |
