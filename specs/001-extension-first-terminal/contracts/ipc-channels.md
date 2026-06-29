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
  projectId: string;     // UUID of the parent project, or SCRATCH_PROJECT_ID ('00000000-0000-0000-0000-000000000000') for unassigned scratch sessions
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

### `workspace:reorder`

Reorders workspaces in the sidebar by providing the desired ID order.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  ids: string[]
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

### `workspace:project-added`

Push event sent by the main process after a successful `project:create` call. The renderer's workspace store subscribes to keep the sidebar in sync without requiring a full reload.

**Direction**: main → renderer (push via `webContents.send`)

**Payload**:

```typescript
Project // full project object as returned by createProject
```

---

### `workspace:project-removed`

Push event sent by the main process after a successful `project:delete` call, and by extensions that delete projects via `api.workspace.deleteProject`. The renderer's workspace store removes the project from the sidebar immediately.

**Direction**: main → renderer (push via `webContents.send`)

**Payload**:

```typescript
{
  id: string
}
```

---

### `project:rename`

Renames a project. Returns an error if the project is not found or if another project in the same workspace already has that name.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  id: string
  name: string
}
```

**Response**:

```typescript
{ project: Project } | { error: 'NOT_FOUND' | 'DUPLICATE_NAME' | 'VALIDATION_ERROR' }
```

---

### `project:reorder`

Reorders projects within a workspace by providing the desired ID order.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  workspaceId: string
  ids: string[]
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
        type: 'string' | 'number' | 'boolean' | 'enum' | 'folder' | 'action'
        label: string
        description?: string
        default: unknown
        secret?: boolean
        options?: string[]
        min?: number
        max?: number
        channel?: string // 'action' type: bridge channel invoked on click
        confirmMessage?: string // 'action' type: confirmation prompt before invoking
        danger?: boolean // 'action' type: render as a destructive action
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

### `git:create-branch`

Creates a new branch at HEAD without switching to it.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ path: string; branch: string }`

**Response**: `{ success: true } | { error: 'VALIDATION_ERROR' | string }`

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

## Shell Channels

### `shell:open-path`

Opens a file or directory in the OS default application.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ filePath: string }`

**Response**: `{ ok: true } | { error: string }`

---

### `shell:open-external`

Opens a URL in the system default browser. The URL must be a valid absolute URL.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ url: string }`

**Response**: `{ ok: true } | { error: string }`

---

## File System Channels

### `fs:watch-start`

Starts watching a project root directory for file-system changes. All change events are pushed back to the renderer via the `fs:changed` push event.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ projectRoot: string }`

**Response**: `{ ok: true } | { error: 'VALIDATION_ERROR' }`

---

### `fs:watch-stop`

Stops all active file-system watchers.

**Direction**: renderer → main (invoke/handle)

**Request**: _(none)_

**Response**: `{ ok: true }`

---

### `fs:read-file`

Reads the full text content of a file at the given path.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ filePath: string }`

**Response**: `{ content: string } | { error: 'VALIDATION_ERROR' | 'FILE_NOT_FOUND' }`

---

### `fs:changed`

Pushed from main to the renderer window whenever a watched directory emits a change event.

**Direction**: main → renderer (webContents.send)

**Payload**: `FsChangeEvent` (as defined by `fsWatcherService`)

---

## Extension-contributed channels (git-integration)

These channels are registered by the git-integration extension at runtime.

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

### `github:file-cochange`

Returns co-change affinity data for a set of files by analysing git history over the past 90 days. Files that frequently appear in the same commits are considered "co-changing" and are grouped together as Signal 3 in the chapter-building algorithm. Language-agnostic — works for any repo (Go, Python, Ruby, Rust, Java, etc.).

**Direction**: renderer → main (invoke/handle)

**Request**: `{ repoRoot: string; files: string[] }`

**Response**: `{ affinity: Record<string, string[]> } | { error: string }`

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

