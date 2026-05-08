# Data Model: Git & GitHub Integration Extension

**Branch**: `002-git-github-integration` | **Date**: 2026-05-07

All types are implemented as Zod schemas in `src/shared/schemas/git.schema.ts` and `src/shared/schemas/shell.schema.ts`, then inferred as TypeScript types. Zod validation runs at the main-process IPC boundary before data is passed to the renderer.

---

## Core Git Types

### `GitFileStatus`

Represents the status of a single file in the working directory.

```typescript
interface GitFileStatus {
  path: string              // Relative path from repo root
  oldPath?: string          // Previous path for renamed/copied files
  indexStatus: FileStatus   // Staged (index) status
  workingStatus: FileStatus // Working tree (unstaged) status
  isBinary: boolean         // True if file cannot be diffed as text
}

type FileStatus =
  | 'unmodified'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflict'
  | 'ignored'
```

**State transitions**:
- `untracked` → `added` (after `git add`)
- `modified` → `unmodified` (after `git add` + `git commit`)
- `conflict` → blocks staging until resolved

### `GitStatus`

The full status of a working directory, returned by `git:status`.

```typescript
interface GitStatus {
  repoRoot: string           // Absolute path to the .git directory root
  branch: string             // Current branch name (or 'HEAD' if detached)
  files: GitFileStatus[]     // All changed files (up to maxDisplayedFiles)
  truncated: boolean         // True if file count exceeded git.maxDisplayedFiles
  totalCount: number         // Actual total count before truncation
  hasConflicts: boolean      // True if any file has indexStatus or workingStatus === 'conflict'
}
```

### `FileDiff`

The parsed diff for a single file. Returned by `git:diff-file`.

```typescript
interface FileDiff {
  path: string           // Current file path
  oldPath?: string       // Previous path (renames only)
  isBinary: boolean      // True if binary diff — hunks will be empty
  truncated: boolean     // True if diff exceeded size limit (500KB)
  hunks: DiffHunk[]
}

interface DiffHunk {
  header: string         // Raw @@ header line (e.g., "@@ -1,4 +1,6 @@ function foo")
  oldStart: number       // Starting line in old file
  oldCount: number       // Number of lines from old file
  newStart: number       // Starting line in new file
  newCount: number       // Number of lines from new file
  lines: DiffLine[]
}

interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string        // Line content (without leading +/-/ prefix)
  oldLineNumber?: number // Present for 'remove' and 'context' lines
  newLineNumber?: number // Present for 'add' and 'context' lines
}
```

### `CommitPayload`

Input to a `git commit` operation.

```typescript
interface CommitPayload {
  repoRoot: string       // Absolute path to repo root
  message: string        // Commit message (must be non-empty)
  signOff: boolean       // Append Signed-off-by trailer if true
}
```

**Validation rules**:
- `message` must be non-empty after trimming
- At least one file must be staged (enforced at UI layer before calling IPC)

---

## GitHub Types

### `PullRequest`

Represents a GitHub PR record, as returned by `gh pr view` or created by `gh pr create`.

```typescript
interface PullRequest {
  number: number
  title: string
  body: string
  url: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  baseBranch: string
  headBranch: string
}
```

### `PrCreatePayload`

Input for creating a pull request.

```typescript
interface PrCreatePayload {
  repoRoot: string
  title: string
  body: string
  baseBranch: string     // Target branch (e.g., 'main')
  isDraft: boolean       // True to create as draft PR
}
```

---

## Shell Execution Types

### `ShellExecOptions`

Options for the sandboxed shell execution bridge.

```typescript
interface ShellExecOptions {
  command: 'git' | 'gh'  // Allowlisted commands only
  args: string[]
  cwd: string            // Must be within the current project root (validated server-side)
  timeoutMs?: number     // Default: 10000 (10s)
}
```

**Validation rules**:
- `command` must be `'git'` or `'gh'` (enforced by Zod enum in `shell.schema.ts`)
- `cwd` must be a subdirectory of or equal to the current workspace's `folderPath` (enforced in `shell.ipc.ts`)
- `args` must not contain `null` bytes or path traversal sequences (`../` beyond repo root)

### `ShellResult`

The result of a sandboxed shell execution.

```typescript
interface ShellResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}
```

---

## File System Watch Types

### `FsChangeEvent`

An event emitted by the `fs:changed` push channel when files in the project directory change.

```typescript
interface FsChangeEvent {
  projectRoot: string       // Absolute path being watched
  eventType: 'change' | 'rename'  // From Node.js fs.watch
  filename: string | null   // Relative path of changed file (null on some platforms)
}
```

---

## Extension Settings Schema

The git integration extension declares its settings via `api.settings.register()`. Below is the canonical settings schema.

```typescript
// Registered under extension ID: 'terminator.git-integration'
const gitSettingsSchema: ExtensionSettingsSchema = {
  label: 'Git Integration',
  properties: {
    'git.enabled': {
      type: 'boolean',
      label: 'Enable Git Integration',
      description: 'Show git sidebar and git view for git repositories',
      default: true,
      workspaceScoped: true,
    },
    'git.sidebar.defaultOpen': {
      type: 'boolean',
      label: 'Open sidebar by default',
      description: 'Automatically show the git changes sidebar when opening a git repository',
      default: false,
      workspaceScoped: true,
    },
    'git.sidebar.refreshIntervalMs': {
      type: 'number',
      label: 'Polling fallback interval (ms)',
      description: 'How often to poll git status when filesystem watch events are unavailable',
      default: 3000,
      min: 500,
      max: 60000,
      workspaceScoped: false,
    },
    'git.ghCliPath': {
      type: 'string',
      label: 'gh CLI path',
      description: 'Absolute path to the gh binary. Leave empty to use system PATH.',
      default: '',
      workspaceScoped: false,
    },
    'git.commit.signOff': {
      type: 'boolean',
      label: 'Sign-off commits',
      description: 'Append a Signed-off-by trailer to all commits',
      default: false,
      workspaceScoped: false,
    },
    'git.maxDisplayedFiles': {
      type: 'number',
      label: 'Maximum displayed files',
      description: 'Maximum number of changed files to display in the sidebar and git view',
      default: 500,
      min: 10,
      max: 5000,
      workspaceScoped: false,
    },
  },
}
```

**Note**: The `workspaceScoped` field is a new addition to `SettingDefinition` (see `contracts/extension-api-additions.md`). Workspace-scoped settings take precedence over global settings when `api.settings.get()` is called in a workspace context.

---

## Entity Relationships

```text
Workspace
  └── has many Projects
        └── has a folderPath (repoRoot if git)
              └── GitStatus
                    └── has many GitFileStatus
                          └── can fetch FileDiff (on demand)
                                └── has many DiffHunk
                                      └── has many DiffLine

PullRequest     (fetched via gh CLI for current branch)
CommitPayload   (built by user in StagingArea → sent via git:commit)
ShellExecOptions → ShellResult   (IPC bridge: shell:exec)
FsChangeEvent   (pushed by main process → triggers GitStatus refresh)
```
