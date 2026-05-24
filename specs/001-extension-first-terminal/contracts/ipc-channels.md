# Contract: Electron IPC Channels

**Version**: 1.0.0  
**Date**: 2026-05-05  
**Branch**: `001-extension-first-terminal`

All IPC communication between the Electron renderer process and main process flows through the channels defined here. Every payload is validated with Zod schemas at both ends before use.

Channels are invoked via `window.electronAPI.<domain>.<method>(...)` in the renderer, exposed through `contextBridge` in the preload script.

---

## Terminal Channels

### `terminal:create`

Opens a new PTY session in the main process.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  projectId: string;     // UUID of the parent project
  type: 'human' | 'agent';
  tabTitle: string;
  scrollbackLimit: number;
  cwd: string;           // Working directory (workspace folder path)
  shell?: string;        // Optional shell override; defaults to user's login shell
}
```

**Response**:

```typescript
{
  sessionId: string // UUID assigned to this session
}
```

---

### `terminal:close`

Terminates a PTY session and frees all resources.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  sessionId: string
}
```

**Response**:

```typescript
{
  success: boolean
}
```

---

### `terminal:input`

Sends keyboard input from the user (or agent) to the PTY.

**Direction**: renderer → main (send, fire-and-forget)

**Payload**:

```typescript
{
  sessionId: string
  data: string
}
```

---

### `terminal:output`

Streams PTY output from the main process to the renderer.

**Direction**: main → renderer (push via `webContents.send`)

**Payload**:

```typescript
{
  sessionId: string
  data: string
}
```

---

### `terminal:resize`

Notifies the main process of a terminal size change (triggered by xterm-addon-fit).

**Direction**: renderer → main (send, fire-and-forget)

**Payload**:

```typescript
{
  sessionId: string
  cols: number
  rows: number
}
```

---

### `terminal:close-all`

Terminates all active PTY sessions. Called by the main process `before-quit` handler before app exit.

**Direction**: main-internal (triggered by app lifecycle event); also invokable by renderer for explicit "close all" actions

**Request**: `{}` (no payload)

**Response**:

```typescript
{
  terminatedCount: number
}
```

---

### `terminal:cleanup-orphans`

Triggered on startup to clean up any sessions orphaned from a previous unclean shutdown.

**Direction**: renderer → main (invoke/handle)

**Request**: `{}` (no payload)

**Response**:

```typescript
{
  cleanedCount: number
}
```

---

## Workspace Channels

### `workspace:list`

Returns all persisted workspaces.

**Direction**: renderer → main (invoke/handle)

**Response**:

```typescript
{ workspaces: Workspace[] }
```

---

### `workspace:create`

Creates a new workspace. Enforces name uniqueness.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  name: string;
  folderPath: string;
  color: string;
  tags: string[];
}
```

**Response**:

```typescript
{ workspace: Workspace } | { error: 'DUPLICATE_NAME' | 'INVALID_PATH' }
```

---

### `workspace:update`

Updates an existing workspace.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  id: string;
  name?: string;
  folderPath?: string;
  color?: string;
  tags?: string[];
}
```

**Response**:

```typescript
{ workspace: Workspace } | { error: 'DUPLICATE_NAME' | 'NOT_FOUND' | 'INVALID_PATH' }
```

---

### `workspace:delete`

Removes a workspace and all its projects.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  id: string
}
```

**Response**:

```typescript
{
  success: boolean
}
```

---

### `project:list`

Returns all projects for a given workspace.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  workspaceId: string
}
```

**Response**:

```typescript
{ projects: Project[] }
```

---

### `project:create`

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  workspaceId: string
  name: string
}
```

**Response**:

```typescript
{ project: Project } | { error: 'DUPLICATE_NAME' | 'WORKSPACE_NOT_FOUND' }
```

---

### `project:delete`

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  id: string
}
```

**Response**:

```typescript
{
  success: boolean
}
```

---

## Settings Channels

### `settings:get-global`

**Direction**: renderer → main (invoke/handle)

**Response**:

