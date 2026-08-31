# Architecture: Terminator

**Version**: 0.1.68 | **Updated**: 2026-06-22 | **Electron**: 42.4.1 (upgraded from 30.4.0 via node-pty 1.2.x NAPI migration — ADR-021 resolved)

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

All renderer-to-main communication goes through `window.electronAPI`. The surface is declared once as a channel manifest (`src/shared/electron-api/manifest.ts`) — each method's channel, kind (invoke/send/event), payload mapping, and remote behavior — and both adapters are generated from it: `src/main/preload.ts` (native, `contextBridge` over `ipcRenderer`) and `src/renderer-remote/electron-api-shim.ts` (browser, WebSocket bridge). The manifest also derives the core remote allowlist (see [ADR-023](adr/023-channel-manifest-and-declared-remote-access.md)). Every IPC payload is validated with Zod at both ends.

On the main-process side, every channel registers through `src/main/ipc/channel-registrar.ts` (core code) or `api.ipc.registerHandler` (extensions); registration records the channel and its remote-access declaration in the bridge registry — `ipcMain` is never monkey-patched. Terminal session state lives solely in `PtyManager` (see [ADR-024](adr/024-ptymanager-session-authority.md)).

### Channel namespaces

| Namespace        | Direction        | Description                                                                                                                          |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `terminal:*`     | renderer ↔ main | PTY lifecycle: create, close, input, output, resize, cleanup                                                                         |
| `workspace:*`    | renderer → main  | Workspace and project CRUD                                                                                                           |
| `project:*`      | renderer → main  | Project CRUD (scoped under workspace)                                                                                                |
| `settings:*`     | renderer → main  | Global and per-workspace settings                                                                                                    |
| `dialog:*`       | renderer → main  | Native OS dialogs (folder picker)                                                                                                    |
| `extension:*`    | renderer → main  | Extension install, toggle, contribution queries                                                                                      |
| `git:*`          | renderer → main  | Git status, diff, stage, unstage, commit, PR status/create                                                                           |
| `github:*`       | renderer → main  | PR review queue, diff, file metrics, inline comments, submit, session persistence, active-review tracking, prune closed/merged       |
| `shell:exec`     | renderer → main  | Sandboxed shell execution (git/gh only, CWD scoped)                                                                                  |
| `fs:*`           | renderer ↔ main | File watch start/stop; `fs:read-file`; `fs:changed` push events                                                                      |
| `remote:*`       | main ↔ renderer | Remote control server: `remote:status` (main→renderer), `remote:tunnel-reconnect` (renderer→main), `remote:update-password` (invoke) |
| `log:push`       | main → renderer  | Forwards main-process log entries to renderer LogWindow                                                                              |
| `integrations:*` | renderer ↔ main | Issue trackers: connection status, connect/disconnect, issue list/search/get/comment, project↔issue links, agent-context preview    |

Full channel specifications: [`specs/001-extension-first-terminal/contracts/ipc-channels.md`](../specs/001-extension-first-terminal/contracts/ipc-channels.md),
[`specs/002-git-github-integration/contracts/ipc-channels-git.md`](../specs/002-git-github-integration/contracts/ipc-channels-git.md),
[`specs/003-pr-review/contracts/ipc-channels-pr-review.md`](../specs/003-pr-review/contracts/ipc-channels-pr-review.md),
and [`specs/031-linear-project-integration/contracts/ipc-channels.md`](../specs/031-linear-project-integration/contracts/ipc-channels.md).

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

| Entity                    | Stored? | Where                                                 |
| ------------------------- | ------- | ----------------------------------------------------- |
| Workspace, Project        | Yes     | electron-store (`workspaces.json`)                    |
| GlobalSettings            | Yes     | electron-store (`settings.json`)                      |
| WorkspaceSettings         | Yes     | electron-store (`settings.json`)                      |
| Extension registry        | Yes     | electron-store (`extensions.json`)                    |
| TerminalSession metadata  | No      | In-memory (Zustand)                                   |
| xterm.js buffer           | No      | In-memory (xterm.js Terminal instance)                |
| PTY process               | No      | OS process (killed on tab close or app quit)          |
| Tracker credentials       | Yes     | `safeStorage`-encrypted (`integrations.json`)         |
| Tracker connection config | Yes     | Plaintext beside the credential (`integrations.json`) |

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
      │           api.notifications.showToast()     → notificationManager (settings-resolved targets, v1.1.0)
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

### Webview Renderer System (v2.0.0)

Extension UIs run in isolated Electron `WebContentsView` instances — separate browser contexts completely isolated from the host renderer. This eliminates the dual-React-instance problem and decouples extension rendering from the core app build.

```
Host Renderer (React)
│
├─ ExtensionPanelPortal (layout placeholder)
│    │  reports bounds via extension:update-panel-bounds IPC
│    ▼
│  ExtensionViewHost (Main Process)
│    │  creates / positions WebContentsView over placeholder bounds
│    ▼
│  WebContentsView (isolated browser context)
│    │  loads ext://extension-id/dist/index.html
│    │  has its own preload (dist-electron/preload/webview.js)
│    ▼
│  Extension Renderer (any framework, any React version)
│    │  window.electronAPI.extensionBridge.invoke(channel, payload)
│    │  window.electronAPI.extensionBridge.on(channel, handler)
```

