# Architecture: Terminator

**Version**: 0.1.0 | **Updated**: 2026-05-05

---

## Process Model

Terminator is an Electron application with two OS processes and one shared code layer.

```
┌─────────────────────────────────────────────────────┐
│  Main Process (Node.js)                             │
│                                                     │
│  ┌───────────┐  ┌────────────┐  ┌───────────────┐  │
│  │ PtyManager│  │ Extension  │  │electron-store │  │
│  │ (node-pty)│  │   Host     │  │  (workspace,  │  │
│  └─────┬─────┘  └─────┬──────┘  │  settings)    │  │
│        │              │         └───────────────┘  │
│  ┌─────▼──────────────▼─────────────────────────┐  │
│  │           IPC Handlers (ipcMain)              │  │
│  │  terminal:*  workspace:*  settings:*          │  │
│  │  extension:*  dialog:*                        │  │
│  └─────────────────────┬─────────────────────────┘  │
└────────────────────────┼────────────────────────────┘
                         │  contextBridge (preload.ts)
                         │  window.electronAPI.*
┌────────────────────────┼────────────────────────────┐
│  Renderer Process (Chromium + React)                │
│  contextIsolation: true │ nodeIntegration: false    │
│                         │                           │
│  ┌──────────────────────▼─────────────────────────┐ │
│  │          Zustand Stores                        │ │
│  │  workspace.store  session.store  settings.store│ │
│  └──────────────────────┬─────────────────────────┘ │
│                         │                           │
│  ┌──────────────────────▼─────────────────────────┐ │
│  │          React Components                      │ │
│  │  Sidebar  TabBar  TerminalPane  SettingsPanel  │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

**Why this separation?**

- `node-pty` requires native Node.js bindings — unavailable in the sandboxed renderer.
- `contextIsolation: true` is the Electron security baseline. Disabling it would expose the full Node.js API surface to any XSS vector in the renderer.
- See [ADR-001](adr/001-pty-in-main-process.md) and [ADR-002](adr/002-extension-host-in-main-process.md).

---

## IPC Contract

All renderer-to-main communication goes through `window.electronAPI`, exposed by `src/main/preload.ts` via `contextBridge`. Every IPC payload is validated with Zod at both ends.

### Channel namespaces

| Namespace     | Direction        | Description                                                  |
| ------------- | ---------------- | ------------------------------------------------------------ |
| `terminal:*`  | renderer ↔ main | PTY lifecycle: create, close, input, output, resize, cleanup |
| `workspace:*` | renderer → main  | Workspace and project CRUD                                   |
| `project:*`   | renderer → main  | Project CRUD (scoped under workspace)                        |
| `settings:*`  | renderer → main  | Global and per-workspace settings                            |
| `dialog:*`    | renderer → main  | Native OS dialogs (folder picker)                            |
| `extension:*` | renderer → main  | Extension install, toggle, contribution queries              |

Full channel specifications: [`specs/001-extension-first-terminal/contracts/ipc-channels.md`](../specs/001-extension-first-terminal/contracts/ipc-channels.md)

### Type safety

- `src/shared/types/index.ts` — TypeScript interfaces used by both processes.
- `src/shared/schemas/` — Zod schemas. Validate IPC payloads before use; malformed payloads return `{ error: 'VALIDATION_ERROR' }`.
- `src/renderer/electron.d.ts` — Type declaration for `window.electronAPI`, keeping the renderer call sites type-checked.

---

## Data Model

```
Workspace ──── (many) ──── Project
                               │
                               └── (many) ── TerminalSession [in-memory only]

GlobalSettings ──── (many) ──── WorkspaceSettings [per-workspace overrides]

Extension ──── contributes to ──── GlobalSettings.extensions[extensionId]
```

### Persistence boundaries

| Entity                   | Stored? | Where                                        |
| ------------------------ | ------- | -------------------------------------------- |
| Workspace, Project       | Yes     | electron-store (`workspaces.json`)           |
| GlobalSettings           | Yes     | electron-store (`settings.json`)             |
| WorkspaceSettings        | Yes     | electron-store (`settings.json`)             |
| Extension registry       | Yes     | electron-store (`extensions.json`)           |
| TerminalSession metadata | No      | In-memory (Zustand)                          |
| xterm.js buffer          | No      | In-memory (xterm.js Terminal instance)       |
| PTY process              | No      | OS process (killed on tab close or app quit) |

Sessions do not survive app restart. This is an explicit Phase 1 scope decision.

See [ADR-003](adr/003-electron-store-for-persistence.md) for the storage decision.

---

## Terminal Session Lifecycle

```
createSession() called
      │
      ▼
