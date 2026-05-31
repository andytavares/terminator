# Architecture: Terminator

**Version**: 0.1.0 | **Updated**: 2026-05-22

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

| Namespace     | Direction        | Description                                                                                                                    |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `terminal:*`  | renderer ↔ main | PTY lifecycle: create, close, input, output, resize, cleanup                                                                   |
| `workspace:*` | renderer → main  | Workspace and project CRUD                                                                                                     |
| `project:*`   | renderer → main  | Project CRUD (scoped under workspace)                                                                                          |
| `settings:*`  | renderer → main  | Global and per-workspace settings                                                                                              |
| `dialog:*`    | renderer → main  | Native OS dialogs (folder picker)                                                                                              |
| `extension:*` | renderer → main  | Extension install, toggle, contribution queries                                                                                |
| `git:*`       | renderer → main  | Git status, diff, stage, unstage, commit, PR status/create                                                                     |
| `github:*`    | renderer → main  | PR review queue, diff, file metrics, inline comments, submit, session persistence, active-review tracking, prune closed/merged |
| `shell:exec`  | renderer → main  | Sandboxed shell execution (git/gh only, CWD scoped)                                                                            |
| `fs:*`        | renderer ↔ main | File watch start/stop; `fs:changed` push events                                                                                |

Full channel specifications: [`specs/001-extension-first-terminal/contracts/ipc-channels.md`](../specs/001-extension-first-terminal/contracts/ipc-channels.md),
[`specs/002-git-github-integration/contracts/ipc-channels-git.md`](../specs/002-git-github-integration/contracts/ipc-channels-git.md),
and [`specs/003-pr-review/contracts/ipc-channels-pr-review.md`](../specs/003-pr-review/contracts/ipc-channels-pr-review.md).

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

### Bundled extensions

First-party extensions (like `extensions/git-integration/`) are auto-loaded at startup via `ExtensionHost.loadBundledExtensions(bundledDir)`. This scans the `extensions/` directory for subdirectories containing a `manifest.json` and loads each one. See [ADR-007](adr/007-bundled-first-extension-distribution.md).

### Loading sequence

```
ExtensionHost.load(directoryPath)
      │
      ├─ reads manifest.json (ADR-008: manifest.json, not extension.json)
      ├─ validates with ExtensionManifestSchema (Zod)
      ├─ checks minAppVersion compatibility
      ├─ require()s entry point (compiled .js, see ADR-008)
      ├─ calls activate(api) with ExtensionAPI instance
      │        │
      │        └─ api.settings.register()           → globalRegistry.settingsSections
      │           api.sidebar.registerItem()        → globalRegistry.sidebarItems
      │           api.sidebar.registerPanel(slot)   → globalRegistry.sidebarPanels (v1.1.0)
      │           api.topBar.registerMenuItem()     → globalRegistry.topBarItems (v1.1.0)
      │           api.nativeMenu.addViewMenuItem()  → globalRegistry.nativeMenuItems + rebuild (v1.1.0)
      │           api.shell.exec()                  → shell-executor.ts (sandboxed, v1.1.0)
      │           api.notifications.showToast()     → BrowserWindow.webContents.send (v1.1.0)
      │           api.fs.watch()                    → FsWatcherService handlers (v1.1.0)
      │           api.contextMenu.registerItem()    → globalRegistry.contextMenuItems
      │           api.keyboard.register()           → globalRegistry.keyboardHandlers (throws on reserved)
      │           api.terminal.onSessionCreate()    → globalRegistry.sessionCreateHandlers
      │
      └─ errors in activate() set status: 'error', app stays stable (FR-028)
```

### Extension build pipeline

Extension main-process TypeScript (`extensions/*/src/index.ts` and its imports) is compiled to a CommonJS bundle (`extensions/*/src/index.js`) by `scripts/build-extensions.js` using esbuild. The compiled bundle is gitignored and must never be committed. `npm run dev` and `npm run build` both invoke this step automatically via the `build:extensions` script. Renderer-side extension code (`renderer.tsx` and React components) is bundled by electron-vite through the main renderer build.

Extension authors must keep main-process entry points free of React/DOM imports — those belong in `renderer.tsx`.

### Pop-out windows

The `window:open-pr-review` IPC handler, registered by the git-integration extension in `extensions/git-integration/src/index.ts` via `api.ipc.registerHandler`, calls `api.window.openAuxiliary('pr-review', params)`. The host creates a new `BrowserWindow` that loads the renderer URL with `?view=pr-review&repoRoot=<path>` (and optionally `&prNumber=<n>&showOverview=<bool>` to restore directly into an active review). The renderer's `src/renderer/index.tsx` detects the `view` query param and renders `PrReviewWindow` instead of `App` — a minimal wrapper around `PrReviewTab` with no workspace/terminal chrome. `PrReviewTab` reads the remaining URL params on mount to auto-navigate to the correct PR and session state. This pattern can be reused for other focused views.