**Key properties:**

- Extension bundle is never imported into the host renderer — complete isolation.
- Extensions can use any React version, any framework, any bundler.
- `ext://` protocol serves files from the extension directory with `Cache-Control: no-store`.
- Reload (no app rebuild): `extension:renderer-reload` push event triggers webview remount.
- Workspace context passed as URL params: `?view=VALUE&repoRoot=PATH`.
- Live workspace updates via `extensionBridge.on('workspace:changed', handler)`.

**Manifest `contributes`** — the only mechanism for declaring UI surfaces:

```json
{
  "renderer": "dist/index.html",
  "contributes": {
    "globalTab": { "label": "My Tool", "icon": "wrench", "view": "main" },
    "sidebarPanel": { "label": "Panel", "defaultOpen": false, "view": "sidebar" },
    "projectTab": { "label": "Proj", "view": "project" },
    "workspaceTab": { "label": "WS", "icon": "layers", "view": "workspace" },
    "windowViews": [{ "id": "my-detail", "view": "detail" }],
    "commands": [{ "id": "my-ext:action", "label": "Do Thing", "shortcut": "CmdOrCtrl+Shift+M" }]
  }
}
```

See [ADR-022](adr/022-webview-isolated-extension-renderer.md) for the full decision record.

### Escape-to-terminal exit

Pressing `Esc` twice within 500 ms inside any extension surface returns the user to the terminal session they were last in. Because an extension view is its own `webContents`, the gesture is detected in two places and converges on one action:

```
Extension WebContentsView            Host renderer chrome
  preload-webview.ts keydown           useExtensionEscapeExit keydown
    │ extension:request-exit                    │
    ▼                                           │
  routeExtensionExitRequest (main)              │
    │  attributes sender → { extensionId, viewParam }
    │  focuses main renderer                    │
    │ extension:exit-to-terminal                │
    ▼                                           ▼
        registry.exitExtensionToTerminal(sidebarPanelId?)
          sidebar panel → togglePanel
          otherwise     → clear global/workspace/project tab
                          → focusActiveTerminal()
```

The listeners are passive and bubble-phase, so an extension's own single-`Esc` dismissals are untouched. Core surfaces (`core.*` ids) are never exited, the host-side listener stands down inside a terminal, a text field, or an open modal, and remote `/app/` clients get the same gesture through a same-origin listener on the extension iframe. See [ADR-026](adr/026-double-escape-extension-exit.md).

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

Every notification — core app or extension-originated — goes through one
main-process dispatcher, `notificationManager.create()`
(`src/main/notifications/notification-manager.ts`). Callers never choose the
delivery mechanism: `create()` always resolves it via
`resolveNotificationTargets()` (`src/shared/notifications/`) against the
user's global notification settings (Settings → Notifications), with an
optional per-extension override taking precedence. A notification's type
(`error`) always forces a toast into the resolved set regardless of
configuration, so failures can't be silently muted.

Delivery targets, any combination of:

- **System** — a native OS desktop notification (+ critical dock bounce on macOS).
- **Center** (`notification.store.ts` + `notifications:*` IPC): a persisted entry in the bell-icon panel, surviving reload and OS notification mute settings.
- **Toast** (`toast.store.ts`): an ephemeral in-window banner.

The renderer never decides this either: core-renderer code calls
`dispatchNotification()` (`src/renderer/lib/notifications.ts`), which just
forwards to `notifications:create` over IPC; the existing
`notifications:push` listener in `App.tsx` renders whatever the resolved
notification's `targets` say (adding to the center store and/or firing a
toast). Extensions call `api.notifications.showToast()` /
`createNotification()`, both of which resolve identically through the same
dispatcher.

**Acting on a notification settles it.** `triggerAction()` runs the callback and
then drops the record: one that survives the decision it asked for — approve a
phase and the request to approve that phase is still sitting there — teaches
people to dismiss without reading. The one exception is the reserved
`__open__` action behind `onClick`, which takes you to what the notification is
about and leaves the row alone, because looking is not deciding.

**A notification's destination is a handler, not a route.** Only its author
knows what "the thing" is — a card, a task, a review — and a route shape
general enough to name all of them would be a second navigation system. Since a
function cannot cross IPC it lives in main under that reserved action, and the
serialized notification carries only `clickable: true` so the panel knows to
render the row as a link.

**The notification drawer reserves a strip rather than hiding what is under
it.** An extension's UI is a native `WebContentsView` painting above the
renderer's DOM, so anything drawn over it is invisible; the general answer is
`useModalEffect()`, which hides every extension view while a modal is open.
That is right for a centred dialog and wrong for a drawer down one edge — it
blanked the whole application to show a 340px panel. The drawer measures itself
and calls `extension.setLeftInset()`, the left-edge counterpart of the log
window's `setBottomInset()`: the view moves aside and narrows instead of
disappearing.

---

## Issue Tracker Integrations

One core-owned service reaches Linear and Jira; nothing else in the application holds a tracker
credential or contacts a tracker. See [ADR-029](adr/029-core-issue-tracker-service.md).

