# Architecture: Terminator

**Version**: 0.1.0 | **Updated**: 2026-05-31

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

| Namespace     | Direction        | Description                                                                                                                          |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `terminal:*`  | renderer ↔ main | PTY lifecycle: create, close, input, output, resize, cleanup                                                                         |
| `workspace:*` | renderer → main  | Workspace and project CRUD                                                                                                           |
| `project:*`   | renderer → main  | Project CRUD (scoped under workspace)                                                                                                |
| `settings:*`  | renderer → main  | Global and per-workspace settings                                                                                                    |
| `dialog:*`    | renderer → main  | Native OS dialogs (folder picker)                                                                                                    |
| `extension:*` | renderer → main  | Extension install, toggle, contribution queries                                                                                      |
| `git:*`       | renderer → main  | Git status, diff, stage, unstage, commit, PR status/create                                                                           |
| `github:*`    | renderer → main  | PR review queue, diff, file metrics, inline comments, submit, session persistence, active-review tracking, prune closed/merged       |
| `shell:exec`  | renderer → main  | Sandboxed shell execution (git/gh only, CWD scoped)                                                                                  |
| `fs:*`        | renderer ↔ main | File watch start/stop; `fs:read-file`; `fs:changed` push events                                                                      |
| `remote:*`    | main ↔ renderer | Remote control server: `remote:status` (main→renderer), `remote:tunnel-reconnect` (renderer→main), `remote:update-password` (invoke) |
| `log:push`    | main → renderer  | Forwards main-process log entries to renderer LogWindow                                                                              |

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
      │           api.settings.get()               → getExtensionSetting(key)
      │           api.settings.set()               → setExtensionSetting(key, value) (v1.4.0)
      │           api.sidebar.registerItem()        → globalRegistry.sidebarItems
      │           api.sidebar.registerPanel(slot)   → globalRegistry.sidebarPanels (v1.1.0)
      │           api.topBar.registerMenuItem()     → globalRegistry.topBarItems (v1.1.0)
      │           api.nativeMenu.addViewMenuItem()  → globalRegistry.nativeMenuItems + rebuild (v1.1.0)
      │           api.shell.exec()                  → shell-executor.ts (sandboxed, v1.1.0)
      │           api.notifications.showToast()     → BrowserWindow.webContents.send (v1.1.0)
      │           api.fs.watch()                    → FsWatcherService handlers (v1.1.0)
      │           api.ipc.registerHandler()         → ipcMain.handle() (v1.1.0)
      │           api.ipc.invokeChannel()           → dispatches to a registered ipcMain handler (v1.4.0)
      │           api.ipc.sendChannel()             → dispatches to a registered ipcMain send handler (v1.4.0)
      │           api.ipc.onWindowEvent()           → subscribes to EventEmitter events from renderer (v1.4.0)
      │           api.commands.register()           → globalRegistry.commandContributions / commandHandlers (v1.1.0)
      │           api.contextMenu.registerItem()    → globalRegistry.contextMenuItems
      │           api.keyboard.register()           → globalRegistry.keyboardHandlers (throws on reserved)
      │           api.terminal.onSessionCreate()    → globalRegistry.sessionCreateHandlers
      │           api.sidebar.registerGlobalTab()   → globalRegistry.globalTabs (v1.2.0)
      │           api.globalShortcut.register()     → electron globalShortcut (v1.2.0)
      │           api.pty.spawn/write/resize/kill() → PtyManager (injected via ExtensionAPIDeps, v1.4.0)
      │
      │        Note: registerWorkspaceTab() is a renderer-registry-only surface (v1.3.0).
      │        It is called from the extension's renderer.tsx, not from activate(api).
      │           registry.registerWorkspaceTab()   → registry.workspaceTabs Map
      │           api.workspace.list()              → workspace-store.listWorkspaces() (v1.2.0)
      │           api.window.openAuxiliary()        → BrowserWindow factory (v1.2.0)
      │           api.window.broadcast()            → send channel to all BrowserWindows (v1.4.0)
      │           api.notifications.createNotification() → notificationManager (v1.2.0)
      │
      └─ errors in activate() set status: 'error', app stays stable (FR-028)
