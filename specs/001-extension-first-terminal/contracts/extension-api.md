# Contract: Extension API

**Version**: 1.0.0  
**Date**: 2026-05-05  
**Branch**: `001-extension-first-terminal`

This is the public API surface exposed to all Terminator extensions. Extensions receive an `ExtensionAPI` object as the sole argument to their `activate()` function. They MUST NOT import from `src/main/` or any internal module directly.

---

## Extension Entry Point Contract

Every extension MUST export an `activate` function (and MAY export a `deactivate` function):

```typescript
// Extension entry point (extension's main.js / main.ts compiled output)
export function activate(api: ExtensionAPI): void | Promise<void>;
export function deactivate?(): void | Promise<void>;
```

- `activate` is called when the extension is loaded or enabled.
- `deactivate` is called when the extension is disabled (without restart, FR-027). If not exported, disabling unloads the module but skips teardown.
- Any error thrown from `activate` transitions the extension to `status: 'error'` and logs the message. The app remains stable (FR-028).

---

## ExtensionAPI Interface

```typescript
interface ExtensionAPI {
  /**
   * Metadata about the currently running Terminator application.
   */
  readonly app: {
    readonly version: string
  }

  /**
   * Settings contribution and access point.
   */
  settings: {
    /**
     * Register a settings section contributed by this extension.
     * The schema defines the shape and defaults of extension settings.
     * The registered section appears in both Global and Workspace settings panels (FR-023).
     */
    register(schema: ExtensionSettingsSchema): Disposable

    /**
     * Read the resolved value for an extension-contributed setting key.
     * Respects workspace-level overrides when called in workspace context.
     */
    get<T>(key: string): T | undefined
  }

  /**
   * Sidebar contribution point.
   */
  sidebar: {
    /**
     * Register a custom item to appear beneath the workspace list in the sidebar.
     * Returns a Disposable; disposing removes the item.
     */
    registerItem(item: SidebarContribution): Disposable
  }

  /**
   * Context menu contribution point.
   */
  contextMenu: {
    /**
     * Register a menu item into one of the available context menu targets.
     * Returns a Disposable; disposing removes the item.
     */
    registerItem(target: ContextMenuTarget, item: MenuItemContribution): Disposable
  }

  /**
   * Keyboard shortcut registration point.
   */
  keyboard: {
    /**
     * Register a keyboard shortcut contributed by this extension.
     * The accelerator string uses Electron accelerator syntax (e.g., "CmdOrCtrl+Shift+K").
     * Registration throws synchronously if the accelerator conflicts with a reserved core shortcut.
     * Returns a Disposable; disposing removes the shortcut binding.
     */
    register(accelerator: string, handler: () => void): Disposable
  }

  /**
   * Terminal event subscription point.
   */
  terminal: {
    /**
     * Subscribe to session creation events.
     * Handler receives a read-only snapshot of the new session.
     */
    onSessionCreate(handler: (session: Readonly<SessionSnapshot>) => void): Disposable

    /**
     * Subscribe to session close events.
     * Handler receives the closed session's ID.
     */
    onSessionClose(handler: (sessionId: string) => void): Disposable
  }
}
```

---

## Supporting Types

```typescript
/**
 * Returned by all registration methods. Call dispose() to undo the registration.
 */
interface Disposable {
  dispose(): void
}

/**
 * Schema definition for extension-contributed settings.
 */
interface ExtensionSettingsSchema {
  /** Section label shown in settings panel */
  label: string
  /** Key-value map of setting definitions */
  properties: Record<string, SettingDefinition>
}

interface SettingDefinition {
  type: 'string' | 'number' | 'boolean' | 'enum'
  label: string
  description?: string
  default: unknown
  /** For type 'enum' only: available options */
  options?: string[]
  /** For type 'number' only */
  min?: number
  max?: number
}

/**
 * A sidebar item contributed by an extension.
 */
interface SidebarContribution {
  id: string
  label: string
  /** Optional tooltip text */
  tooltip?: string
  /** Click handler */
  onClick(): void
}

/**
 * Available context menu targets.
 */
type ContextMenuTarget =
  | 'workspace' // Right-click on a workspace in the sidebar
  | 'project' // Right-click on a project in the sidebar
  | 'tab' // Right-click on a terminal tab
  | 'terminal' // Right-click inside the terminal area

interface MenuItemContribution {
  id: string
  label: string
  /** Called with the ID of the entity that was right-clicked */
  onClick(targetId: string): void
}

/**
 * Read-only session information passed to terminal event handlers.
 */
interface SessionSnapshot {
  readonly id: string
  readonly projectId: string
  readonly tabTitle: string
  readonly type: 'human' | 'agent'
}
```

---

## Constraints and Invariants

1. **No internal imports**: Extensions MUST NOT import from `src/main/`, `src/renderer/`, or `src/shared/` directly. The `ExtensionAPI` object is the only allowed interface.

2. **Reserved keyboard shortcuts**: `keyboard.register()` throws synchronously if the accelerator matches any of the following reserved core shortcuts:

   - `Cmd+1` through `Cmd+9` (workspace switching)
   - `Cmd++`, `Cmd+-` (cycle workspaces)
   - `Cmd+Left`, `Cmd+Right` (cycle tabs)
   - `Cmd+T` (new tab)
   - `Cmd+W` (close tab)
   - `Cmd+,` (open settings)

3. **Disposable cleanup**: Extensions are expected to call `dispose()` on all returned Disposables during `deactivate()`. If not called, the host performs cleanup automatically on disable/unload.

4. **Settings key namespacing**: Extension setting keys must be prefixed with the extension ID to avoid collisions (enforced by the host at registration time).

5. **API versioning**: The `ExtensionAPI` interface is versioned starting at `1.0.0`. Breaking changes require a MAJOR version bump and a new ADR.
