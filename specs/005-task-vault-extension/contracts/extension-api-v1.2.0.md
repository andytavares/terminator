# Contract: Extension API v1.2.0 Additions

**Version**: 1.2.0 (MINOR — additive only, no breaking changes)  
**Date**: 2026-05-19  
**Supersedes**: Extension API v1.1.x  
**Feature**: `005-task-vault-extension`

These additions are required by the task-vault extension. All are additive; no existing API surface changes.

---

## 1. `sidebar.registerGlobalTab`

Registers a permanent top-level application tab. Unlike `sidebar.registerPanel` (which shows a floating right-sidebar within the workspace view), a global tab is always visible in the application layout regardless of active workspace or project.

```typescript
sidebar: {
  // Existing
  registerItem(item: SidebarContribution): Disposable
  registerPanel(slot: PanelSlot, panel: PanelContribution): Disposable

  // NEW in v1.2.0
  registerGlobalTab(tab: GlobalTabContribution): Disposable
}

interface GlobalTabContribution {
  id: string
  label: string
  /** Icon identifier or emoji for the tab button */
  icon?: string
  /** React component rendered when this tab is active. Typed as unknown to avoid renderer dependency. */
  component: unknown
  /** If true, tab button is always visible in the WorkspaceRail. Default: true */
  permanent?: boolean
}
```

**Renderer behavior**: The tab button appears in `WorkspaceRail` below the workspace list. Clicking it renders the tab's component in the `main-content` area, replacing the active workspace/project view. The tab persists across workspace changes.

**Constraints**: Only one global tab can be active at a time. Clicking a workspace tile deactivates the global tab and returns to the workspace view.

---

## 2. `globalShortcut`

Registers OS-level keyboard shortcuts that fire even when the application is in the background. Wraps Electron's `globalShortcut` module.

```typescript
globalShortcut: {
  /**
   * Register an OS-level global keyboard shortcut.
   * Fires even when the Terminator window is not focused or is minimized.
   * Accelerator uses Electron syntax (e.g., "CmdOrCtrl+Shift+Space").
   * Throws synchronously if the accelerator is already registered by another extension
   * or by the OS.
   * Returns a Disposable; disposing unregisters the shortcut.
   */
  register(accelerator: string, handler: () => void): Disposable
}
```

**Constraints**:

- Extensions MUST unregister global shortcuts in `deactivate()` (via `dispose()`). The host performs cleanup automatically on unload, but explicit disposal is required.
- If registration fails (accelerator taken by OS or another app), the method throws with a descriptive error message.

**Source**: [Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut)

---

## 3. `workspace`

Exposes Terminator workspace and project metadata for use in extension UIs (e.g., link pickers).

```typescript
workspace: {
  /**
   * Returns a snapshot of all current workspaces with their stable UUIDs.
   * Display names may change (rename); UUIDs are permanent.
   */
  list(): WorkspaceSnapshot[]

  /**
   * Returns a snapshot of all projects in a given workspace.
   */
  listProjects(workspaceId: string): ProjectSnapshot[]

  /**
   * Subscribe to workspace deletion events.
   * Handler receives the deleted workspace's UUID.
   * Use to detect broken TerminatorLinks.
   */
  onDelete(handler: (workspaceId: string) => void): Disposable

  /**
   * Subscribe to project deletion events.
   * Handler receives the deleted project's UUID.
   */
  onProjectDelete(handler: (projectId: string) => void): Disposable
}

interface WorkspaceSnapshot {
  readonly id: string         // Stable UUID
  readonly name: string       // Display name (may change on rename)
  readonly folderPath: string
}

interface ProjectSnapshot {
  readonly id: string         // Stable UUID
  readonly workspaceId: string
  readonly name: string       // Display name
}
```

**Constraints**:

- `list()` and `listProjects()` are synchronous reads from the workspace store. They reflect current state at time of call.
- Extension MUST NOT store display names in vault files — store only UUIDs.
- Deletion handlers fire after the workspace/project is removed from the store.

---

## Updated `PanelSlot` Type

```typescript
// v1.1.x
export type PanelSlot = 'right-sidebar'

// v1.2.0 (additive)
export type PanelSlot = 'right-sidebar' | 'global-tab'
```

Note: `'global-tab'` is an internal routing hint used by `registerPanel` when `registerGlobalTab` is called. Direct use of `'global-tab'` via `registerPanel` is not supported — use `registerGlobalTab` instead.

---

## Version Bump

`src/main/extensions/api.ts` version comment: `// v1.2.0`

The `ExtensionAPI` interface is unchanged for existing methods. All additions are new optional namespaces. Existing extensions require no modification.

---

## Pre-existing v1.1.x Namespaces (Reference)

The following namespaces already exist in `src/main/extensions/api.ts` as of v1.1.x. They are used by task-vault (`notifications` in T087, `keyboard` in T095) but require **no new additions** for this feature.

```typescript
notifications: {
  showToast(type: 'info' | 'success' | 'warning' | 'error', message: string): void
}

keyboard: {
  /** Register an in-app keyboard shortcut (fires only when Terminator window is focused).
   *  Use `globalShortcut` for OS-level shortcuts that fire when app is backgrounded. */
  register(accelerator: string, handler: () => void): Disposable
}
```
