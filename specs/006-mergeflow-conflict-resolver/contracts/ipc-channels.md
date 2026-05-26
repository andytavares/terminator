# Contract: MergeFlow IPC Channels

**Version**: 1.0.0  
**Date**: 2026-05-25  
**Branch**: `006-mergeflow-conflict-resolver`  
**Extension**: `git-integration`

All channels are registered in `extensions/git-integration/src/ipc/merge-flow.ipc.ts` and invoked from the renderer via `extensions/git-integration/src/api/merge-flow.ts`.

All payloads are validated with Zod schemas (`merge-flow.schema.ts`). Error convention: `{ error: string }` for runtime failures, `{ error: 'VALIDATION_ERROR' }` for schema failures.

---

## `git:conflicts-list`

Detect all conflicted files in a repository and build the initial ConflictSession.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  repoRoot: string // Absolute path to git repo
}
```

**Response**:

```typescript
ConflictSession | { error: string }
```

**Implementation notes**:

- Runs `git diff --name-only --diff-filter=U` to get conflicted file paths
- For each file, runs `git log --format="%an|%H|%ai" -1 HEAD -- <file>` and same for MERGE_HEAD to get author info
- Detects merge vs. rebase context via `git rev-parse -q --verify REBASE_HEAD`
- Reads per-file conflict blocks (see `git:conflict-blocks`)
- Orders files by `conflictCount` descending

---

## `git:conflict-blocks`

Read all conflict blocks for a single file from the git index.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  repoRoot: string
  filePath: string // Relative path from repo root
}
```

**Response**:

```typescript
{ blocks: ConflictBlock[] } | { error: string }
```

**Implementation notes**:

- Reads base (`:1:<file>`), ours (`:2:<file>`), theirs (`:3:<file>`) via `git show :<stage>:<file>`
- Reads the working-tree file to extract context lines around each `<<<<<<< / ======= / >>>>>>>` block (3–4 lines before/after)
- Each block gets a stable `blockId` of form `<filePath>#<index>`

---

## `git:resolve-conflict`

Record a resolution decision for a single conflict block. Writes the resolved content to the working-tree file.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  repoRoot: string
  blockId: string // e.g., "src/auth/userService.ts#1"
  resolvedText: string // Final content for this block (no conflict markers)
  strategy: 'ours' | 'theirs' | 'both-ours-first' | 'both-theirs-first' | 'manual' | 'ai'
}
```

**Response**:

```typescript
{ success: true } | { error: string }
```

**Implementation notes**:

- Reads the current working-tree file content
- Replaces the conflict markers for the identified block with `resolvedText`
- Does NOT run `git add` — staging happens only at commit time (FR-037)

---

## `git:undo-resolve`

Undo the most recent resolution decision. Restores the conflict markers for that block.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  repoRoot: string
  blockId: string // The block whose resolution to undo
  originalConflictText: string // The full <<<<<< / ======= / >>>>>> block text to restore
}
```

**Response**:

```typescript
{ success: true } | { error: string }
```

**Implementation notes**:

- Writes `originalConflictText` back into the file at the correct position
- The renderer store owns the undo stack and calls this channel with the stored original text

---

## `git:merge-commit`

Stage all resolved files and execute the merge commit.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  repoRoot: string
  resolvedFilePaths: string[]  // Relative paths of all files that were resolved
  commitMessage: string
}
```

**Response**:

```typescript
{ commitHash: string } | { error: string }
```

**Implementation notes**:

- Runs `git add -- <resolvedFilePaths>` to stage the resolved files
- Runs `git commit -m <commitMessage>` (reuses existing `commitChanges()` from git-service.ts)
- Does NOT run `--no-edit` or modify git's auto-generated merge commit message — uses the user-provided message

---

## `git:merge-ai-suggest`

Request an AI resolution suggestion for a conflict block.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  repoRoot: string
  blockId: string
  baseText: string
  oursText: string
  theirsText: string
  contextBefore: string[]
  contextAfter: string[]
}
```

**Response**:

```typescript
;AISuggestion | { error: 'NOT_IMPLEMENTED' } | { error: string }
```

**Implementation notes**:

- Returns `{ error: 'NOT_IMPLEMENTED' }` in this feature scope (Phase 3 work)
- Channel stub is defined now to lock the contract; implementation deferred

---

## `git:session-restore`

Check whether a persisted merge session exists for the given repo root and restore it if so.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  repoRoot: string
}
```

**Response**:

```typescript
{ session: ConflictSession } | { session: null }
```

**Implementation notes**:

- Reads from `electron-store` under key `mergeflow:session:<repoRoot>`
- If found, validates that the git index still shows conflicts (repo hasn't been externally modified)
- Returns `null` if no persisted session or if conflicts no longer exist

---

## `git:session-persist`

Persist the current session state to disk.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  repoRoot: string
  session: ConflictSession
}
```

**Response**:

```typescript
{ success: true } | { error: string }
```

---

## `git:session-clear`

Delete the persisted session (called after successful commit or user abort).

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  repoRoot: string
}
```

**Response**:

```typescript
{
  success: true
}
```
