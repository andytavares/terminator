# Contract: Extension API Additions (v1.1.0)

**Version**: 1.1.0 (extends v1.0.0 from `001-extension-first-terminal`)
**Date**: 2026-05-07
**Branch**: `002-git-github-integration`

This document defines the **additions** to the `ExtensionAPI` interface required for the git integration extension. The base API (v1.0.0) is defined in `specs/001-extension-first-terminal/contracts/extension-api.md`. All existing API surfaces remain unchanged.

---

## Summary of Additions

| Surface | Method | Requirement |
|---|---|---|
| `sidebar` | `registerPanel(slot, panel)` | FR-022 |
| `topBar` | `registerMenuItem(item)` | FR-023 |
| `shell` | `exec(options)` | FR-024 |
| `notifications` | `showToast(type, message)` | FR-026 |
| `fs` | `watch(handler)` | FR-027 |
| `nativeMenu` | `addViewMenuItem(item)` | FR-030 |
| `SettingDefinition` | `workspaceScoped?: boolean` | FR-025 |

---

## Updated `ExtensionAPI` Interface (additions only)

```typescript
interface ExtensionAPI {
  // ── existing surfaces (v1.0.0): app, settings, sidebar.registerItem,
  //    contextMenu, keyboard, terminal ──

  sidebar: {
    registerItem(item: SidebarContribution): Disposable  // existing (v1.0.0)

    /**
     * Register a full UI panel into a named layout slot.
     * The panel is rendered as a React component inside the slot's container.
     * Returns a Disposable; disposing removes the panel and collapses the slot.
     *
     * FR-022
     */
    registerPanel(slot: PanelSlot, panel: PanelContribution): Disposable
  }

  /**
   * Top bar menu contribution point (project view toolbar).
   * FR-023
   */
  topBar: {
    /**
     * Register a menu item in the project view's top bar.
     * Items appear in registration order, left-to-right.
     * Returns a Disposable; disposing removes the item.
     */
    registerMenuItem(item: TopBarMenuContribution): Disposable
  }

  /**
   * Sandboxed shell execution bridge.
   * Allows extensions to invoke whitelisted CLI tools in the main process.
   * FR-024
   */
  shell: {
    /**
     * Execute a whitelisted shell command in the main process.
     * Command is restricted to 'git' and 'gh'.
     * CWD is restricted to the current project's root directory.
     * Rejects with an error if the command is not whitelisted or CWD is out of scope.
     */
    exec(options: ShellExecOptions): Promise<ShellResult>
  }

  /**
   * Notification / toast API.
   * Surfaces messages through the application's standard toast system.
   * FR-026
   */
  notifications: {
    /**
     * Display a toast notification. Uses the same `useToastStore` infrastructure
     * as the core application.
     */
    showToast(type: ToastType, message: string): void
  }

  /**
   * Native application menu contribution point.
   * FR-030
   */
  nativeMenu: {
    /**
     * Add an item to the application's native View menu.
     * Uses Electron Menu API in the main process.
     * Returns a Disposable; disposing removes the item from the View menu.
     */
    addViewMenuItem(item: NativeMenuItemContribution): Disposable
  }

  /**
   * File system watch events scoped to the current project directory.
   * FR-027
   */
  fs: {
    /**
     * Subscribe to file change events for the current project root.
     * Uses OS-level watch events (fs.watch) with polling fallback.
     * The handler is called on the renderer side when the main process
     * detects a change and pushes an `fs:changed` event.
     * Returns a Disposable; disposing unregisters the handler.
     */
    watch(handler: (event: FsChangeEvent) => void): Disposable
  }
}
```

---

## New Supporting Types

```typescript
/**
 * Available layout slots for panel registration.
 */
type PanelSlot = 'right-sidebar'
// Future slots (not in v1.1.0 scope): 'bottom-panel', 'left-sidebar-bottom'

/**
 * A full UI panel contributed by an extension.
 */
interface PanelContribution {
  id: string
  /** Short label shown in the slot's header/tab bar */
  title: string
  /** React component rendered inside the panel container */
  component: React.ComponentType
  /**
   * Initial visibility. When false, the slot is collapsed until toggled.
   * Respects 'git.sidebar.defaultOpen' setting for the git integration.
   */
  defaultVisible?: boolean
}

/**
 * A menu item contributed to the project view's top bar.
 */
interface TopBarMenuContribution {
  id: string
  /** Display label */
  label: string
  /** Called when the menu item is clicked */
  onClick(): void
  /** Optional tooltip */
  tooltip?: string
}

/**
 * A menu item contributed to the native application View menu.
 * FR-030
 */
interface NativeMenuItemContribution {
  id: string
  /** Display label shown in the native View menu */
  label: string
  /** Called when the menu item is selected */
  onClick(): void
  /** Optional Electron accelerator string (e.g., "CmdOrCtrl+Shift+G") */
  accelerator?: string
}

/**
 * Options for sandboxed shell command execution.
 */
interface ShellExecOptions {
  /** Whitelisted commands only: 'git' | 'gh' */
  command: 'git' | 'gh'
  args: string[]
  /**
   * Working directory. Must be the project root or a subdirectory thereof.
   * Validated server-side; rejected if outside project scope.
   */
  cwd: string
  /** Execution timeout in ms. Defaults to 10000. */
  timeoutMs?: number
}

/**
 * Result of a sandboxed shell execution.
 */
interface ShellResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

/**
 * Toast notification type. Maps to the existing ToastType in useToastStore.
 */
type ToastType = 'info' | 'success' | 'warning' | 'error'

/**
 * A file system change event pushed by the main process.
 */
interface FsChangeEvent {
  projectRoot: string
  eventType: 'change' | 'rename'
  /** Relative path from projectRoot. Null on some platforms (Linux). */
  filename: string | null
}
```

---

## Updated `SettingDefinition` (FR-025)

The existing `SettingDefinition` interface gains a `workspaceScoped` field:

```typescript
interface SettingDefinition {
  type: 'string' | 'number' | 'boolean' | 'enum'
  label: string
  description?: string
  default: unknown
  options?: string[]   // For type 'enum' only
  min?: number         // For type 'number' only
  max?: number         // For type 'number' only
  /**
   * NEW in v1.1.0: When true, this setting can be overridden at workspace level.
   * Workspace-level value takes precedence when api.settings.get() is called
   * in a workspace context. Default: false (global only).
   */
  workspaceScoped?: boolean
}
```

---

## Constraints and Invariants

1. **Shell command allowlist**: `shell.exec` validates `command` against `['git', 'gh']` in the main process before `execFile` is called. Any other value returns a rejected Promise with error `'COMMAND_NOT_ALLOWED'`.

2. **CWD scope enforcement**: The `cwd` argument must be equal to or a subdirectory of the current workspace's `folderPath`. The main process validates this using `path.relative()`. A `cwd` that escapes the workspace returns a rejected Promise with error `'CWD_OUT_OF_SCOPE'`.

3. **Panel slot uniqueness**: Only one panel may be registered per slot per extension. Attempting to register a second panel in the same slot from the same extension throws synchronously with `'SLOT_ALREADY_REGISTERED'`.

4. **fs.watch scope**: Watch events are scoped to the project root. The extension cannot watch paths outside the current project.

5. **API versioning**: These additions bump the `ExtensionAPI` version to `1.1.0`. The version is exposed via `api.app.version` for extensions that need to feature-detect.

---

## Backward Compatibility

All additions are additive. Existing extensions built against v1.0.0 continue to work without modification. The `ExtensionHost` exposes the v1.1.0 API surface to all extensions at load time; individual extensions that do not use the new surfaces are unaffected.
