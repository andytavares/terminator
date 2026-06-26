# Contract: Webview Renderer API (`window.electronAPI`)

**Version**: 2.0.0
**Feature**: 013-webview-extension-system
**Date**: 2026-06-24

---

## Overview

Every extension `WebContentsView` receives the complete `window.electronAPI` surface via a preload script (`dist-electron/preload/webview.js`). This is the identical surface exposed to the core renderer — no restriction, no subset. Access control is enforced by the main-process IPC handlers, not by the preload.

Extensions call `window.electronAPI.*` from their renderer code exactly as the core app does.

---

## Workspace Namespace

### `workspace.list(): Promise<Workspace[]>`

Returns all workspaces. Each workspace: `{ id, name, createdAt }`.

### `workspace.create(name: string): Promise<Workspace>`

Creates a new workspace.

### `workspace.delete(id: string): Promise<void>`

Deletes a workspace and all its projects.

### `workspace.getActive(): Promise<{ workspaceId: string | null, projectId: string | null, repoRoot: string | null }>`

Returns the currently active workspace context. Use this when URL params may be stale (e.g., after a workspace switch event arrives before the URL is updated).

---

## Project Namespace

### `project.list(workspaceId: string): Promise<Project[]>`

Returns all projects for the given workspace.

### `project.create(workspaceId: string, name: string, repoRoot: string): Promise<Project>`

Creates a project in the given workspace.

### `project.delete(id: string): Promise<void>`

Deletes a project.

---

## Terminal Namespace

### `terminal.create(projectId: string): Promise<{ id: string }>`

Spawns a new terminal session for the project.

### `terminal.write(id: string, data: string): Promise<void>`

Writes data to the terminal.

### `terminal.resize(id: string, cols: number, rows: number): Promise<void>`

Resizes the terminal PTY.

### `terminal.kill(id: string): Promise<void>`

Kills the terminal session.

---

## Git Namespace

### `git.status(repoRoot: string): Promise<GitStatus>`

Returns working tree status for the given repo.

### `git.diff(repoRoot: string, file?: string): Promise<string>`

Returns unified diff output.

### `git.log(repoRoot: string, limit?: number): Promise<GitCommit[]>`

Returns recent commits.

### `git.branches(repoRoot: string): Promise<string[]>`

Returns branch names.

---

## ExtensionBridge Namespace

Used for event-based communication (main process → webview, or inter-namespace events).

### `extensionBridge.on(event: string, handler: (data: unknown) => void): () => void`

Subscribes to a named event broadcast. Returns an unsubscribe function.

**Key events**:

- `workspace:changed` — fired when the active workspace/project changes. Payload: `{ workspaceId, projectId, repoRoot }`.
- `ext:command:{commandId}` — fired when a keyboard command declared in the extension's manifest is triggered by the user.

### `extensionBridge.emit(event: string, data: unknown): void`

Emits an event to the main process. Not for inter-extension communication.

---

## Extension Namespace

### `extension.list(): Promise<Extension[]>`

Returns all installed extensions with their `contributes` block.

### `extension.reload(id: string): Promise<void>`

Reloads the extension (clears Node.js module cache, re-activates main entry, re-mounts webview).

---

## Settings Namespace

### `settings.get(key: string): Promise<unknown>`

Returns a stored setting value.

### `settings.set(key: string, value: unknown): Promise<void>`

Stores a setting value.

---

## DB Namespace

Extensions share the same PGlite database as the core app. Each extension should use a dedicated table prefix to avoid conflicts.

### `db.query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>`

Executes a parameterized SQL query.

### `db.execute(sql: string, params?: unknown[]): Promise<void>`

Executes a SQL statement (CREATE TABLE, INSERT, UPDATE, DELETE).

---

## Dialog Namespace

### `dialog.openDirectory(): Promise<string | null>`

Opens a system directory picker. Returns the selected path or `null` if cancelled.

### `dialog.openFile(options?: OpenDialogOptions): Promise<string | null>`

Opens a system file picker.

### `dialog.saveFile(options?: SaveDialogOptions): Promise<string | null>`

Opens a system save dialog.

---

## Notification Namespace

### `notification.show(title: string, body: string): Promise<void>`

Shows a system notification.

---

## Workspace Context from URL Parameters

At mount time, the webview URL includes the active workspace context as query parameters. Read them on initialization:

```ts
const params = new URLSearchParams(window.location.search)
const workspaceId = params.get('workspaceId') ?? null
const projectId = params.get('projectId') ?? null
const repoRoot = params.get('repoRoot') ?? null
const view = params.get('view') ?? 'main'
```

**Note**: These params reflect the context at mount time. Subscribe to `workspace:changed` for live updates:

```ts
const unsub = window.electronAPI.extensionBridge.on(
  'workspace:changed',
  ({ workspaceId, projectId, repoRoot }) => {
    // update local state
  }
)
// cleanup in component unmount or effect cleanup
```

---

## Stability Policy

The `window.electronAPI` surface is stable within a major app version (semver major).

- **No breaking changes** (removal or rename of existing methods) within a major version.
- **Additive changes** (new methods, new optional parameters) may occur in minor versions.
- **Breaking changes** require a major version bump and changelog notice.
- Extensions declare `minAppVersion` in their manifest to pin compatibility.
- Each API method's introduction version is documented in `docs/EXTENSION-DEVELOPMENT.md`.