```

### Extension build pipeline

Extension main-process TypeScript (`extensions/*/src/index.ts` and its imports) is compiled to a CommonJS bundle (`extensions/*/src/index.js`) by `scripts/build-extensions.cjs` using esbuild. The compiled bundle is gitignored and must never be committed. `npm run dev` and `npm run build` both invoke this step automatically via the `build:extensions` script. Renderer-side extension code (`renderer.tsx` and React components) is bundled by electron-vite through the main renderer build.

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

| Store                    | State                                                                                                                               | Key actions                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `workspace.store.ts`     | workspaces[], projects by workspace, active IDs, expandedWorkspaceIds                                                               | loadWorkspaces, createWorkspace, setActiveWorkspace, toggleWorkspaceCollapse, setExpandedWorkspaceIds             |
| `session.store.ts`       | sessions Map, terminalInstances Map, active session per project                                                                     | createSession, closeSession, setActiveSessionForProject                                                           |
| `settings.store.ts`      | globalSettings, workspaceSettings Map, resolvedTheme                                                                                | loadSettings, updateGlobalTheme, resolveSettings                                                                  |
| `notification.store.ts`  | notifications[], unreadCount, panelOpen                                                                                             | addNotification, markRead, markAllRead, dismiss, togglePanel                                                      |
| `toast.store.ts`         | toasts[] (ephemeral queue)                                                                                                          | addToast, removeToast                                                                                             |
| `log.store.ts`           | logEntries[], console interceptor                                                                                                   | (entries added via installLogInterceptor); clearLogs                                                              |
| `metrics.store.ts`       | system CPU/memory/network, per-session process metrics                                                                              | enableGlobalMetrics, disableGlobalMetrics, trackSession                                                           |
| `extensions/registry.ts` | extension registration maps (sidebarPanels, globalTabs, workspaceTabs, commands, overlays); activeGlobalTabId, activeWorkspaceTabId | registerGlobalTab, registerWorkspaceTab, registerCommand, togglePanel, setActiveProjectTab, setActiveWorkspaceTab |

All store actions are async — they call IPC first, then update local state only on success.

### Notification Model

Two distinct notification systems exist and are intentionally complementary:

- **In-app notification center** (`notification.store.ts` + `notifications:*` IPC, plural): persisted notifications shown in the bell-icon panel. Survives OS notification mute settings.
- **Native OS notification** (`notification.show` IPC, singular): fires a system-level desktop alert for immediate attention when a terminal session needs attention (bell event).

When a bell event fires in a backgrounded terminal session, both systems are triggered: `window.electronAPI.notification.show` (OS) and `useNotificationStore.getState().addNotification` (in-app). This ensures the user sees the signal regardless of OS notification preferences.

---

## Remote Control Server

When enabled via Settings → Remote Control, Terminator starts an embedded [Fastify](https://fastify.dev/) 4.x HTTP/WebSocket server bound to `127.0.0.1` (never `0.0.0.0`).

```
Remote Control Extension (extensions/remote-control/)
│
├── RemoteServer (Fastify 4.x, 127.0.0.1 only)
│   ├── GET    /health                         → { ok: true }
│   ├── GET    /api/workspaces                 → workspace list
│   ├── GET    /api/projects?workspaceId=      → project list
│   ├── POST   /api/terminals                  → spawn PTY, returns sessionId
│   ├── GET    /api/terminals/:id              → session metadata
│   ├── DELETE /api/terminals/:id              → kill PTY
│   ├── POST   /api/terminals/:id/resize       → resize PTY
│   ├── POST   /api/terminals/:id/ws-ticket    → single-use WS ticket (30s TTL)
│   ├── GET    /ws/terminals/:id?ticket=       → WebSocket upgrade → PTY fan-out
│   ├── POST   /api/bridge-ticket              → single-use bridge WS ticket
│   ├── GET    /api/bridge?ticket=             → WebSocket IPC bridge (invoke/send/subscribe)
│   ├── POST   /api/app-ticket                 → single-use ticket to enter /app/
│   └── GET    /app/?t=<ticket>                → serves full Electron renderer SPA (session-cookie-gated)
│       Static /app/*                          → 403 unless valid app-session cookie present (8h HttpOnly)
│
├── WsTicketStore        single-use 64-char hex tokens, 30s TTL, 60s cleanup
├── WsSubscriberManager  per-session subscriber sets; first subscriber = primary
│                        primary-only input, broadcast output to all
└── NgrokManager         spawns `ngrok http <port> --web-addr 0.0.0.0:4041`, polls localhost:4041/api/tunnels
```

**Security constraints**:

- Server binds to `127.0.0.1` only. External clients must reach it via ngrok or LAN (port forwarding).
- All routes (except `/health`) require `Authorization: Bearer <password>` validated with `bcryptjs.compare()` (async, work factor 10).
- `Host` header is checked against `localhost`, `127.0.0.1`, and the ngrok domain.
- WebSocket upgrade requires a single-use ticket issued by `POST /api/terminals/:id/ws-ticket`; ticket is consumed on first use and expires after 30 s.
- Input is accepted from the primary subscriber only (first WS client to connect to a session).
- `/app/*` static assets are gated behind an `app-session` HttpOnly SameSite=Strict cookie (8h TTL) issued when a valid one-time app-ticket (`POST /api/app-ticket`) is consumed at `GET /app/`. Requests to any `/app/*` path without a valid cookie receive `403 FORBIDDEN`.
- The IPC bridge (`GET /api/bridge`) requires a single-use bridge ticket and lets the browser invoke/send/subscribe to IPC channels on behalf of the browser-side SPA.

**Browser login SPA** (`src/renderer-remote/`): A separate Vite build (`npm run build:remote`) produces `out/renderer-remote/` which Fastify serves at `/`. After password authentication the login page calls `POST /api/app-ticket` and redirects to `/app/?t=<ticket>` to load the full Electron renderer bundle.

**Full Electron renderer in browser** (`out/renderer/`): Fastify also serves the regular Electron renderer bundle under `/app/`. A `remote-shim.js` script is injected into `index.html` to polyfill `window.electronAPI` — all IPC calls are forwarded over the bridge WebSocket instead of the Electron `contextBridge`.

See [ADR-017](adr/017-embedded-http-remote-server.md) for the architectural decision.

---

## Security Model

- `contextIsolation: true` — renderer cannot access Node.js APIs directly.
- `nodeIntegration: false` — renderer script cannot `require()` Node modules.
- All user input that crosses the IPC boundary is Zod-validated before use.
- Extensions are loaded via `require()` in the main process — they run with full Node.js privileges. Phase 1 does not sandbox extensions. This is a known limitation documented for Phase 2 consideration (see ADR-002).
- Reserved keyboard shortcuts are enforced in both preload.ts (renderer guard) and the extension API (main process throw).

---

## Navigation Chrome — UnifiedSidebar

The primary navigation is a single resizable sidebar (`UnifiedSidebar`) replacing the old two-column WorkspaceRail + ProjectsPanel layout.

### Component hierarchy

```
UnifiedSidebar (src/renderer/components/sidebar/UnifiedSidebar.tsx)
├── SidebarHeader — search placeholder + global tab icons (scrolls horizontally when
│                   many global tabs registered; bell + add button stay pinned right)
│                   + "+ workspace" button
├── [workspace list] — draggable wrappers around WorkspaceCard components
│   └── WorkspaceCard — color-coded card per workspace
│       ├── ws-card__band — 3px left color bar (background: var(--ws-color))
│       ├── ws-card__header — click toggles collapse; right-click shows ctx menu
│       │   └── workspace tab icons — hover-reveal icons from registerWorkspaceTab()
│       │         clicking one sets activeWorkspaceTabId and clears global/project tabs
│       └── ws-card__projects — collapsible list of ProjectRow + ExtensionFooter
│           └── ProjectRow — project name, branch chip, inline rename, session expansion
│               └── SessionRow — per-session status dot/spinner/bell + inline rename
│                     clicking a session also clears activeWorkspaceTabId (shows terminal)
└── ScratchSection — pinned scratch terminal sessions at the bottom
```

### Tab activation mutual-exclusion

Three tab layers compete for the main content area. Only one is active at a time:

| Layer         | Registry state         | Activated by                                           | Cleared by                                             |
| ------------- | ---------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Global tab    | `activeGlobalTabId`    | Clicking an icon in `SidebarHeader`                    | Activating workspace/project tab, clicking any session |
| Workspace tab | `activeWorkspaceTabId` | Clicking a hover-reveal icon in `WorkspaceCard` header | Activating global/project tab, clicking any session    |
| Project tab   | `activeProjectTabId`   | Clicking a tab in the project view tab bar             | Activating global/workspace tab                        |

### Color propagation

Each workspace has a `color` field (hex string). The `WorkspaceCard` sets `style={{ '--ws-color': workspace.color }}` on its root element. All descendant CSS rules (`ProjectRow`, `SessionRow`, etc.) inherit `var(--ws-color)` for accent colors, tinted backgrounds, and border highlights without any prop drilling.

### Collapse persistence

`useWorkspaceStore` maintains `expandedWorkspaceIds: Set<string>` initialized from `localStorage` key `terminator.workspace.expanded` (JSON array). `toggleWorkspaceCollapse(id)` updates the set and writes back to localStorage. `setExpandedWorkspaceIds(ids)` replaces the entire set (used by `⌘1–9` to expand one workspace and collapse all others).

### Resize

The sidebar has a `div.unified-sidebar__resize-handle` on its right edge. `mousedown` on it starts a document-level `mousemove`/`mouseup` drag. During drag, `widthRef` (a `useRef`) tracks the pixel delta; the sidebar's inline `style.width` is updated directly on each frame to avoid re-renders. On `mouseup`, the value is clamped to `[200, 480]` and committed via `useState` and written to `localStorage` key `terminator.sidebar.width`. Double-click snaps to `260px` (default).

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

- **db.ts** — Initialises the SQLite database at `.todo/vault.db`, applies schema migrations (WAL mode, FK enforcement), and exports `getDb()` / `initDb()` / `closeDb()`. Runs `backfillRecurringTasks` on startup to gap-fill any missing future occurrences. All IPC handlers access data exclusively through this layer.
- **recurrence.ts** — `RecurrenceRule` discriminated union, `parseRecurrenceRule` (throws `InvalidRecurrenceRuleError` on unknown input), `serializeRecurrenceRule`, and `computeNextDueDate` (strict mode: next date = previous + interval, never completion date). Also exports `localDate()` helper.
- **ensure-next-occurrence.ts** — `ensureNextOccurrence(db, taskId)`: idempotent function that checks whether a future `status='open'` instance already exists and inserts one if not. `backfillRecurringTasks(db)`: called from `initDb` to handle days the app was closed.
- **tags.ts** — Utilities for extracting and normalising `@context`, `+project`, `#area`, and `due:` inline tags from task text.
- **types.ts** — `TaskStatus`, `IndexedTask`, `IndexedProject`, `KanbanConfig`, and other shared TypeScript types used by both the IPC layer and renderer components.

### IPC Layer (`src/ipc/`)

- **vault.ipc.ts** — All vault CRUD handlers. Core task handlers: `capture`, `get-today`, `get-daily`, `add-task`, `add-subtask`, `edit-task`, `delete-task`, `complete-task`, `cancel-task`, `restore-task`, `reopen-task`, `migrate-task`, `block-task`, `unblock-task`, `reorder-tasks`. Recurrence handlers: `set-recurrence`, `clear-recurrence`. View/query handlers: `query`, `process-inbox-item`, `get-inbox`, `list-areas`, `archive-area`, `delete-area`, `create-area`, `list-archive`, `list-someday`, `someday-to-today`, `get-calendar-month`. Detail handlers: `get-task-detail`, `save-task-detail`. Bulk I/O: `export-json`, `import-json`. All handlers validate with Zod; stale IDs return `{ error: 'STALE_ID' }`.
- **projects.ipc.ts** — project list, update-project-status, and weekly-review payload handler.
- **links.ipc.ts** — bidirectional link handlers (create/remove/get-for-terminator-target).

### MCP Sidecar

The MCP stdio sidecar (`src/mcp/server.ts`) was present in earlier Task Vault versions and has since been removed from the codebase. The `extensions/task-vault/src/mcp/` directory no longer exists. AI agent access to vault data is now achieved through the extension's IPC handlers called from the in-app renderer, not a standalone MCP process.

### Recurring Task Engine

Recurrence state lives in three first-class SQL columns on the `tasks` table (not in the metadata blob):

| Column                   | Format                                                               | Purpose                                                         |
| ------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| `recurrence_rule`        | `'daily'` \| `'weekly:1,3'` \| `'biweekly'` \| `'monthly'` \| `NULL` | The recurrence interval; weekly days encoded in the rule string |
| `recurrence_template_id` | UUID FK → `tasks(id)`                                                | Links every spawned instance back to its origin (template) task |
| `recurrence_notify_at`   | `'HH:MM'` \| `NULL`                                                  | Per-task notification time override                             |

End conditions (`recurrence_end_type`, `recurrence_end_date`, `recurrence_end_count`, `recurrence_completed_count`) remain in the `metadata` JSON blob because they are configuration, not runtime state.

**Core invariant:** for every recurring task, exactly one `status='open'` future instance exists in the database. This invariant is enforced by `ensureNextOccurrence(db, taskId)` — a single idempotent function in `src/vault/ensure-next-occurrence.ts`.

**Trigger points** (the only places that create new occurrence rows):

1. `initDb` — startup gap-fill via `backfillRecurringTasks`. Handles days the app was closed.
2. `task-vault:vault:complete-task` IPC handler — completes the current task and calls `ensureNextOccurrence` in the same SQLite transaction.
3. `task-vault:vault:set-recurrence` IPC handler — sets the rule and immediately materialises the first future instance.

**The notification scheduler (`task-scheduler.ts`) is notification-only.** It reads the `recurrence_notify_at` column to determine per-task alert times but never inserts task rows.

**Strict recurrence mode:** next `due_date` is always `previous_due_date + interval`, regardless of completion date (e.g., a weekly Monday task completed on Wednesday still recurs next Monday).

A `UNIQUE INDEX` on `(recurrence_template_id, due_date)` enforces the invariant at the database level, preventing duplicate instances even under concurrent writes.

### Task ID Format

Tasks are identified by a UUID (`crypto.randomUUID()`) assigned at insert time and stored in the `tasks.id` column. IDs are stable across restarts. `{ error: 'STALE_ID' }` is returned when a handler receives an ID that no longer exists in the database (e.g. after a delete or migration).

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
