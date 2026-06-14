# Contract: Extension API

**Version**: 1.4.0  
**Date**: 2026-06-14  
**Branch**: `001-extension-first-terminal`

This is the public API surface exposed to all Terminator extensions. Extensions receive an `ExtensionAPI` object as the sole argument to their `activate()` function. They MUST NOT import from `src/main/` or any internal module directly.

---

## Version History

| Version | Changes                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1.0.0   | Initial release: `app`, `log`, `settings`, `sidebar.registerItem`, `contextMenu`, `keyboard`, `terminal`                 |
| 1.1.0   | Added: `sidebar.registerPanel`, `topBar`, `shell`, `notifications.showToast`, `nativeMenu`, `fs`, `ipc`, `commands`      |
| 1.2.0   | Added: `sidebar.registerGlobalTab`, `globalShortcut`, `workspace`, `window`, `notifications.createNotification`          |
| 1.3.0   | Added: `sidebar.registerWorkspaceTab`, `WorkspaceTabRegistration`, `activeWorkspaceTabId` state on the renderer registry |
| 1.4.0   | Added: `settings.set`, `ipc.invokeChannel`, `ipc.sendChannel`, `ipc.onWindowEvent`, `pty` namespace, `window.broadcast`  |

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
   * Structured, namespaced logger. All entries are written to the main-process
   * log file (platform logs directory) prefixed with the extension id.
   * Works in the main-process context (activate/deactivate and IPC handlers).
   * For extension renderer code, use console.* which is intercepted automatically.
   */
  log: {
    debug(message: string, ...meta: unknown[]): void
    info(message: string, ...meta: unknown[]): void
    warn(message: string, ...meta: unknown[]): void
    error(message: string, ...meta: unknown[]): void
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

    /**
     * _(v1.4.0)_ Persist a value for an extension-contributed setting key.
     * Written to extension-settings-store; readable by all instances of this extension.
     */
    set(key: string, value: unknown): void
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

    /**
     * _(v1.1.0)_ Register a panel into a named slot (e.g. 'right-sidebar').
     * Returns a Disposable; disposing removes the panel.
     */
    registerPanel(slot: PanelSlot, panel: PanelContribution): Disposable

    /**
     * _(v1.2.0)_ Register a tab in the global tab bar (persistent across project switches).
     * Returns a Disposable; disposing removes the tab.
     */
    registerGlobalTab(tab: GlobalTabContribution): Disposable

    /**
     * _(v1.3.0)_ Register a workspace-scoped tab. The icon appears in each workspace card
     * header on hover. Clicking it activates the component in the main content area with
     * that workspace set as active. The component receives no props — it reads workspace
     * context from `useWorkspaceStore()` internally.
     * Returns a function that unregisters the tab when called.
     */
    registerWorkspaceTab(tab: WorkspaceTabRegistration): () => void
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
   * Keyboard shortcut registration point (local, app-focus-dependent).
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
   * _(v1.2.0)_ System-level (global) keyboard shortcut registration.
   * Fires even when the app is not focused. Use sparingly.
   */
  globalShortcut: {
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

  /**
   * _(v1.1.0)_ Project-view top-bar menu items.
   */
  topBar: {
    registerMenuItem(item: TopBarMenuContribution): Disposable
  }

  /**
   * _(v1.1.0)_ Sandboxed shell execution (git and gh only).
   */
  shell: {
    exec(options: {
      command: 'git' | 'gh'
      args: string[]
      cwd: string
      timeoutMs?: number
    }): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }>
  }

  /**
   * _(v1.1.0)_ Toast and notification creation.
   */
  notifications: {
    /** Show a transient toast (auto-dismisses). */
    showToast(type: ToastType, message: string): void

    /**
     * _(v1.2.0)_ Create a persistent notification with optional action buttons.
     * Returns a Disposable; disposing dismisses the notification.
     */
    createNotification(opts: {
      type: ToastType
      title: string
      message?: string
      actions?: Array<{ id: string; label: string; handler: () => void }>
    }): Disposable
  }

  /**
   * _(v1.1.0)_ Native application menu contribution (View menu).
   */
  nativeMenu: {
    addViewMenuItem(item: NativeMenuItemContribution): Disposable
  }

  /**
   * _(v1.1.0)_ File-system change event subscription.
   */
  fs: {
    /** Subscribe to fs:changed push events from watched directories. */
    watch(handler: (event: FsChangeEvent) => void): Disposable
  }

  /**
   * _(v1.1.0)_ Custom IPC channel registration and dispatch.
   */
  ipc: {
    registerHandler(
      channel: string,
      handler: (payload: unknown) => Promise<unknown> | unknown
    ): Disposable

    /**
     * _(v1.4.0)_ Invoke a registered ipcMain handler from the main process
     * (bypasses the Electron IPC pipe — for use by extensions running in main).
     */
    invokeChannel(channel: string, payload: unknown): Promise<unknown>

    /**
     * _(v1.4.0)_ Dispatch to a registered ipcMain send-type handler
     * (bypasses the Electron IPC pipe — for use by extensions running in main).
     */
    sendChannel(channel: string, payload: unknown): void

    /**
     * _(v1.4.0)_ Subscribe to events forwarded from renderer windows via the
     * main-process EventEmitter bridge. Returns an unsubscribe function.
     */
    onWindowEvent(channel: string, handler: (...args: unknown[]) => void): () => void
  }

  /**
   * _(v1.1.0)_ Command palette contribution.
   */
  commands: {
    register(command: CommandContribution, handler: () => void): Disposable
  }

  /**
   * _(v1.2.0)_ Workspace and project read access + event subscriptions.
   */
  workspace: {
    list(): WorkspaceSnapshot[]
    listProjects(workspaceId: string): ProjectSnapshot[]
    onDelete(handler: (workspaceId: string) => void): Disposable
    onProjectDelete(handler: (projectId: string) => void): Disposable
  }

  /**
   * _(v1.4.0)_ Direct PTY access for extensions that need to spawn/control
   * terminal processes (e.g. the remote-control extension). Requires that
   * PtyManagerAPI is injected via ExtensionAPIDeps at host construction time.
   * Throws if ptyManager is not available in the current context.
   */
  pty: {
    spawn(
      sessionId: string,
      cwd: string,
      shell: string,
      type: 'human' | 'agent',
      onData: (data: string) => void,
      onExit: (exitCode: number) => void
    ): string
    write(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    kill(sessionId: string): void
  }

  /**
   * _(v1.2.0)_ Auxiliary window management.
   */
  window: {
    openAuxiliary(view: string, params?: Record<string, string>): void

    /**
     * _(v1.4.0)_ Send an IPC channel message to all open BrowserWindows.
     * Falls back to BrowserWindow.getAllWindows() when broadcastToWindows dep
     * is not injected.
     */
    broadcast(channel: string, data: unknown): void
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
  workspaceScoped?: boolean
  secret?: boolean
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

// v1.1.0 types

type PanelSlot = 'right-sidebar' | 'global-tab'

interface PanelContribution {
  id: string
  title: string
  component: unknown // React.ComponentType — typed as unknown to avoid renderer dependency
  defaultVisible?: boolean
}

interface TopBarMenuContribution {
  id: string
  label: string
  onClick(): void
  tooltip?: string
}

interface NativeMenuItemContribution {
  id: string
  label: string
  onClick(): void
  accelerator?: string
}

interface FsChangeEvent {
  projectRoot: string
  eventType: 'change' | 'rename'
  filename: string | null
}

type ToastType = 'info' | 'success' | 'warning' | 'error'

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

interface CommandContribution {
  id: string
  label: string
  description?: string
  shortcut?: string
  category?: string
}

// v1.2.0 types

interface GlobalTabContribution {
  id: string
  label: string
  icon?: string
  component: unknown
  permanent?: boolean
}

// v1.3.0 types

/**
 * A workspace-scoped tab contributed by an extension (renderer registry only).
 * The icon appears in each workspace card header on hover. The component receives
 * no props and reads active workspace context from useWorkspaceStore() internally.
 */
interface WorkspaceTabRegistration {
  id: string
  label: string
  icon?: ReactNode
  component: ComponentType<Record<string, never>>
}

/**
 * Renderer registry state additions (v1.3.0):
 *   activeWorkspaceTabId: string | null
 *   workspaceTabs: Map<string, WorkspaceTabRegistration>
 *
 * Registry methods additions (v1.3.0):
 *   registerWorkspaceTab(tab: WorkspaceTabRegistration): () => void
 *   setActiveWorkspaceTab(tabId: string | null): void
 *
 * Activating a workspace tab clears activeGlobalTabId and activeProjectTabId.
 * Activating a global or project tab clears activeWorkspaceTabId.
 * Clicking a project/session row also clears activeWorkspaceTabId.
 */

interface WorkspaceSnapshot {
  readonly id: string
  readonly name: string
  readonly folderPath: string
}

interface ProjectSnapshot {
  readonly id: string
  readonly workspaceId: string
  readonly name: string
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

5. **API versioning**: The `ExtensionAPI` interface follows semantic versioning. Breaking changes require a MAJOR version bump and a new ADR. The current version is `1.4.0` (added `settings.set`, `ipc.invokeChannel/sendChannel/onWindowEvent`, `pty` namespace, `window.broadcast`). The renderer-registry surface remains at `1.3.0` — `registerWorkspaceTab` is a renderer-registry-only surface, not exposed via `activate(api)`.