```
  renderer ──integrations:*──▶ ┌────────────────────────────────────────┐
   (settings, sidebar,         │  src/main/integrations/                │
    dialogs, drawer)           │    tracker-store    creds (safeStorage)│
                               │    issue-service    cache, single-     │──▶ Linear (@linear/sdk)
  extensions ──api.issues────▶ │                     flight, backoff    │──▶ Jira (REST v3)
   (speckit-pilot,             │    providers/       one per tracker    │
    git-integration)           │    adf-to-markdown  Jira ADF → md      │
                               └────────────────────────────────────────┘
```

**The credential boundary.** Secrets live in `integrations.json`, each value encrypted with
`safeStorage`, written atomically. They are read only by a provider, inside the main process. No
IPC channel returns one; `integrations:status` reports whether a connection exists and which
account it proved to belong to, never the secret itself. `integrations:connect` and
`integrations:disconnect` are the only two core channels deliberately **omitted** from the remote
bridge — an authenticated LAN client still has no business writing the operator's API keys.

**One issue shape.** Both trackers produce the same `Issue`, identified by the pair
(`tracker`, `key`) because two trackers may both use `TAV-42`. Descriptions and comments are
always markdown: Jira's Atlassian Document Format is converted inside its provider, so exactly one
renderer and one sanitisation policy exist downstream.

**Policy lives in the facade.** Providers are stateless functions over a credential. The 5-minute
TTL cache, single-flight, cross-tracker merge and rate-limit backoff are all in `issue-service.ts`,
so both trackers behave identically and a third would too. A failing or unconnected tracker is
reported in `failures` rather than silently dropped — an incomplete list must never read as an
empty one.

**Comments are the only write.** The provider interface exposes no way to change an issue's state,
assignee or any other field, and a test asserts the shape of that surface so it stays true.

---

## Remote Control Server