terminal:create IPC ──► PtyManager.spawn()
      │                      │
      │                      ├─ spawns node-pty process
      │                      ├─ registers onData → webContents.send('terminal:output')
      │                      └─ registers onExit → webContents.send('terminal:process-exit')
      ▼
TerminalInstance created (renderer)
      │
      ├─ new xterm Terminal({ scrollback })
      ├─ subscribes to terminal:output IPC
      └─ sends keystrokes via terminal:input IPC

Tab switch (navigate away)
      │
      └─ TerminalInstance.detach() — removes from DOM, ResizeObserver disconnected
         PTY keeps running in main process

Tab switch (return)
      │
      └─ TerminalInstance.attach(containerEl) — re-opens into DOM
         Buffer and scroll position intact (xterm.js instance was never destroyed)
         [ADR-004]

Tab close
      │
      ├─ terminal:close IPC ──► PtyManager.kill(sessionId)
      ├─ session removed from Zustand store
      └─ TerminalInstance.dispose() — xterm.js instance disposed, output unsubscribed
```

---

## Settings Resolution

Settings use a two-level hierarchy: global defaults + optional workspace overrides.

```
Resolved settings = GlobalSettings merged with WorkspaceSettings.overrides
```

The `resolveSettings(workspaceId?)` selector in `settings.store.ts` performs this merge. The result determines the `data-theme` attribute on `document.documentElement` (for CSS custom properties) and the `scrollback` value passed to new `Terminal` instances.

Theme changes take effect immediately — no restart needed — because the CSS variable system responds to the attribute change.

---

## Extension System

Extensions are Node.js CommonJS modules loaded in the main process by `ExtensionHost`.

### Loading sequence

```
ExtensionHost.load(directoryPath)
      │
      ├─ reads extension.json manifest
      ├─ validates with ExtensionManifestSchema (Zod)
      ├─ checks minAppVersion compatibility
      ├─ require()s entry point
      ├─ calls activate(api) with ExtensionAPI instance
      │        │
      │        └─ api.settings.register()      → globalRegistry.settingsSections
      │           api.sidebar.registerItem()   → globalRegistry.sidebarItems
      │           api.contextMenu.registerItem() → globalRegistry.contextMenuItems
      │           api.keyboard.register()      → globalRegistry.keyboardHandlers (throws on reserved)
      │           api.terminal.onSessionCreate() → globalRegistry.sessionCreateHandlers
      │
      └─ errors in activate() set status: 'error', app stays stable (FR-028)
```

### Reserved keyboard shortcuts

Extensions cannot claim: `Cmd+1–9`, `Cmd++/-`, `Cmd+Left/Right`, `Cmd+T`, `Cmd+W`, `Cmd+,`. Attempting to register these throws synchronously from `keyboard.register()`.

### Contribution rendering

The renderer queries contributions via IPC on mount:

- `extension:get-sidebar-items` → rendered below workspace list in Sidebar
- `extension:get-context-menu-items(target)` → merged into right-click menus

Full API surface: [`specs/001-extension-first-terminal/contracts/extension-api.md`](../specs/001-extension-first-terminal/contracts/extension-api.md)

---

## State Management

The renderer uses [Zustand](https://github.com/pmndrs/zustand) for all client-side state. Each store maps to a domain:

| Store                | State                                                           | Key actions                                             |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| `workspace.store.ts` | workspaces[], projects by workspace, active IDs                 | loadWorkspaces, createWorkspace, setActiveWorkspace     |
| `session.store.ts`   | sessions Map, terminalInstances Map, active session per project | createSession, closeSession, setActiveSessionForProject |
| `settings.store.ts`  | globalSettings, workspaceSettings Map, resolvedTheme            | loadSettings, updateGlobalTheme, resolveSettings        |

All store actions are async — they call IPC first, then update local state only on success.

---

## Security Model

- `contextIsolation: true` — renderer cannot access Node.js APIs directly.
- `nodeIntegration: false` — renderer script cannot `require()` Node modules.
- All user input that crosses the IPC boundary is Zod-validated before use.
- Extensions are loaded via `require()` in the main process — they run with full Node.js privileges. Phase 1 does not sandbox extensions. This is a known limitation documented for Phase 2 consideration (see ADR-002).
- Reserved keyboard shortcuts are enforced in both preload.ts (renderer guard) and the extension API (main process throw).
