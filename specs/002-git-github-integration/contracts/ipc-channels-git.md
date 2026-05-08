# Contract: New IPC Channels — Git & GitHub Integration

**Version**: 1.0.0
**Date**: 2026-05-07
**Branch**: `002-git-github-integration`

This document defines the **new** IPC channels added for the git integration feature. Existing channels are documented in `specs/001-extension-first-terminal/contracts/ipc-channels.md`.

All payloads validated with Zod schemas at both ends. Error convention follows the existing pattern: `{ error: string }` for failures, `{ error: 'VALIDATION_ERROR', message: string }` for schema failures.

---

## Git Status & Diff Channels

### `git:status`

Returns the full git status for a directory, parsed from `git status --porcelain=v1 -z`.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{ path: string }  // Absolute path (project working directory)
```

**Response**:
```typescript
GitStatus | { error: string }
```

Where `GitStatus` is:
```typescript
{
  repoRoot: string
  branch: string
  files: GitFileStatus[]
  truncated: boolean
  totalCount: number
  hasConflicts: boolean
}
```

---

### `git:diff-file`

Returns the parsed unified diff for a single file.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{
  repoRoot: string
  path: string     // Relative path from repo root
  staged: boolean  // true → git diff --cached; false → git diff
}
```

**Response**:
```typescript
FileDiff | { error: string }
```

Where `FileDiff` is:
```typescript
{
  path: string
  oldPath?: string
  isBinary: boolean
  truncated: boolean
  hunks: DiffHunk[]
}
```

---

## Git Staging & Commit Channels

### `git:stage`

Stages one or more files (`git add`).

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{
  repoRoot: string
  paths: string[]   // Relative paths from repo root
}
```

**Response**:
```typescript
{ success: true } | { error: string }
```

---

### `git:unstage`

Unstages one or more files (`git restore --staged`).

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{
  repoRoot: string
  paths: string[]
}
```

**Response**:
```typescript
{ success: true } | { error: string }
```

---

### `git:commit`

Creates a commit from currently staged files.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{
  repoRoot: string
  message: string    // Non-empty; validated server-side
  signOff: boolean
}
```

**Response**:
```typescript
{ commitHash: string } | { error: string }
```

**Error codes**:
- `'NOTHING_TO_COMMIT'` — no staged files
- `'EMPTY_MESSAGE'` — message is empty after trimming
- `'GIT_ERROR'` — git process exited non-zero (stderr included in error string)

---

## GitHub / PR Channels

### `git:pr-status`

Checks whether a pull request exists for the current branch via `gh pr view`.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{ repoRoot: string }
```

**Response**:
```typescript
{ pr: PullRequest } | { pr: null } | { error: string }
```

Where `{ pr: null }` means no PR found (not an error). `{ error: string }` means gh CLI is unavailable or returned an unexpected error.

**Error codes**:
- `'GH_NOT_FOUND'` — gh CLI binary not found on PATH or at `git.ghCliPath`
- `'GH_NOT_AUTHENTICATED'` — `gh auth status` returned non-zero
- `'GH_ERROR'` — unexpected gh error (stderr included)

---

### `git:pr-create`

Creates a pull request via `gh pr create`.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{
  repoRoot: string
  title: string
  body: string
  baseBranch: string
  isDraft: boolean
}
```

**Response**:
```typescript
{ pr: PullRequest } | { error: string }
```

**Error codes** (same as `git:pr-status` plus):
- `'PR_ALREADY_EXISTS'` — a PR for this branch already exists
- `'NO_REMOTE'` — current branch has no upstream remote configured
- `'DEFAULT_BRANCH_WARNING'` — head branch is the repository default branch (non-fatal warning attached to `pr` response as `warning: string`)

---

## Shell Execution Channel

### `shell:exec`

Sandboxed shell command execution for extension use via the `api.shell.exec()` bridge.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
ShellExecOptions
// {
//   command: 'git' | 'gh'
//   args: string[]
//   cwd: string
//   timeoutMs?: number
// }
```

**Response**:
```typescript
ShellResult | { error: 'COMMAND_NOT_ALLOWED' | 'CWD_OUT_OF_SCOPE' | 'VALIDATION_ERROR', message?: string }
```

---

## File System Watch Channels

### `fs:watch-start`

Registers a file system watch on a project root. Idempotent — calling again for the same path is a no-op.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{ projectRoot: string }
```

**Response**:
```typescript
{ success: true } | { error: string }
```

---

### `fs:watch-stop`

Unregisters the file system watch for a project root.

**Direction**: renderer → main (invoke/handle)

**Request**:
```typescript
{ projectRoot: string }
```

**Response**:
```typescript
{ success: true }
```

---

### `fs:changed`

Push event from the main process to the renderer when a file change is detected in a watched project root. Triggered by `fs.watch` events or polling (when fallback is active).

**Direction**: main → renderer (push via `webContents.send`)

**Payload**:
```typescript
FsChangeEvent
// {
//   projectRoot: string
//   eventType: 'change' | 'rename'
//   filename: string | null
// }
```

---

## `electron.d.ts` Additions

The following entries must be added to `src/renderer/electron.d.ts` alongside the existing channel declarations:

```typescript
interface ElectronAPI {
  // ... existing ...

  git: {
    // ... existing (is-repo, current-branch, list-branches, checkout, worktree channels) ...
    status(req: { path: string }): Promise<GitStatus | { error: string }>
    diffFile(req: { repoRoot: string; path: string; staged: boolean }): Promise<FileDiff | { error: string }>
    stage(req: { repoRoot: string; paths: string[] }): Promise<{ success: true } | { error: string }>
    unstage(req: { repoRoot: string; paths: string[] }): Promise<{ success: true } | { error: string }>
    commit(req: { repoRoot: string; message: string; signOff: boolean }): Promise<{ commitHash: string } | { error: string }>
    prStatus(req: { repoRoot: string }): Promise<{ pr: PullRequest | null } | { error: string }>
    prCreate(req: PrCreatePayload): Promise<{ pr: PullRequest } | { error: string }>
  }

  shell: {
    exec(options: ShellExecOptions): Promise<ShellResult | { error: string }>
  }

  fs: {
    watchStart(req: { projectRoot: string }): Promise<{ success: true } | { error: string }>
    watchStop(req: { projectRoot: string }): Promise<{ success: true }>
    onChanged(handler: (event: FsChangeEvent) => void): () => void  // returns unsubscribe fn
  }
}
```