| Channel                      | Payload           | Effect                                                                                            |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------- |
| `menu:open-settings`         | none              | Opens the Settings panel                                                                          |
| `menu:toggle-sidebar`        | none              | Toggles the Projects Panel sidebar                                                                |
| `menu:open-pr-review-window` | none              | Triggers `window:open-pr-review` for active repo                                                  |
| `menu:close-tab`             | none              | Closes the active terminal tab in the active project                                              |
| `menu:open-about`            | none              | Opens the About dialog                                                                            |
| `extension:toggle-panel`     | `panelId: string` | Toggles an extension panel (e.g. `git-changes`, `task-vault-links`). Sent by the View menu items. |

### `menu:set-panel-checked` (renderer → main, one-way)

Sent by the renderer (`window.electronAPI.menu.notifyPanelState(panelId, open)`) so the main-process View menu keeps its checkbox state in sync with the open/closed state of the Git Changes and Vault Links panels.

**Payload**: `{ panelId: string; open: boolean }`

### `app:get-info`

Returns runtime version information for the About dialog.

**Direction**: renderer → main (invoke/handle)

**Request**: none

**Response**:

```typescript
{
  appName: string // e.g. "Terminator"
  version: string // from package.json, e.g. "1.0.0"
  electronVersion: string
  nodeVersion: string
  chromeVersion: string
  platform: string // e.g. "darwin", "win32", "linux"
}
```

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

### Invoke Channels (renderer → main)

| Channel                           | Summary                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `speckit:feature-list`            | Scan `specs/` for feature dirs containing `spec.md`; return `Feature[]`                                     |
| `speckit:pilot-state`             | Load `.pilot/state.json` for a feature dir; returns `{ state }` or `{ notFound: true }`                     |
| `speckit:phase-approve`           | Mark a phase approved in `.pilot/state.json`; broadcast `speckit:state-changed`                             |
| `speckit:phase-revoke`            | Revoke approval; reset phase to `ready`; broadcast `speckit:state-changed`                                  |
| `speckit:phase-request-changes`   | Record feedback note, set status to `ready`, re-queue runner; broadcast `speckit:state-changed`             |
| `speckit:phase-comment`           | Append `comment` history entry (no re-run); broadcast `speckit:state-changed`                               |
| `speckit:phase-reject`            | Reject phase with reason                                                                                    |
| `speckit:phase-skip`              | Skip optional phase                                                                                         |
| `speckit:phase-unskip`            | Un-skip a previously skipped phase                                                                          |
| `speckit:file-write`              | Write arbitrary file content (for inline markdown editor saves)                                             |
| `speckit:artifact-read`           | Read current and approved artifact content from disk                                                        |
| `speckit:ticket-list`             | Fetch tickets from connected sources (Linear, Jira)                                                         |
| `speckit:dispatch`                | Create/resume a feature run for a ticket; returns `{ featureDir, queued }`                                  |
| `speckit:run-cancel`              | Cancel the active run for a feature dir                                                                     |
| `speckit:open-pr`                 | Open a GitHub PR for a completed feature; returns `{ prUrl }`                                               |
| `speckit:credentials-set`         | Store Linear or Jira API credentials in the main-process secrets store (credentials never sent to renderer) |
| `speckit:credentials-status`      | Returns `{ connected: boolean }` ONLY — credentials are never exposed to the renderer                       |
| `speckit:self-review-read`        | Read `.pilot/self-review.json`; returns `{ result: SelfReviewResult }` or `{ notFound: true }`              |
| `speckit:checkin-decision`        | Act on a batch check-in: `continue` (next batch), `pause`, or `split` (approve at boundary)                 |
| `speckit:history-load`            | Load `.pilot/history.json` for a feature dir                                                                |
| `speckit:check-artifacts`         | Check which artifact files exist on disk for a feature dir                                                  |
| `speckit:implement-stop`          | Stop the active phase runner subprocess                                                                     |
| `speckit:checkpoint-create`       | Create a git commit checkpoint before an implement run                                                      |
| `speckit:implement-file-decision` | Approve or skip a pending file write during implement phase                                                 |
| `speckit:session-list`            | List available Claude session IDs                                                                           |

