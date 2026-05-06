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

## Error Handling Convention

All invoke/handle channels return a discriminated union of success and error shapes. The renderer MUST check for the `error` field before using response data. Zod validates all incoming payloads; malformed payloads return `{ error: 'VALIDATION_ERROR', message: string }`.