```typescript
{
  settings: GlobalSettings
}
```

---

### `settings:update-global`

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  patch: DeepPartial<GlobalSettings>
}
```

**Response**:

```typescript
{
  settings: GlobalSettings
}
```

---

### `settings:get-workspace`

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  workspaceId: string
}
```

**Response**:

```typescript
{
  settings: WorkspaceSettings
}
```

---

### `settings:update-workspace`

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  workspaceId: string
  patch: DeepPartial<Omit<GlobalSettings, 'extensions'>>
}
```

**Response**:

```typescript
{
  settings: WorkspaceSettings
}
```

---

## Dialog Channels

### `dialog:open-directory`

Opens a native OS folder-picker dialog from the main process and returns the selected path. Required because the renderer cannot call `dialog.showOpenDialog()` directly when `contextIsolation: true`.

**Direction**: renderer → main (invoke/handle)

**Request**: `{}` (no payload)

**Response**:

```typescript
{ filePath: string } | { cancelled: true }
```

---

## Extension Channels

### `extension:list`

**Direction**: renderer → main (invoke/handle)

**Response**:

```typescript
{ extensions: Extension[] }
```

---

### `extension:install`

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  directoryPath: string
}
```

**Response**:

```typescript
{ extension: Extension } | { error: 'INVALID_MANIFEST' | 'DUPLICATE_ID' | 'VERSION_INCOMPATIBLE' }
```

---

### `extension:toggle`

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  id: string
  enabled: boolean
}
```

**Response**:

```typescript
{
  extension: Extension
}
```

---

### `extension:uninstall`

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  id: string
}
```

**Response**:

```typescript
{ ok: true } | { error: 'NOT_FOUND' }
```

---

### `extension:reload`

**Direction**: renderer → main (invoke/handle)

Unloads the extension, clears the Node module cache for its entry point, and re-activates it from the stored directory path. Useful during development to pick up code changes without reinstalling.

**Request**:

```typescript
{
  id: string
}
```

**Response**:

```typescript
{ extension: Extension } | { error: string }
```

---

### `extension:get-settings-schemas`

**Direction**: renderer → main (invoke/handle)

Returns the settings schemas registered by all active extensions.

**Response**:

```typescript
{
  schemas: Array<{
    extensionId: string
    label: string
    properties: Record<
      string,
      {
        type: 'string' | 'number' | 'boolean' | 'enum'
        label: string
        description?: string
        default: unknown
        secret?: boolean
        options?: string[]
        min?: number
        max?: number
      }
    >
  }>
}
```

---

### `extension:get-settings-values`

**Direction**: renderer → main (invoke/handle)

Returns all stored extension setting values from the persistent `extension-settings` electron-store.

**Response**:

```typescript
{
  values: Record<string, unknown>
}
```

---

### `extension:update-setting`

**Direction**: renderer → main (invoke/handle)

Persists a single extension setting value.

**Request**:

```typescript
{
  key: string
  value: unknown
}
```

**Response**:

```typescript
{
  ok: true
}
```

---

## Git Channels

### `git:is-repo`

Checks whether a directory is inside a git repository.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ path: string }`

**Response**: `{ isRepo: boolean; root?: string }`

---

### `git:current-branch`

Returns the currently checked-out branch name for the given path.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ path: string }`

**Response**: `{ branch: string } | { error: string }`

---

### `git:list-branches`

Lists all local (and remote) branches for a git repo.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ path: string }`

**Response**: `{ branches: Branch[] }` where `Branch = { name, isCurrent, isRemote }`

---

### `git:checkout`

Checks out an existing branch.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ path: string; branch: string }`

**Response**: `{ success: true } | { error: string }`

---

### `git:suggest-worktree-path`

Suggests a filesystem path for a new worktree based on repo root and branch name.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ repoRoot: string; branch: string }`

**Response**: `{ path: string }`

---

### `git:create-worktree`

Creates a new git worktree (optionally on a new branch).

**Direction**: renderer → main (invoke/handle)

**Request**: `{ repoRoot: string; worktreePath: string; branch: string; isNewBranch: boolean }`

**Response**: `{ success: true } | { error: string }`

---

### `git:remove-worktree`

Removes a git worktree.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ repoRoot: string; worktreePath: string }`