### Sandboxed Shell Execution (v1.1.0)

`api.shell.exec()` allows extensions to run `git` and `gh` commands in the main process. Since extensions run in the main process (not the renderer), this is a direct call to `shell-executor.ts` — not an IPC round-trip. The `shell:exec` IPC channel exists separately for renderer-initiated shell calls.

Security constraints: command allowlist `['git', 'gh']`, CWD pinned to project root, `shell: false`, sanitized environment. See [ADR-006](adr/006-sandboxed-shell-exec-for-extensions.md).

### File System Watch (v1.1.0)

`FsWatcherService` (`src/main/fs/fs-watcher.ts`) manages OS-level `fs.watch` events with a polling fallback. Extensions subscribe via `api.fs.watch(handler)`. The service pushes `fs:changed` events to the renderer via `webContents.send`. See [ADR-005](adr/005-native-fswatcher-over-chokidar.md).

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

| Store                    | State                                                                       | Key actions                                                          |
| ------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `workspace.store.ts`     | workspaces[], projects by workspace, active IDs                             | loadWorkspaces, createWorkspace, setActiveWorkspace                  |
| `session.store.ts`       | sessions Map, terminalInstances Map, active session per project             | createSession, closeSession, setActiveSessionForProject              |
| `settings.store.ts`      | globalSettings, workspaceSettings Map, resolvedTheme                        | loadSettings, updateGlobalTheme, resolveSettings                     |
| `notification.store.ts`  | notifications[], unreadCount, panelOpen                                     | addNotification, markRead, markAllRead, dismiss, togglePanel         |
| `toast.store.ts`         | toasts[] (ephemeral queue)                                                  | addToast, removeToast                                                |
| `log.store.ts`           | logEntries[], console interceptor                                           | (entries added via installLogInterceptor); clearLogs                 |
| `metrics.store.ts`       | system CPU/memory/network, per-session process metrics                      | enableGlobalMetrics, disableGlobalMetrics, trackSession              |
| `extensions/registry.ts` | extension registration maps (sidebarPanels, globalTabs, commands, overlays) | registerGlobalTab, registerCommand, togglePanel, setActiveProjectTab |

All store actions are async — they call IPC first, then update local state only on success.

### Notification Model

Two distinct notification systems exist and are intentionally complementary:

- **In-app notification center** (`notification.store.ts` + `notifications:*` IPC, plural): persisted notifications shown in the bell-icon panel. Survives OS notification mute settings.
- **Native OS notification** (`notification.show` IPC, singular): fires a system-level desktop alert for immediate attention when a terminal session needs attention (bell event).

When a bell event fires in a backgrounded terminal session, both systems are triggered: `window.electronAPI.notification.show` (OS) and `useNotificationStore.getState().addNotification` (in-app). This ensures the user sees the signal regardless of OS notification preferences.

---

## Security Model

- `contextIsolation: true` — renderer cannot access Node.js APIs directly.
- `nodeIntegration: false` — renderer script cannot `require()` Node modules.
- All user input that crosses the IPC boundary is Zod-validated before use.
- Extensions are loaded via `require()` in the main process — they run with full Node.js privileges. Phase 1 does not sandbox extensions. This is a known limitation documented for Phase 2 consideration (see ADR-002).
- Reserved keyboard shortcuts are enforced in both preload.ts (renderer guard) and the extension API (main process throw).

---

## CSS Token Strategy

The renderer uses two tiers of CSS custom properties:

**Core-private tokens** (`--bg-*`, `--text-*`, `--border-*`, `--accent`, `--radius-*`, `--font-*`) are defined in `src/renderer/styles.css` and consumed only by core app components. Extensions MUST NOT use these directly — they are an implementation detail and may change without notice.

**Published extension tokens** (`--tm-*`) are aliases for the core-private tokens, also defined in `src/renderer/styles.css` `:root`. These are the stable API surface for extensions. The `--tm-` prefix signals a versioned, stable contract. The full contract is documented in `specs/003-pr-review/contracts/extension-token-api.md` and `docs/EXTENSION-DEVELOPMENT.md`.

```
styles.css :root
├── --bg-base: #0C0C0F        ← core private
├── ...
└── --tm-bg-base: var(--bg-base)  ← extension API alias
```

This alias layer allows the core design system to evolve (rename, restructure tokens) without breaking extensions, as long as the `--tm-*` values remain stable.

**Adding a new extension token** requires a MINOR version bump in `specs/003-pr-review/contracts/extension-token-api.md` and an update to `docs/EXTENSION-DEVELOPMENT.md`.

---

## Task Vault Extension Architecture

The task-vault extension (`extensions/task-vault/`) implements a GTD+BuJo+PARA productivity system. Markdown files are the human-editable source of truth for daily logs; SQLite (`better-sqlite3`) is the primary datastore for all structured queries and CRUD. Key subsystems:

### Vault Layer (`src/vault/`)