When enabled via Settings → Remote Control, Terminator starts an embedded [Fastify](https://fastify.dev/) 5.x HTTP/WebSocket server. The server binds to `0.0.0.0` so it is reachable directly over the LAN (the `remote:status` payload reports both a `lanUrl` and an optional ngrok `publicUrl`). Access is gated by per-request password/Bearer auth, a `Host`-header check, and single-use tickets — not by the bind address.

```
Remote Control Extension (extensions/remote-control/)
│
├── RemoteServer (Fastify 5.x, binds 0.0.0.0 — LAN + ngrok)
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
│   ├── GET    /api/bridge?ticket=             → WebSocket IPC bridge (invoke/send/subscribe;
│   │                                            invoke is rejected unless the channel is
│   │                                            flagged remote-accessible)
│   ├── POST   /api/app-ticket                 → single-use ticket to enter /app/
│   ├── GET    /app/?t=<ticket>                → serves full Electron renderer SPA (session-cookie-gated)
│   │   Static /app/*                          → 403 unless valid app-session cookie present (8h HttpOnly)
│   ├── POST   /api/mobile-ticket              → single-use ticket to enter /mobile/
│   └── GET    /mobile/?t=<ticket>             → serves the mobile remote web client (session-cookie-gated)
│       Static /mobile/*                       → 403 unless valid mobile-session cookie present (8h HttpOnly)
│
├── WsTicketStore        single-use 64-char hex tokens, 30s TTL, 60s cleanup
├── WsSubscriberManager  per-session subscriber sets; first subscriber = primary
│                        primary-only input, broadcast output to all
└── NgrokManager         spawns `ngrok http <port> --web-addr 0.0.0.0:4041`, polls localhost:4041/api/tunnels
```

**Security constraints**:

- Server binds to `0.0.0.0` so phones/tablets on the same LAN can connect directly; remote (off-LAN) access is via ngrok. Security relies on auth, the `Host`-header check, per-IP rate limiting, and tickets rather than the bind address. See [ADR-017](adr/017-embedded-http-remote-server.md) § Threat Model & Accepted Risk.
- All routes (except `/health`) require `Authorization: Bearer <password>` validated with `bcryptjs.compare()` (async, work factor 10).
- Failed password attempts are rate-limited per client IP (`auth-rate-limiter.ts`): after 10 failures within 15 minutes the client is locked out (`429`) until the window drains. This is what makes a single shared password tolerable on a `0.0.0.0`-bound listener.
- `Host` header is checked against `localhost`, `127.0.0.1`, RFC-1918 private ranges, and the ngrok domain.
- WebSocket upgrade requires a single-use ticket issued by `POST /api/terminals/:id/ws-ticket`; ticket is consumed on first use and expires after 30 s.
- Input is accepted from the primary subscriber only (first WS client to connect to a session).
- `/app/*` and `/mobile/*` static assets are each gated behind a dedicated HttpOnly SameSite=Strict cookie (`app-session` / `mobile-session`, 8h TTL) issued when a valid one-time ticket (`POST /api/app-ticket` / `POST /api/mobile-ticket`) is consumed at `GET /app/` / `GET /mobile/`. Requests to those paths without a valid cookie receive `403 FORBIDDEN`. Session tokens carry an expiry and are purged hourly.
- The IPC bridge (`GET /api/bridge`) requires a single-use bridge ticket and lets the browser invoke/send/subscribe to IPC channels on behalf of the browser-side SPA. The bridge is **default-deny across all three message types** (`invoke`, `send`, `subscribe`): a message is rejected unless its channel is in the central allowlist `src/main/remote/remote-accessible-channels.ts` (surfaced to the extension via `api.ipc.isRemoteAccessible`). That file is the single auditable definition of the remote attack surface, and `remote-accessible-channels.spec.ts` asserts it stays in sync with the channels the `/app/` shim actually uses — so the enforcement and the allowlist can never half-ship independently (the prior `/app/` outage).

**Browser login SPA + mobile client** (`src/renderer-remote/`): A separate Vite build (`npm run build:remote`) produces `out/renderer-remote/` which Fastify serves at `/`. After password authentication the login page either calls `POST /api/app-ticket` and redirects to `/app/?t=<ticket>` to load the full Electron renderer bundle, or calls `POST /api/mobile-ticket` and redirects to `/mobile/?t=<ticket>` to load the touch-optimised mobile client (`mobile.html` from the same renderer-remote output directory).

**Full Electron renderer in browser** (`out/renderer/`): Fastify also serves the regular Electron renderer bundle under `/app/`. A `remote-shim.js` script is injected into `index.html` to polyfill `window.electronAPI` — all IPC calls are forwarded over the bridge WebSocket instead of the Electron `contextBridge`.

See [ADR-017](adr/017-embedded-http-remote-server.md) for the architectural decision.

---

## Security Model

- `contextIsolation: true` — renderer cannot access Node.js APIs directly.
- `nodeIntegration: false` — renderer script cannot `require()` Node modules.
- All user input that crosses the IPC boundary is Zod-validated before use.
- Extensions are loaded via `require()` in the main process — they run with full Node.js privileges. Phase 1 does not sandbox extensions. This is a known limitation documented for Phase 2 consideration (see ADR-002).
- Reserved keyboard shortcuts are enforced in both preload.ts (renderer guard) and the extension API (main process throw).
- The remote-control bridge is default-deny: only channels in `src/main/remote/remote-accessible-channels.ts` are reachable from any browser client. Internal channels (`dialog:*`, `remote:*` server controls, `db:health`, all extension-registered handlers) are unreachable remotely by default.

---

## Navigation Chrome — UnifiedSidebar

The primary navigation is a single resizable sidebar (`UnifiedSidebar`) replacing the old two-column WorkspaceRail + ProjectsPanel layout.

### Component hierarchy

```
UnifiedSidebar (src/renderer/components/sidebar/UnifiedSidebar.tsx)
├── SidebarHeader
│   ├── AppBand — every app-level surface in one labelled band: core's Overview, the
│   │     `contributes.globalTab` entries from extension manifests, and the items from
│   │     api.sidebar.registerItem(). Icon plus visible label, accessible name, keyboard
│   │     focus order. Both contribution contracts are unchanged — only the render
│   │     target merged (ADR 033). Replaces the old unlabelled icon strip and the
│   │     deleted ExtensionFooter.
│   └── search row — search, notification bell, "+ repo". These act on the list below,
│         not on the apps above, which is why they sit here and not in the band.
├── ViewBar — saved-view chips, group-by / sort menus, hide-stale toggle
├── FilterNotice — "showing N of M · show all"; rendered only while something is hidden
├── [group list] — SessionGroup per group returned by buildGroups()
│   └── SessionGroup — the scope-bearing header. When the grouping key is a project or
│       │             workspace this header IS the row the old tree had, and hosts
│       │             everything it hosted.
│       ├── chevron / branch glyph (GitFork for a worktree, GitBranch for a plain
│       │     checkout) / branch name / worktree tag / workspace name (branch headers
│       │     outside workspace grouping) / repo folder path (repo headers) /
│       │     busy aggregate / change statistics / count / + new terminal
│       ├── workspace tab icons — hover-reveal icons from registerWorkspaceTab(),
│       │     rendered on each workspace's FIRST group so they appear once per
│       │     workspace rather than once per project
│       ├── SessionGroup[] — under workspace grouping only: one nested project group
│       │     per project of that workspace, rendered by the same component so a
│       │     project keeps its header actions without changing the grouping
│       ├── BranchSwitcher (branch groups only)
│       └── SessionRow[] — state glyph / spinner / bell, relative activity, optional
│             note, branch badge (which opens ScopeMenu when the header does not
│             already name the branch), and a needs-you edge bar + pill.
│             The glyph is one of four lucide components chosen by session state
│             (Play / Circle / Pause / CircleX); selection is the row's own surface.
│             The two were the same dot until 032 — see below.
├── scratch group — scratch sessions as an ordinary group with a count, not a pinned
│     footer with its own vocabulary
└── bulk bar — selection count + Close selected (Stale view only)
```

### The view-model layer

`src/renderer/sidebar/` holds the pure core: `view-model.ts` (`buildGroups`, `isStale`),
`views.ts` (built-in views as data + persistence — Everything, the default view, groups
by workspace), `agent-state.ts`, `session-status.ts` (state → glyph/label, total over
`AgentState`), `branch-display.ts` (`displayName`, `abbreviatePath`,
`qualifiedBranchLabel`), `collapse-state.ts`, and `relative-time.ts`.

### Change statistics sit beside the pure layer, not in it

`src/renderer/stores/change-stats.store.ts` holds each branch's `+n/−m`, keyed by branch
id, with a 15-second TTL and an injected clock. It is deliberately **not** a field on the
`Project` record: putting it there would make `buildGroups` a function of when git last
answered, which breaks the determinism the whole pure layer depends on. `ensure()` returns
`void`, so a component cannot await git during render, and a branch whose statistics are
missing or errored simply draws none. See ADR 031.

### Vocabulary: the product says "branch", the code says `Project`

The object between a repo and a session is a branch. Every user-visible string says so;
the stored entity, its IPC channels and the `api.project.*` Extension API keep the name
`Project`, because renaming them would break installed extensions and require a data
migration for no user-visible gain. A lint rule on `src/renderer/components/**` fails the
build if "project" reaches JSX text, a `label:` value, or a `placeholder`/`title`/
`aria-label`. See ADR 032.

**These modules import nothing but types.** No React, no store, no `Date.now()` — `now`
is always a parameter. That physical separation is the point: it makes the whole
"what is shown" decision a pure function of `(sessions, projects, workspaces, view, now,
staleAfterMs)`, exhaustively testable without a DOM, and it keeps the layout reversible.
The components above are a thin rendering of whatever `buildGroups` returns.

`buildGroups` applies a fixed, observable order: filter → group → sort within each group
→ sort the groups. `shown` and `total` come back with the groups, which is what
`FilterNotice` reads.

Session recency and state are renderer-only view state on `TerminalSession`
(`lastActivityAt`, `lastAttendedAt`, `agentState`, `note`), following the existing
`bellCount` / `busy` convention. Sessions are not persisted, so there is no schema
change and nothing to migrate. Activity stamping is throttled to at most one store write
per session per second in `session-controller.ts` — `onBusy` fires on every PTY output
chunk, and the store stays a plain reducer with no timing logic of its own.

### Tab activation mutual-exclusion

Three tab layers compete for the main content area. Only one is active at a time:

| Layer         | Registry state         | Activated by                                                                                       | Cleared by                                             |
| ------------- | ---------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Global tab    | `activeGlobalTabId`    | Clicking an icon in `SidebarHeader`                                                                | Activating workspace/project tab, clicking any session |
| Workspace tab | `activeWorkspaceTabId` | Clicking a hover-reveal icon on a `SessionGroup` header, or the same action in a row's `ScopeMenu` | Activating global/project tab, clicking any session    |
| Project tab   | `activeProjectTabId`   | Clicking a tab in the project view tab bar                                                         | Activating global/workspace tab                        |

### Color propagation

Each workspace has a `color` field (hex string). `SessionGroup` sets `style={{ '--ws-color': workspace.color }}` on its root element. All descendant CSS rules (`SessionRow`, etc.) inherit `var(--ws-color)` for accent colors, tinted backgrounds, and border highlights without any prop drilling.

`SessionRow` also sets `--ws-color` on its own root, from a `workspaceColor` prop `UnifiedSidebar` resolves through the session's project (`workspaceColorForSession`). Inheritance alone is not enough: under `status`, `branch` or `none` grouping a group spans workspaces, so its header has no colour to hand down.

The colour is spent as muted `color-mix` washes — the group header, and a session row's hover and selected states — plus left-edge rails on the header and every row. Every mix spells its fallback as `var(--ws-color, transparent)`: a group with no workspace (a status bucket, Scratch) sets no `--ws-color` at all, and an unresolved custom property makes the _whole_ declaration invalid at computed-value time rather than just that term, which would leave the surface with no background. `tests/unit/renderer/sidebar-workspace-tint.spec.ts` reads the real CSS and asserts both the fallback and that each wash is shallow enough to keep the text on it at WCAG AA for all ten preset colours in both themes.

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

The task-vault extension (`extensions/task-vault/`) implements a GTD+BuJo+PARA productivity system. Markdown files are the human-editable source of truth for daily logs; the shared **PGlite (PostgreSQL-compatible WASM)** database is the primary datastore for all structured queries and CRUD. Key subsystems:

### Vault Layer (`src/vault/`)

- **db.ts** — Defines the `settings`, `tasks`, `projects`, `areas`, and `links` schema via `applyTaskVaultSchema()`, and manages incremental schema upgrades via `applyTaskVaultMigrations()`. All IPC handlers receive the shared `ExtensionDB` instance (injected by the main-process extension API) and access data exclusively through it. Runs `backfillRecurringTasks` on startup to gap-fill any missing future occurrences. **Note**: an upcoming migration will add `extension_id TEXT NOT NULL` to `settings` and enforce `PRIMARY KEY (extension_id, key)` for namespace isolation across extensions.
- **recurrence.ts** — `RecurrenceRule` discriminated union, `parseRecurrenceRule` (throws `InvalidRecurrenceRuleError` on unknown input), `serializeRecurrenceRule`, and `computeNextDueDate` (strict mode: next date = previous + interval, never completion date). Also exports `localDate()` helper.
- **ensure-next-occurrence.ts** — `ensureNextOccurrence(db, taskId)`: idempotent function that checks whether a future `status='open'` instance already exists and inserts one if not. `backfillRecurringTasks(db)`: called at extension startup to handle days the app was closed.
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

1. Extension startup — `applyTaskVaultMigrations` runs, then `backfillRecurringTasks`. Handles days the app was closed.
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

---

## Markdown Notepad Extension (`extensions/notepad/`)

See [ADR-018](adr/018-codemirror6-editor.md) for the editor engine decision.

### 3-Process Split

```
Main process (Node.js)
  └─ extensions/notepad/src/index.ts (activate/deactivate)
       ├─ PGlite (PostgreSQL) — shared app DB via src/main/db/index.ts (ExtensionDB interface)
       ├─ registerNotesIpcHandlers()    — notes.create/list/get/autosave/archive/restore/hardDelete/reorder
       ├─ registerTagsIpcHandlers()     — tags.list/rename/delete
       ├─ registerFoldersIpcHandlers()  — folders.create/list/rename/delete/move
       ├─ registerCommentsIpcHandlers() — comments.create/reply/update/delete/resolve/updateAnchor/markOrphaned/list
       ├─ registerSearchIpcHandlers()   — search.query (ILIKE-based full-text search)
       └─ registerExportIpcHandlers()   — export.pickFolder/export.run/import.run (notes + diagrams)

Renderer process (jsdom + React + CM6)
  └─ extensions/notepad/src/renderer.tsx
       ├─ NotepadView (main 3-pane layout)
       │    ├─ NoteList (sidebar: search bar, multi-tag dropdown, folder tree, note/diagram rows)
       │    ├─ NoteEditor (CM6 host: livePreviewPlugin + commentAnchorField)
       │    └─ .notepad-view__rail (right rail; collapses when both its panels are off)
       │         ├─ NoteOutline (the open note's headings, from editor/outline.ts)
       │         └─ CommentMargin (comment cards with anchor status)
       ├─ QuickCreateOverlay (Cmd+Shift+N floating input)
       ├─ ExportDialog (folder picker + scope selector; exports notes and diagrams)
       ├─ NoteWindowView (pop-out window for one note; same editor and right rail)
       └─ DiagramWindowView (pop-out window for focused diagram editing)
```

### Database Layer

Notes and diagrams are stored in the **shared PGlite (PostgreSQL-compatible) database** at `<userData>/app.pglite`. The notepad extension never manages its own database file; it receives an `ExtensionDB` instance (defined in `src/main/db/index.ts`) injected into every IPC handler at registration time. `ExtensionDB` wraps PGlite with a SQLite-compatible `?`-placeholder API via a positional converter, and exposes `exec`, `query`, `get`, `run`, and `transaction`. Nested `transaction()` calls automatically demote to PostgreSQL savepoints.

**Legacy migration**: on first launch after upgrading from a better-sqlite3 version, `src/main/db/migrate.ts` reads the old `notepad.db` / `vault.db` files via `sql.js` (WASM) and inserts the rows into PGlite. Migration is idempotent (skipped if the target tables are already populated).

**Search**: full-text search uses `ILIKE` (case-insensitive pattern match) rather than a dedicated FTS5 virtual table. Tag filters are applied in the same query via `EXISTS` subqueries. This simplifies the schema at the cost of FTS5 BM25 ranking — results are returned in `updated_at DESC` order. See [ADR-019](adr/019-ilike-search-over-fts5.md) for the trade-off rationale and the planned `pg_trgm` upgrade path.

### Data Flow

1. **Note create/autosave**: Renderer → `notes.autosave` IPC → PGlite `notes` table. Inline `#tag` parsing on autosave reconciles the `note_tags` join table via `reconcileTags()`.

2. **Search**: Renderer → `search.query` IPC → `ILIKE '%query%'` across `title` and `body`; `tag:foo` / `-tag:bar` tokens resolved to tag IDs before the main query.

3. **Folders**: Notes and diagrams each carry a nullable `folder_id` FK. `folders.create/rename/delete` manage the `folders` table; `notes.reorder` and `folders.move` update `sort_order` and `folder_id` respectively using an explicit `{ note: 'notes', diagram: 'diagrams' }` table map (never dynamic string interpolation).

4. **Comment anchoring lifecycle**:

   - Text selection → `CommentComposer` → `comments.create` IPC (stores `startOffset`, `endOffset`, `quote`, `prefix`, `suffix`)
   - On note load → `reanchorComment()` tries offset-first, falls back to text-quote search (W3C TextQuoteSelector pattern)
   - CM6 `commentAnchorField` (`StateField<CommentAnchor[]>`) remaps positions via `tr.changes.mapPos()` on every transaction
   - Orphaned anchors (collapsed or not found) surface in the "Orphaned" section of `CommentMargin`

5. **Export/Import**: `export.run` → `gray-matter` YAML frontmatter → `.md` files; diagrams exported as `.excalidraw.json`. Re-export matches existing files by frontmatter `id` (idempotent). `import.run` upserts by `id`. `STRING_AGG` (Postgres) aggregates tags in the export query.

### New IPC Channels (22 total)

Documented in `specs/010-markdown-notepad/contracts/ipc-channels.md` and typed in `src/renderer/electron.d.ts`.

---

## SpecKit Pilot Extension (`extensions/speckit-pilot/`)

SpecKit Pilot is a Quill-style **workflow board** for controlling feature implementation end-to-end when offloading to agents. The home surface is a kanban board of six stage columns (Backlog → Spec → Plan → Implement → In Review → Done); each unit of work is a **card**. A card is a feature dir (`specs/NNN-slug/`) with a brief (`.pilot/card.json`); handing it off runs the 10-phase Spec-Kit pipeline using Claude Code **in a visible terminal** in an isolated git worktree, with every tool call held at a `PreToolUse` hook until somebody decides (see [ADR-026](adr/026-supervised-runs-in-a-terminal.md)).

### Card model & board stages

A card unifies the former feature/ticket/run notions (see [ADR-010](adr/010-speckit-card-model.md)). `PilotState` is **v3**: it adds `card: CardBrief` and `stage: BoardStage`. A card can exist in **Backlog** with a brief and no run. The board stage is **derived** from phase progress by the pure `deriveStage(phases, run)` in `src/state/derive-stage.ts` (Backlog = no run; Spec = constitution/specify/clarify; Plan = plan/checklist; Implement = tasks/analyze/implement; In Review = self-review/open-pr; Done = PR opened or run completed). A v2→v3 migration synthesizes the brief and derives the stage on read.

### Parallel runs

Multiple cards run concurrently, each in its own worktree, up to a configurable `maxConcurrentRuns` cap (default 3; see [ADR-011](adr/011-speckit-parallel-runs.md)). Hand-off counts active run slots from persisted state; over the cap, a card is set `queuePosition: 'pending'` and started automatically by `advanceQueue` when a slot frees (run cancelled, parked to Backlog, or PR opened).

### 10-Phase Lifecycle

```
constitution → specify → clarify → plan → checklist → tasks → analyze → implement → self-review → open-pr
```

Each phase has a `PhaseState` (status: `locked | ready | running | awaiting_review | approved | stale | modified | failed | skipped`) persisted to `.pilot/state.json` inside the feature directory.

### Main-Process Architecture (`extensions/speckit-pilot/src/index.ts`)

```
activate(api)
  ├─ IPC handlers (via api.ipc.registerHandler)
  │    ├─ speckit:dispatch          → create worktree, branch, start phase runner
  │    ├─ speckit:pilot-state       → read .pilot/state.json, marking any approved
  │    │                              phase whose artifacts have changed since
  │    ├─ speckit:phase-approve     → persist approval + a hash of its artifacts,
  │    │                              start next phase runner
  │    ├─ speckit:phase-skip / -unskip → a phase this card does not need
  │    ├─ speckit:phase-request-changes → record feedback, re-queue runner
  │    ├─ speckit:phase-comment     → append history entry (no re-run)
  │    ├─ speckit:phase-revoke      → reset approved → ready
  │    ├─ speckit:checkin-decision  → batch continue / pause / split
  │    ├─ speckit:self-review-read  → read .pilot/self-review.json
  │    ├─ speckit:credentials-set   → store Linear/Jira keys in main-process secrets store
  │    ├─ speckit:credentials-status → return { connected: boolean } ONLY
  │    ├─ speckit:ticket-list       → fetch from Linear/Jira APIs
  │    ├─ speckit:open-pr           → run gh pr create subprocess
  │    ├─ speckit:card-list         → board data: CardSummary[] (brief + derived stage + phase summary)
  │    ├─ speckit:card-create       → create a native/ticket-seeded card in the backlog
  │    ├─ speckit:card-update       → edit a card's brief (.pilot/card.json)
  │    ├─ speckit:card-move         → Backlog→Spec handoff or park →Backlog (enforces concurrency cap)
  │    ├─ speckit:card-comment      → append steering comment (.pilot/comments.jsonl)
  │    ├─ speckit:comment-list      → load a card's comments
  │    ├─ speckit:artifact-list     → artifacts + git revision history
  │    ├─ speckit:knowledge-search  → keyword search over repo markdown + briefs (git grep, fs fallback)
  │    │
  │    ├─ speckit:permissions-list / -resolve / -hand-back → tool calls held at a PreToolUse hook
  │    ├─ speckit:supervision-snapshot → what is running, what is queued, whether the gate is open
  │    ├─ speckit:stalls-list        → firings, and whether they were recorded or surfaced
  │    ├─ speckit:feed-list / -digest → what happened, and what happened since you last looked
  │    ├─ speckit:review-hunks / -decide-hunk / -intent / -apply / -done → per-hunk review,
  │    │                                              applied by reverting the rejected hunks
  │    ├─ speckit:backpressure-override → recorded with the queue depth it ignored
  │    ├─ speckit:lanes / -may-merge  → merge ordering across a card's repositories
  │    └─ speckit:run-terminal / -transcript / -interrupt / -redirect / -stop / -discard
  │
  ├─ Supervision runtime (src/runtime/, see SUPERVISION.md and ADR-026)
  │    ├─ control-server  — loopback endpoint the agents' hooks answer on, token per run
  │    ├─ supervised-runner — worktree → project → terminal tab running `claude --session-id`
  │    ├─ supervision     — run register, review queue, backpressure gate, feed
  │    └─ stall-watcher   — a run that stops making progress without asking (shadow mode by default)
  │
  └─ AgentRunner (src/runner/agent-runner.ts)
       ├─ A phase runs supervised, in a terminal, with every tool call asked about
       ├─ Streams transcript output → broadcasts speckit:run-output push event
       ├─ On turn end: measures the diff, grades it, queues it for review
       └─ self-review keeps the headless spawn (ADR-007), confined by a command policy.
          Four steps, not an && chain: each records its own exit code, and each is
          asked for its findings as data (eslint --format json, vitest
          --coverage.reporter=json-summary) so the gate's table is measured rather
          than scraped. Formatting is checked with the repo's format:check, never
          `format` — that writes, and a review may only read.
```

### Renderer Architecture (`extensions/speckit-pilot/src/renderer/`)

```
App.tsx  (board home + header: KnowledgeSearch / Import ticket (manual refresh) / Settings)
  ├─ On open (and workspace change) auto-reconciles assigned Linear/Jira tickets onto
  │    the board via reconcileAssignedTickets(): fetch ticketList() + cardList(), dedup on
  │    source:sourceKey, cardCreate() the missing ones. The "Import ticket" button re-runs
  │    the same reconcile as a manual refresh. New cards surface via speckit:state-changed.
  ├─ PermissionQueue — tool calls a supervised run is holding until somebody decides
  ├─ SupervisionPanel — runs / stalls / review / feed; the four actions on a run, per-hunk review
  ├─ BoardView       — six stage columns (@dnd-kit); buckets CardSummary[] by derived stage
  │    └─ CardTile        — type badge, title, scope, compact phase rail, run-status chip
  ├─ CardDetail      — slide-over drawer with tabs:
  │    ├─ Brief          — CardBriefEditor (title/type/scope/checklist) → card-update / card-create
  │    ├─ Phases         — RunDashboard (backlog card shows "Hand off to agent" CTA)
  │    │    ├─ GatePanel      — generic phase gate (approve / request-changes / revoke / comment / inline-edit)
  │    │    ├─ SelfReviewGate — format+lint+coverage+google-review quality summary gate
  │    │    ├─ OpenPrGate     — PR title input + gh pr create trigger
  │    │    └─ BatchCheckIn   — implement batch boundary: continue / pause / split / redirect
  │    ├─ Activity       — ActivityFeed: comments + audit log, composer (steers next phase)
  │    └─ Artifacts      — ArtifactsPanel: artifacts + revision history + diff/markdown viewer
  ├─ KnowledgeSearch — keyword search; attach a result to a card brief
  └─ SettingsView    — integrations / autonomy & gates (incl. maxConcurrentRuns) / agent runner
```

Drag/drop and stage-bucketing logic is factored into pure, unit-tested helpers
(`src/components/board-util.ts` — `bucketCards`, `resolveDrop`; `src/state/run-queue.ts`
— `shouldQueue`, `orderPending`, `classifyMove`).

### Security Constraints

- Credentials (Linear API key, Jira token) are stored in the main-process secrets store and **never cross the IPC boundary** to the renderer. `speckit:credentials-status` returns `{ connected: boolean }` only.
- The extension never force-pushes, modifies `main`, or merges PRs automatically.
- All `speckit:*` IPC channels are extension-owned (not core channels). The core app has no knowledge of them.

### State Persistence

All state lives in `.pilot/` inside the feature directory (a subdirectory of `specs/`):

- `.pilot/state.json` — `PilotState` v3 (card brief, stage, phases, ticket ref, run meta, settings)
- `.pilot/card.json` — the card brief (title/type/scope/checklist/attachments/knowledge refs)
- `.pilot/comments.jsonl` — append-only steering comments (feed the agent's next phase run)
- `.pilot/history.jsonl` — append-only audit log of all phase events
- `.pilot/self-review.json` — last self-review result (format/lint/coverage/google-review)

### ADRs

- [ADR-007: agent-runner-subprocess](adr/007-agent-runner-subprocess.md) — spawn Claude Code as a child process rather than using the Anthropic API directly.
- [ADR-010: card model](adr/010-speckit-card-model.md) — a card unifies feature dir, ticket, and run; `PilotState` v3.
- [ADR-011: parallel runs](adr/011-speckit-parallel-runs.md) — concurrency cap replaces the single-active-run queue.
- [ADR-026: supervised runs in a terminal](adr/026-supervised-runs-in-a-terminal.md) — a phase runs `claude` in a visible terminal behind a `PreToolUse` control server; the verified hook contract; why the stall detector ships in shadow mode.

See [`extensions/speckit-pilot/SUPERVISION.md`](../extensions/speckit-pilot/SUPERVISION.md) for the operator-facing account: the surfaces, the four actions on a run, risk grading, backpressure and stall thresholds.