**Response**: `{ success: true } | { error: string }`

---

### `git:list-worktrees`

Lists all worktrees for a git repository.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ path: string }`

**Response**: `{ worktrees: WorktreeInfo[] }` where `WorktreeInfo = { path, branch, isMain, head }`

---

### `project:update-branch`

Updates the tracked git branch for a project.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ id: string; gitBranch: string }`

**Response**: `{ project: Project } | { error: 'NOT_FOUND' | 'VALIDATION_ERROR' }`

---

## Logging Channel

### `log:write`

Ships a renderer-side log entry to the main process for persistence in the log file.

**Direction**: renderer → main (send, fire-and-forget via `ipcRenderer.send`)

**Payload**:

```typescript
{
  level: 'debug' | 'info' | 'warn' | 'error'
  namespace: string // e.g. 'renderer', 'error-boundary', or an extension id
  message: string
}
```

No response. Entries are appended to the platform log file (`~/Library/Logs/<app>/terminator.log` on macOS) by the main-process logger.

---

## Error Handling Convention

All invoke/handle channels return a discriminated union of success and error shapes. The renderer MUST check for the `error` field before using response data. Zod validates all incoming payloads; malformed payloads return `{ error: 'VALIDATION_ERROR', message: string }`.

---

## Extension-contributed channels (git-integration)

These channels are registered by the git-integration extension at runtime.

### `shell:open-path`

Opens a file or directory in the OS default application.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ filePath: string }`

**Response**: `{ ok: true } | { error: string }`

---

### `window:open-pr-review`

Creates a new focused BrowserWindow pre-loaded with the Code Reviews view for the given repo. When `prNumber` is supplied the window auto-navigates to that PR on mount, skipping the queue screen.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ repoRoot: string; accentColor?: string; prNumber?: string; showOverview?: string }`

- `prNumber` — optional stringified PR number; when present the popout restores directly to that PR
- `showOverview` — `"true"` | `"false"` (default `"false"`); whether to land on the overview panel vs. the diff view

**Response**: `void`

---

### `github:list-open-prs`

Lists pull requests for the active repo with cursor-based pagination, optional text/number search, and open/closed state filter.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ repoRoot: string; cursor?: string; search?: string; includeClosedPrs?: boolean }`

**Response**: `{ prs: ReviewQueuePR[]; hasMore: boolean; nextCursor?: string } | { error: string } | { error: 'RATE_LIMITED'; resetAt: number }`

---

### `github:sessions-for-repo`

Returns all persisted review sessions for a given repo root, used to restore `sessionStatus` on queue PRs after loading.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ repoRoot: string }`

**Response**: `{ sessions: ReviewSession[] }`

---

### `github:file-metrics`

Returns churn, blast radius (actual code importers only — not prose), test file presence, and patch coverage for a changed file.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ repoRoot: string; path: string }`

**Response**: `{ churn90d: number; blastRadius: number; topImporters: string[]; importerCount: number; testFilePresent: boolean; patchCoverage: number | null } | { error: string }`

---

### `github:active-reviews-for-repo`

Returns all PRs that the user has opened a review session for in the given repo (stored in `pr-active-reviews` electron-store). Used to surface orphan in-progress PRs that are no longer in the paginated queue.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ repoRoot: string }`

**Response**: `{ prs: ReviewQueuePR[] } | { error: string }`

---

### `github:remove-active-review`

Removes a single PR from the `pr-active-reviews` store, effectively dismissing it from the in-progress section.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ repoRoot: string; prNumber: number }`

**Response**: `{ ok: true } | { error: string }`

---

### `github:prune-active-reviews`

Batch-checks the current GitHub state of the given PR numbers via `gh pr view --json state`. PRs confirmed closed or merged are deleted from `pr-active-reviews` automatically. Returns only the numbers that are still OPEN.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ repoRoot: string; prNumbers: number[] }`