### Push Events (main → renderer)

| Event                      | Payload                                                           | Trigger                                                  |
| -------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `speckit:state-changed`    | `{ state: PilotState }`                                           | Any phase state mutation                                 |
| `speckit:run-output`       | `{ featureDir: string; line: string; ts: string }`                | Subprocess stdout/stderr line                            |
| `speckit:dispatch-started` | `{ featureDir: string; branchName: string }`                      | After dispatch creates/resumes a feature run             |
| `speckit:checkin-ready`    | `{ featureDir: string; batchIndex: number; diffSummary: string }` | Agent runner exits implement phase with `batchIndex` set |

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

| Channel                        | Direction       | Summary                                             |
| ------------------------------ | --------------- | --------------------------------------------------- |
| `metrics:system`               | renderer → main | CPU%, memory used/total, network in/out bytes/sec   |
| `metrics:processes`            | renderer → main | Per-PID CPU% and RSS bytes from `ps`                |
| `metrics:pids`                 | renderer → main | Resolve session UUIDs to live PTY PIDs              |
| `notifications:create`         | renderer → main | Create a notification routed to system/center/toast |
| `notifications:list`           | renderer → main | List all in-memory notifications                    |
| `notifications:dismiss`        | renderer → main | Remove a notification by ID                         |
| `notifications:trigger-action` | renderer → main | Invoke a stored action callback by ID               |
| `notifications:push`           | main → renderer | Push a new notification to all windows              |

---

### `notifications:create`

Creates a notification and routes it to the requested targets. Defaults to all three targets (`['system', 'center', 'toast']`) when `targets` is omitted; the `'system'` target raises a native OS notification.

**Direction**: renderer → main (invoke/handle)

**Request**:

```typescript
{
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  targets?: Array<'system' | 'center' | 'toast'>
}
```

**Response**: `{ id: string } | { error: string }`

> `notification.show(title, body)` (legacy preload helper) now forwards to `notifications:create` with `type: 'info'` and `targets: ['system']`.

---

### `notifications:list`

Returns all current in-memory notification records (without callbacks).

**Direction**: renderer → main (invoke/handle)

**Response**: `SerializedNotification[]`

---

### `notifications:dismiss`

