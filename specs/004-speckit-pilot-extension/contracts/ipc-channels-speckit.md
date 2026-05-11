# IPC Channels: SpecKit Pilot Extension

**Feature**: `004-speckit-pilot-extension` | **Date**: 2026-05-10

All channels use the `speckit:` namespace, registered by the extension's main-process handler via `api.ipc.registerHandler`. Payloads are validated with Zod before processing.

---

## `speckit:initialize`

Load or create `.specify/.pilot/state.json` for the current feature. Verifies on-disk artifact hashes against approved hashes and auto-marks stale phases.

**Direction**: renderer → main (invoke)

**Payload**:

```typescript
{
  featureDir: string
} // relative to repo root, e.g. "specs/004-..."
```

**Response**:

```typescript
{ state: PilotState } | { error: string }
```

---

## `speckit:feature-list`

Scan the `specs/` directory for Spec-Kit features (directories containing `spec.md`).

**Direction**: renderer → main (invoke)

**Payload**: `{}`

**Response**:

```typescript
{ features: Feature[] } | { error: string }
```

---

## `speckit:feature-create`

Create a new feature directory and optionally run the git feature branch script.

**Direction**: renderer → main (invoke)

**Payload**:

```typescript
{
  name: string           // short name, e.g. "photo-albums"
  createBranch: boolean
  initialPrompt?: string
}
```

**Response**:

```typescript
{ featureDir: string; branchName: string } | { error: string }
```

---

## `speckit:session-list`

Return all currently active terminal sessions tracked by the extension.

**Direction**: renderer → main (invoke)

**Payload**: `{}`

**Response**:

```typescript
{ sessions: SessionSnapshot[] } | { error: string }
```

---

## `speckit:phase-approve`

Record a phase approval in `state.json` and `history.jsonl`. Unlocks downstream phases.

**Direction**: renderer → main (invoke)

**Payload**:

```typescript
{
  featureDir: string
  phase: PhaseId
  note?: string
  autoUnlockNext: boolean
}
```

**Response**:

```typescript
{ state: PilotState } | { error: string }
```

---

## `speckit:phase-reject`

Record a phase rejection. Deletes output artifacts for the phase and resets to `ready`.

**Direction**: renderer → main (invoke)

**Payload**:

```typescript
{
  featureDir: string
  phase: PhaseId
  reason: string // required
  modifyPrompt: boolean
}
```

**Response**:

```typescript
{ state: PilotState } | { error: string }
```

---

## `speckit:phase-revoke`

Revoke an existing approval. Phase returns to `awaiting_review`; downstream phases become `stale`.

**Direction**: renderer → main (invoke)

**Payload**:

```typescript
{
  featureDir: string
  phase: PhaseId
  note?: string
}
```

**Response**:

```typescript
{ state: PilotState } | { error: string }
```

---

## `speckit:artifact-read`

Read the current content of a phase artifact plus the last-approved version (for diff display).

**Direction**: renderer → main (invoke)

**Payload**:

```typescript
{
  artifactPath: string // absolute path
  phase: PhaseId
  featureDir: string
}
```

**Response**:

```typescript
{
  current: string        // current file content
  approved: string       // content at time of last approval (from git show or cached)
  hash: string           // SHA-256 of current content
} | { error: string }
```

---

## `speckit:artifact-save`

Write edited artifact content to disk. Marks phase as `modified`.

**Direction**: renderer → main (invoke)

**Payload**:

```typescript
{
  artifactPath: string
  content: string
  phase: PhaseId
  featureDir: string
  approveInSameStep: boolean
  note?: string
}
```

**Response**:

```typescript
{ state: PilotState } | { error: string }
```

---

## `speckit:history-load`

Read and parse `.specify/.pilot/history.jsonl` for a given feature.

**Direction**: renderer → main (invoke)

**Payload**:

```typescript
{
  featureDir: string
}
```

**Response**:

```typescript
{ entries: HistoryEntry[] } | { error: string }
```

---

## `speckit:implement-file-decision`

Approve or skip a pending file write during an Implement run.

**Direction**: renderer → main (invoke)

**Payload**:

```typescript
{
  featureDir: string
  filePath: string
  decision: 'approve' | 'skip'   // skip = git checkout -- <file>
  note?: string
}
```

**Response**:

```typescript
{ ok: true } | { error: string }
```

---

## `speckit:implement-stop`

Stop an active Implement run. Files already approved remain on disk.

**Direction**: renderer → main (invoke)

**Payload**:

```typescript
{
  featureDir: string
}
```

**Response**:

```typescript
{ ok: true } | { error: string }
```

---

## `speckit:checkpoint-create`

Create a git checkpoint commit before an Implement run.

**Direction**: renderer → main (invoke)

**Payload**:

```typescript
{
  featureDir: string
  repoRoot: string
}
```

**Response**:

```typescript
{ commitHash: string } | { error: string }
```

---

## Push Events (main → renderer)

These events are pushed from the extension's main-process IPC handler to the renderer via `BrowserWindow.webContents.send()`.

### `speckit:state-changed`

Emitted when phase state changes due to a file system event (artifact created/modified by Claude Code).

**Payload**:

```typescript
{
  state: PilotState
}
```

### `speckit:implement-file-proposal`

Emitted when the file watcher detects a new or modified file during an active Implement run, triggering the per-file gate.

**Payload**:

```typescript
{
  filePath: string // relative to repo root
  isNew: boolean
  diffContent: string // unified diff against git HEAD
  linesAdded: number
  linesRemoved: number
}
```