**Response**: `{ openNumbers: number[] } | { error: string }`

Used on queue load to prevent closed/merged PRs from appearing as in-progress orphans.

---

### Menu IPC (main → renderer, one-way)

These channels are sent from the main process menu to the renderer via `webContents.send`.

| Channel                      | Payload | Effect                                           |
| ---------------------------- | ------- | ------------------------------------------------ |
| `menu:open-settings`         | none    | Opens the Settings panel                         |
| `menu:toggle-sidebar`        | none    | Toggles the Projects Panel sidebar               |
| `menu:open-pr-review-window` | none    | Triggers `window:open-pr-review` for active repo |

---

### `git:push`

Pushes the current branch to its configured remote. Runs `git push` with no arguments; requires an upstream to be set.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ repoRoot: string }`

**Response**: `{ success: true } | { error: 'NO_UPSTREAM' | 'REJECTED' | string }`

- `NO_UPSTREAM` — branch has no upstream configured; user must run `git push -u origin <branch>` manually.
- `REJECTED` — remote rejected the push (e.g. non-fast-forward); user must pull first.

---

## SpecKit Pilot Extension Channels (`speckit:*`)

All channels below are registered by the `speckit-pilot` extension via `api.ipc.registerHandler` and accessed
through the generic `extensionBridge.invoke()` in the renderer (the core app has no knowledge of these channels).

| Channel                 | Direction       | Summary                                                                                 |
| ----------------------- | --------------- | --------------------------------------------------------------------------------------- |
| `speckit:feature-list`  | renderer → main | Scan `specs/` for feature dirs containing `spec.md`; return `Feature[]`                 |
| `speckit:pilot-state`   | renderer → main | Load `.pilot/state.json` for a feature dir; returns `{ state }` or `{ notFound: true }` |
| `speckit:phase-approve` | renderer → main | Mark a phase approved in `.pilot/state.json`; broadcast state-changed                   |
| `speckit:phase-revoke`  | renderer → main | Revoke approval; reset phase to `ready`                                                 |
| `speckit:file-write`    | renderer → main | Write arbitrary file content (for markdown editor saves)                                |

### Push Events (main → renderer)

| Event                   | Payload                 | Trigger                            |
| ----------------------- | ----------------------- | ---------------------------------- |
| `speckit:state-changed` | `{ state: PilotState }` | Phase approve/revoke updates state |

---

## Task Vault Extension Channels (`task-vault:*`)

All channels below are registered by the `task-vault` extension and accessed through `extensionBridge.invoke()`.

### Vault Channels

| Channel                                  | Direction       | Summary                                                                |
| ---------------------------------------- | --------------- | ---------------------------------------------------------------------- |
| `task-vault:vault:capture`               | renderer → main | Append task to inbox.md                                                |
| `task-vault:vault:get-today`             | renderer → main | Return today's daily log (auto-create if absent)                       |
| `task-vault:vault:get-daily`             | renderer → main | Return daily log for a given date                                      |
| `task-vault:vault:add-task`              | renderer → main | Append task to a target file                                           |
| `task-vault:vault:complete-task`         | renderer → main | Mark task `[x]` by file+line ID; returns `STALE_ID` if line changed    |
| `task-vault:vault:migrate-task`          | renderer → main | Migrate task `[>]` to target date file; returns `STALE_ID` if stale    |
| `task-vault:vault:query`                 | renderer → main | Filter tasks by status, context, project, area, dueBefore, filePattern |
| `task-vault:vault:process-inbox-item`    | renderer → main | Process inbox item: trash / do-now / someday / file                    |
| `task-vault:vault:update-project-status` | renderer → main | Rewrite project frontmatter `status:` field                            |
| `task-vault:vault:get-task-detail`       | renderer → main | Return description, acceptanceCriteria, devHints from task metadata    |
| `task-vault:vault:save-task-detail`      | renderer → main | Write description, acceptanceCriteria, devHints into task metadata     |

### Project Channels

| Channel                             | Direction       | Summary                                                         |
| ----------------------------------- | --------------- | --------------------------------------------------------------- |
| `task-vault:projects:list`          | renderer → main | List projects filtered by status                                |
| `task-vault:projects:weekly-review` | renderer → main | Return full weekly review payload (inbox, projects, completed…) |

### Link Channels

| Channel                                      | Direction       | Summary                                         |
| -------------------------------------------- | --------------- | ----------------------------------------------- |
| `task-vault:links:create`                    | renderer → main | Append `terminator:<uuid>` to vault file        |
| `task-vault:links:remove`                    | renderer → main | Remove `terminator:<uuid>` annotation from file |
| `task-vault:links:get-for-terminator-target` | renderer → main | Return tasks/projects linked to a terminal UUID |

### ICS Channels

| Channel                     | Direction       | Summary                                                       |
| --------------------------- | --------------- | ------------------------------------------------------------- |
| `task-vault:ics:get-events` | renderer → main | Return cached ICS events in ±7 day window with staleness flag |

### Kanban Channels

| Channel                         | Direction       | Summary                                                                      |
| ------------------------------- | --------------- | ---------------------------------------------------------------------------- |
| `task-vault:kanban:get-config`  | renderer → main | Return persisted `KanbanConfig` (lanes, swimlaneGrouping, viewMode)          |
| `task-vault:kanban:save-config` | renderer → main | Persist updated `KanbanConfig` to `.todo/kanban.json`                        |
| `task-vault:kanban:list-tasks`  | renderer → main | Return all non-archived tasks (excludes migrated/cancelled) for kanban board |
| `task-vault:kanban:move-task`   | renderer → main | Update a task's `status` in the DB (used on drag-and-drop between lanes)     |

---

## Metrics Channels

System and per-process resource metrics for the Overview screen. All three channels use invoke/handle (request–response).

### `metrics:system`

Returns current system-wide CPU, memory, and network metrics.

**Direction**: renderer → main (invoke/handle)

**Request**: _(none)_

**Response**:

```typescript
{ data: SystemMetrics } | { error: string }