Removes a notification from the manager.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ id: string }`

**Response**: `{ ok: true } | { error: string }`

---

### `notifications:trigger-action`

Invokes the callback stored for a notification action.

**Direction**: renderer → main (invoke/handle)

**Request**: `{ notifId: string; actionId: string }`

**Response**: `{ ok: true } | { error: 'UNKNOWN_NOTIFICATION' | 'UNKNOWN_ACTION' | string }`

---

### `notifications:push`

Sent from main to all renderer windows when a new notification is created via `notificationManager.create()`.

**Direction**: main → renderer (webContents.send)

**Payload**: `SerializedNotification`

---

## Remote Control Channels

### `remote:status`

Sent from main to renderer when the remote control server state changes (start, stop, URL update, error).

**Direction**: main → renderer (webContents.send via `extensionBridge.on`)

**Payload**:

```typescript
{
  enabled?: boolean
  port?: number
  publicUrl?: string | null
  lanUrl?: string | null
  ngrokInstalled?: boolean
  error?: 'PORT_IN_USE' | string
  message?: string
}
```

---

### `log:push`

Pushes a log entry from the main process into the renderer's LogWindow.

**Direction**: main → renderer (webContents.send via `extensionBridge.on`)

**Payload**: `{ level: 'info' | 'warn' | 'error'; message: string }`

---

### `remote:tunnel-disconnected`

Pushed from main to renderer when the ngrok process exits unexpectedly (crash, not intentional stop).

**Direction**: main → renderer (webContents.send via `extensionBridge.on`)

**Payload**: none

---

### `remote:tunnel-reconnect`

Sent from renderer to main to trigger ngrok tunnel reconnection.

**Direction**: renderer → main (ipcMain.on / one-way)

**Payload**: none

---

### `remote:caddyfile`

Returns a Caddyfile snippet for a local HTTPS reverse-proxy in front of the remote control server. The returned config uses the machine's first non-loopback IPv4 address as the hostname (falls back to `localhost`).

**Direction**: renderer → main (invoke/handle via `extensionBridge.invoke`)

**Request**: `{ port: number }`

**Response**: `string` — a ready-to-paste Caddyfile block, e.g.:

```
192.168.1.100 {
  reverse_proxy localhost:7681
  tls internal
}
```

---

### `remote:update-password`

Requests a new password hash to be generated and saved; optionally rotates the plaintext password.

**Direction**: renderer → main (invoke/handle via `extensionBridge.invoke`)

**Request**: `{ password: string }` — pass empty string to auto-generate a new password

**Response**: `{ password: string } | { error: string }`

---

## Notepad Extension — Diagram Channels

All diagram channels are invoked via `window.electronAPI.extensionBridge.invoke(channel, payload)`.

### `terminator.notepad:diagrams.create`

Creates a new blank diagram.

**Request**: `{ title?: string }`

**Response**: `{ data: { id: string; title: string; createdAt: string } } | { error: string }`

---

### `terminator.notepad:diagrams.list`

Lists diagrams, optionally including archived ones.

**Request**: `{ includeArchived?: boolean }`

**Response**: `{ data: DiagramListItem[] }` where each item is `{ id, title, createdAt, updatedAt, archivedAt, type: 'diagram' }`

---

### `terminator.notepad:diagrams.get`

Returns the full diagram including the Excalidraw scene JSON.

**Request**: `{ id: string }`

**Response**: `{ data: { id, title, sceneJson, createdAt, updatedAt, archivedAt } } | { error: 'DIAGRAM_NOT_FOUND' }`

---

### `terminator.notepad:diagrams.autosave`

Saves updated scene JSON and title (debounced on the renderer side).

**Request**: `{ id: string; title: string; sceneJson: string }`

**Response**: `{ data: { updatedAt: string } } | { error: string }`

---

### `terminator.notepad:diagrams.archive`

Archives a diagram (hides from active list, keeps data).

**Request**: `{ id: string }` **Response**: `{ data: { archivedAt: string } } | { error: string }`

---

### `terminator.notepad:diagrams.restore`

Restores an archived diagram to the active list.

**Request**: `{ id: string }` **Response**: `{ data: { ok: true } } | { error: string }`

---

### `terminator.notepad:diagrams.hardDelete`

Permanently deletes a diagram and all its canvas comments (cascade).

**Request**: `{ id: string }` **Response**: `{ data: { ok: true } } | { error: string }`

---

### `terminator.notepad:notes.reorder`

Sets the display order of notes and diagrams. Accepts the full desired order (active items only); assigns `sort_order = index` to each item. Notes and diagrams are reordered in a single transaction.

**Request**: `{ items: { id: string; type: 'note' | 'diagram' }[] }` **Response**: `{ data: { ok: true } } | { error: string }`

---

## Notepad Extension — Folder Channels

### `terminator.notepad:folders.create`

Creates a new folder. The new folder is appended after all existing folders (sort_order = MAX+1).

**Request**: `{ name: string }` **Response**: `{ data: { id: string; name: string; sortOrder: number; createdAt: string } } | { error: string }`

---

### `terminator.notepad:folders.list`

Lists all folders ordered by sort_order ascending.

**Request**: `{}` **Response**: `{ data: { id: string; name: string; sortOrder: number; createdAt: string }[] }`

---

### `terminator.notepad:folders.rename`

Renames a folder.

**Request**: `{ id: string; name: string }` **Response**: `{ data: { ok: true } } | { error: 'FOLDER_NOT_FOUND' | string }`

---

### `terminator.notepad:folders.delete`

Deletes a folder. Notes and diagrams inside are moved to root (folder_id set to NULL) in the same transaction.

**Request**: `{ id: string }` **Response**: `{ data: { ok: true } } | { error: 'FOLDER_NOT_FOUND' | string }`

---

### `terminator.notepad:folders.move`

Moves one or more notes/diagrams into a folder (or to root when folderId is null).

**Request**: `{ items: { id: string; type: 'note' | 'diagram' }[]; folderId: string | null }` **Response**: `{ data: { ok: true } } | { error: 'FOLDER_NOT_FOUND' | string }`

---

## Notepad Extension — Diagram Comment Channels

### `terminator.notepad:diagram-comments.create`

Creates a comment pin at a canvas scene coordinate, optionally as a reply.

**Request**: `{ diagramId: string; body: string; sceneX?: number; sceneY?: number; parentId?: string }`

**Response**: `{ data: { id: string; createdAt: string } } | { error: string }`

---

### `terminator.notepad:diagram-comments.list`

Lists open (or all) comment threads for a diagram, with replies nested.

**Request**: `{ diagramId: string; includeResolved?: boolean }`

**Response**: `{ data: DiagramComment[] }` where each root comment has a `replies: DiagramComment[]` array.

---

### `terminator.notepad:diagram-comments.resolve`

Resolves a comment thread (marks the root and all replies as resolved).

**Request**: `{ id: string }` **Response**: `{ data: { ok: true } } | { error: string }`

---

### `terminator.notepad:diagram-comments.delete`

Hard-deletes a single comment (cascade removes children).

**Request**: `{ id: string }` **Response**: `{ data: { ok: true } } | { error: string }`

---

## Database Health

### `db:health`

Returns the current health status of the shared PGlite database.

**Direction**: renderer → main

**Request**: _(no payload)_

**Response**: `{ ok: boolean; message?: string }`

| Field     | Type      | Description                                        |
| --------- | --------- | -------------------------------------------------- |
| `ok`      | `boolean` | `true` if the database is reachable and responsive |
| `message` | `string?` | Error description if `ok` is `false`               |

---

## Extension Webview Channels (v2.0.0)

These channels coordinate between the host renderer, the main process `ExtensionViewHost`, and isolated extension `WebContentsView` contexts.

### `extension:update-panel-bounds`

Reports the current layout bounds of an `ExtensionPanelPortal` placeholder so the main process can position the corresponding `WebContentsView`.

**Direction**: renderer → main (invoke)

**Request**:

```typescript
{
  extensionId: string
  viewParam: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
  visible: boolean
  dpr: number // device pixel ratio
}
```

**Response**: `void`

---

### `extension:panel-loaded`

Push event sent by the main process when a `WebContentsView` has finished loading its initial page.

**Direction**: main → renderer (push)

**Payload**: `{ id: string }` — extension ID

---

### `extension:renderer-reload`

Push event sent by the main process after a successful `extension:reload` call. The host renderer's `ExtensionPanelPortal` remounts the view, triggering a fresh `WebContentsView` load.

**Direction**: main → renderer (push)

**Payload**: `{ id: string }` — extension ID

---

### `workspace:changed`

Push event broadcast to all active extension `WebContentsView` instances when the active workspace or project changes.

**Direction**: main → webview (extensionBridge push)

**Payload**: `{ repoRoot?: string | null }`

---

### `workspace:get-active`

Allows an extension webview to query the current active workspace context on demand.

**Direction**: webview → main (extensionBridge invoke)

**Request**: _(no payload)_

**Response**: `{ workspaceId: string | null; projectId: string | null; repoRoot: string | null }`

---

### `ext:command:<id>`

Push event broadcast to an extension's webview when a keyboard shortcut declared in `manifest.contributes.commands` fires. `<id>` is the command ID from the manifest.

**Direction**: main → webview (extensionBridge push)

**Payload**: _(none)_

**Example**: `ext:command:notepad:quick-create`, `ext:command:task-vault:capture-to-inbox`