- **db.ts** — Initialises the SQLite database at `.todo/vault.db`, applies schema (WAL mode, FK enforcement), and exports `getDb()` / `initDb()` / `closeDb()`. All IPC handlers access data through this layer.
- **parser.ts** — Pure function `parseFile(content, filePath)` extracts tasks, events, notes, frontmatter, and `terminator:<uuid>` links from markdown content using `gray-matter`. Returns structured `ParseResult` used to sync records into SQLite.
- **writer.ts** — Atomic markdown file writes (tmp + `fs.rename`). Task mutation: `completeTask`, `migrateTask`, `addTask`. Checks stale line references (STALE_ID per ADR-014).
- **indexer.ts** — Walks vault directories, parses all `.md` files, writes a lightweight `.todo/index.json` summary for bulk queries. `getTaskById` resolves `filepath:line` IDs.
- **watcher.ts** — chokidar watcher on vault root (excludes `archive/`) with debounce. Triggers re-parse and SQLite sync on file change.

### IPC Layer (`src/ipc/`)

- **vault.ipc.ts** — Handlers for vault CRUD (capture, get-today, add-task, complete-task, migrate-task, query, process-inbox-item). All validate with Zod; stale IDs return `{ error: 'STALE_ID' }`.
- **projects.ipc.ts** — project list, update-project-status, and weekly-review payload handler.
- **links.ipc.ts** — bidirectional link handlers (create/remove/get-for-terminator-target).

### MCP Sidecar (`src/mcp/`)

- Standalone stdio server (`server.ts`) runs as a separate process: `TASK_VAULT_PATH=/path node extensions/task-vault/src/mcp/server.js`.
- Registers tools: capture, today, add_task, complete_task, migrate_task, query, list_projects, weekly_review.
- Auto-execute gate: reads per-tool toggle from `.todo/settings.json`; returns a suggestion without writing if disabled; `confirmed: true` bypasses.

### Task ID Format

Tasks are identified as `filepath:lineNumber` (ADR-014). IDs are session-scoped and rebuilt after every write. STALE_ID is returned when a task has moved to a different line.

### Extension API v1.2.0

New namespaces added in this extension cycle (ADR-012):

- `api.sidebar.registerGlobalTab` — register a permanent app-level tab
- `api.globalShortcut.register` — register global keyboard shortcuts
- `api.notifications.showToast` — show toast notifications from main process

## MergeFlow Conflict Resolver (git-integration extension)

MergeFlow is a subsystem of the `git-integration` extension that provides an intent-first, card-based git merge conflict resolution UI. It lives entirely in `extensions/git-integration/src/` with no core file modifications.

### Entry Points

- `GitSidebarPanel.tsx` shows a "Resolve conflicts →" button when `status.hasConflicts === true`, setting `gitStore.view = 'merge-flow'`.
- `GitFullView.tsx` renders `<MergeFlowView>` when `view === 'merge-flow'`.

### Session Lifecycle

1. **Open**: `MergeFlowView` mounts → checks `electron-store` for a persisted session → if none, calls `git:conflicts-list` to build a fresh `ConflictSession`.
2. **Resolve**: User resolves conflicts one block at a time → each decision calls `git:resolve-conflict` (writes to working-tree file) and `git:session-persist` (persists undo stack).
3. **Commit**: `CompletionScreen` calls `git:merge-commit` (stages resolved files + runs `git commit`) → on success: clears electron-store session + closes MergeFlow.
4. **Undo**: Renderer owns the undo stack (`ResolutionDecision[]` in `merge-flow.store.ts`) → undo calls `git:undo-resolve` to restore conflict markers in the file.

### New IPC Channels (9 total)

All registered in `extensions/git-integration/src/ipc/merge-flow.ipc.ts` and documented in `specs/006-mergeflow-conflict-resolver/contracts/ipc-channels.md`.

### New Files

| File                               | Purpose                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/schemas/merge-flow.schema.ts` | Zod schemas for all MergeFlow data entities                                                                                                                                                 |
| `src/git/conflict-reader.ts`       | Git subprocess helpers: conflict block parsing, REBASE_HEAD detection, author info                                                                                                          |
| `src/ipc/merge-flow.ipc.ts`        | IPC handler registration (9 channels)                                                                                                                                                       |
| `src/api/merge-flow.ts`            | Renderer bridge (extensionBridge wrappers)                                                                                                                                                  |
| `src/stores/merge-flow.store.ts`   | Zustand store: session state, navigation, undo stack, modal state                                                                                                                           |
| `src/components/merge-flow/*.tsx`  | UI components: MergeFlowView, ConflictHub, ConflictResolver, ConflictHeader, ConflictPanel, ResultPreviewStrip, ActionBar, KeepBothModal, ManualEditor, AiSuggestionPanel, CompletionScreen |

### AI Suggestion

`git:merge-ai-suggest` is stubbed to return `{ error: 'NOT_IMPLEMENTED' }` in this feature scope (Phase 3 PRD work). The channel contract is locked for future implementation.