interface SystemMetrics {
  cpuPercent: number        // 0–100, averaged across all cores
  memUsedBytes: number      // os.totalmem() - os.freemem()
  memTotalBytes: number     // os.totalmem()
  netInBytesPerSec: number  // inbound bytes/s across non-loopback interfaces
  netOutBytesPerSec: number // outbound bytes/s across non-loopback interfaces
}
```

CPU is computed by diffing `os.cpus()` samples taken every 1 s in a background sampler started at app boot. Network is computed from `netstat -ib` (macOS) or `/proc/net/dev` (Linux) between samples.

---

### `metrics:processes`

Returns CPU and memory usage for a specific set of PIDs.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{ pids: number[] }
```

**Response**:

```typescript
{ data: ProcessMetrics[] } | { error: string }

interface ProcessMetrics {
  pid: number
  cpuPercent: number  // from ps %cpu column
  rssBytes: number    // resident set size in bytes (ps rss column × 1024)
}
```

Uses a single `ps -p <pids> -o pid=,%cpu=,rss=` call (macOS) or `ps -p <pids> -o pid,%cpu,rss --no-headers` (Linux). Returns `[]` on failure.

---

### `metrics:pids`

Resolves terminal session IDs to their PTY process PIDs.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{ sessionIds: string[] }
```

**Response**:

```typescript
{ data: Array<{ sessionId: string; pid: number }> } | { error: string }
```

Calls `ptyManager.getPid(sessionId)` for each ID; sessions without a live PTY are omitted from the result.

---

### Channel Summary

| Channel             | Direction       | Summary                                           |
| ------------------- | --------------- | ------------------------------------------------- |
| `metrics:system`    | renderer → main | CPU%, memory used/total, network in/out bytes/sec |
| `metrics:processes` | renderer → main | Per-PID CPU% and RSS bytes from `ps`              |
| `metrics:pids`      | renderer → main | Resolve session UUIDs to live PTY PIDs            |
