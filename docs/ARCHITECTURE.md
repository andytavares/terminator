# Architecture: Terminator

This document describes how Terminator is built today, from the processes down to the built-in extensions. Each section names the files that implement it; when the two disagree, the code is right and this document is a bug (Constitution VIII). Decisions and their reasons are in [`docs/adr/`](adr/); this document links to them rather than repeating them.

Read it top to bottom the first time: the process model and the IPC contract are what every later section relies on.

**Versions are not written here, because they drift.** Read them where they are declared:

| What                   | Where                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| The app                | `version` in `package.json`                                                                                                |
| Electron               | `electron` in `package.json` `devDependencies`                                                                             |
| Node for development   | `.nvmrc`                                                                                                                   |
| The Extension SDK      | `version` in `packages/extension-sdk/package.json`; history in its `CHANGELOG.md`                                          |
| The design system      | `version` in `packages/extension-ui/package.json`                                                                          |
| Every other dependency | its `package.json`; one exact version per package across the repository ([ADR 097](adr/097-one-version-per-dependency.md)) |

---

## Repository layout

| Path                        | What it is                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/`                 | The Electron main process: windows, terminals (`terminal/`), IPC handlers (`ipc/`), storage, the extension host's parent side (`extensions/`) |
| `src/main/extensions/host/` | The extension host process and both ends of its `MessagePort` protocol                                                                        |
| `src/renderer/`             | The desktop UI: React, Zustand stores (`stores/`), the sidebar view model (`sidebar/`), Quick Actions                                         |
| `src/renderer-remote/`      | The browser login page and the phone client that Remote Control serves                                                                        |
| `src/shared/`               | Code both processes use: the `window.electronAPI` manifest (`electron-api/`), zod schemas (`schemas/`), types                                 |
| `packages/extension-sdk/`   | `@terminator/extension-sdk`: the Extension API declaration the core implements                                                                |
| `packages/extension-ui/`    | `@terminator/extension-ui`: the design system, used by the core and every extension, with its Storybook                                       |
| `extensions/*/`             | The built-in extensions: foundry, git-integration, notepad, remote-control, task-vault                                                        |
| `tests/`                    | Core tests: `unit/`, `integration/`, `e2e/` (Playwright). Each extension keeps its own tests in `extensions/*/tests/`                         |
| `scripts/`                  | Build and development scripts (`build-extensions.cjs`, `create-extension.cjs`, `perf/`)                                                       |
| `specs/`                    | Spec Kit feature specs, plans and contracts, one directory per feature                                                                        |

---

## Process model

Terminator is an Electron application with four kinds of process: the main process, the extension host, the main window's renderer, and one renderer per extension view ([ADR 094](adr/094-extensions-follow-the-vs-code-model.md)).

```
┌──────────────────────────────────────────────────────────────┐
│ Main process (Node.js)                    src/main/index.ts  │
│  PtyManager (node-pty) · OutputRelay · electron-store files  │
│  app.sqlite connection · IPC handlers (invoke table)         │
│  ExtensionHost (manifests, status) · ExtensionViewHost       │
└───────┬───────────────────────┬──────────────────────┬───────┘
        │ MessagePort           │ contextBridge         │ WebContentsView
        │ requests, events,     │ preload.ts            │ preload-webview.ts
        │ callbacks by id       │ window.electronAPI    │ window.electronAPI
┌───────▼──────────────┐ ┌──────▼─────────────────┐ ┌───▼──────────────────────┐
│ Extension host       │ │ Main window renderer   │ │ Extension views          │
│ utilityProcess       │ │ React · Zustand stores │ │ ext://<id>/<renderer>    │
│ every extension      │ │ sidebar, tabs, xterm   │ │ one per surface shown    │
│ backend's activate() │ │ Quick Actions, Settings│ │ the extension's own UI   │
│ own app.sqlite conn. │ └────────────────────────┘ └──────────────────────────┘
│ Remote Control server│
└──────────────────────┘
```

- **Main process.** Owns the windows, every terminal process (`src/main/terminal/pty-manager.ts`), the core's settings files and the IPC handlers. `node-pty` is a native module and stays here ([ADR-001](adr/001-pty-in-main-process.md)).
- **Extension host.** One Electron [`utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process) that runs every extension backend, so extension work never shares the event loop that relays terminal output. Its entry is `src/main/extensions/host/entry.ts`, built to `out/main/extension-host.js`. It is the only place a backend runs: main never `require()`s an extension's entry point. See [Extension system](#extension-system).
- **Main window renderer.** The core UI, with `contextIsolation: true` and `nodeIntegration: false`. It reaches main only through `window.electronAPI`, which `src/main/preload.ts` exposes.
- **Extension views.** Each extension surface is a `WebContentsView` composited over the area the main window reserves for it, loading the extension's own document. It reaches main through `src/main/preload-webview.ts`.

---

## Startup sequence

The window comes first; everything slow happens beside it. `app.whenReady()` in `src/main/index.ts`:

1. Starts the login-shell PATH probe (macOS only; a login shell takes hundreds of milliseconds) without waiting for it.
2. Opens the database (synchronous `node:sqlite`), registers the `ext://` protocol and the IPC handlers.
3. Starts the extension host process (`startExtensionHostProcess`), builds the menu and creates the window.
4. Calls `ExtensionHost.start({ bundledDirectory, beforeActivation, afterActivation })` (`src/main/extensions/extension-host.ts`).

`start` registers every extension synchronously (the stored enabled ones, and any bundled one not yet in the store), so `extension:list` is complete as soon as the renderer can ask. It then activates them concurrently once `beforeActivation` (the PATH probe, which extension code that spawns tools needs) has resolved. An extension that lists others in its manifest's `extensionDependencies` waits for their activation first; a dependency cycle fails every extension in it. Activation is isolated per extension: a throwing `activate` marks that extension `error` and nothing else. The one table two extensions share (`settings`) is created with `CREATE TABLE IF NOT EXISTS`, so activation order does not matter for it.

`afterActivation` runs once every extension has activated. It is where the legacy PGlite import (`src/main/db/legacy-pglite-import.ts`) runs, because it copies into tables the extensions create in `activate`.

An extension view is created by `extension:update-panel-bounds`, which first awaits `ExtensionHost.whenActivated(extensionId)`: the extension's own activation, and the import when one is pending. A view therefore never loads before the backend it talks to, and one slow extension delays only its own view.

Because the PATH probe runs beside the window, a child process started from a core IPC handler in the first moments after launch can still see the app's own PATH on macOS. Extension code is not affected (it waits on `beforeActivation`).

### Loops in the main process

- **System metrics** (`ipc/metrics.ipc.ts`). The sampler (CPU delta, and network bytes through `netstat -ib` on macOS or `/proc/net/dev` on Linux) runs only while the renderer is polling `metrics:system`, which it does only while a metrics view is showing; it stops 5 s after the last poll and restarts, with fresh baselines, on the next. `netstat` runs through `execFile`, asynchronously, never overlapping itself.
- **Stores** (`storage/cached-store.ts`). The four core electron-store files (workspaces, settings, extension settings, extensions) are read through `CachedStore`, which parses a file once per key. The cache is dropped on the store's own writes and on electron-store's `onDidAnyChange` (the stores are opened with `watch: true`, so another writer is noticed too). Values are returned as copies.
- **Agent session reports** (`agents/agent-session-watcher.ts`): see [Resuming an agent session](#resuming-an-agent-session).

---

## IPC contract

### The renderer side: one manifest

All renderer-to-main communication goes through `window.electronAPI`. The surface is declared once, in `src/shared/electron-api/manifest.ts`: each method's path, channel, kind (invoke, send or event), payload mapping, remote behaviour and TypeScript `signature`. `src/shared/electron-api/build-api.ts` builds the object from it at run time, for two transports:

- `src/main/preload.ts`: native, `contextBridge` over `ipcRenderer`.
- `src/renderer-remote/electron-api-shim.ts`: a browser, over Remote Control's WebSocket bridge.

`src/shared/electron-api/api-type.ts` derives the renderer's `ElectronAPI` type from the manifest with mapped types, so a renderer call site type-checks against it. The manifest also derives the core's remote allowlist ([ADR-023](adr/023-channel-manifest-and-declared-remote-access.md)).

Specs marked `extensionView` are what an extension view receives. `src/main/preload-webview.ts` is still written by hand, because two preload entries sharing the builder would make Rollup emit a chunk the sandboxed preload cannot load; `tests/unit/main/preload-webview.spec.ts` fails when it and the manifest disagree on a method, a channel or a payload. electron-vite's `build.preload.isolatedEntries` removes that shared chunk, but in 5.0.0 it crashes when stdout is not a terminal (CI pipes the build); 6.0.0-beta.8 guards it, so the webview preload moves onto `build-api.ts` when electron-vite 6.0.0 is released.

### The main side: the invoke table and `ChannelSpec`

Every invoke channel, core and extension, is a `ChannelSpec` (declared in `packages/extension-sdk/src/index.ts`): the channel name, a required zod `schema`, the `invalid` response for a payload the schema rejects, `run`, which receives the parsed payload, and an optional `onError` ([ADR-096](adr/096-every-ipc-channel-has-a-schema.md)). `dispatchChannel` is the one parse step both kinds share.

- Core channels are registered by `registerInvokeTable` (`src/main/ipc/invoke-table.ts`), one table per `src/main/ipc/*.ipc.ts` file that has invoke channels (`log.ipc.ts` has only a send channel).
- Extension channels are registered by `api.ipc.registerHandler(spec, { remoteAccessible? })` in `src/main/extensions/api.ts`. The spec's `schema` and `run` stay in the extension host, which validates the payload before `run`.

Both call `handleChannel` (`src/main/ipc/channel-registrar.ts`); ESLint (`eslint.config.mjs`) forbids any other caller. Registration records the channel and its remote-access declaration in the bridge registry (`src/main/remote/ipc-registry.ts`); `ipcMain` is never patched. The remote bridge dispatches to the same registered handler, so a payload from a remote client is validated exactly as the renderer's is.

Push events (main to renderer) go through `webContents.send`. Everything sent to the main window is also relayed to the extension views, except `terminal:*` and `workspace:changed`, which have their own paths (`src/main/index.ts`).

### Core channel namespaces

These are the channels the core registers or pushes (`src/shared/electron-api/manifest.ts`):

| Namespace                                               | What it carries                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `terminal:*`                                            | Create, attach, input, output, acknowledge, resize, close, process exit, list, cleanup                                               |
| `workspace:*`                                           | Workspace create, list, update, delete, reorder; the active selection                                                                |
| `project:*`                                             | Project create, list, rename, branch, delete, reorder                                                                                |
| `settings:*`                                            | Global and per-workspace settings                                                                                                    |
| `session-records:*`                                     | Session descriptions, links and agent conversations (see [Home and the Monitor wall](#home-and-the-monitor-wall))                    |
| `integrations:*`                                        | Issue trackers: connection, issue list, search, get, comment, project links, agent context                                           |
| `git:*`                                                 | Branches, worktrees, fetch and change statistics the core sidebar needs                                                              |
| `shell:*`                                               | `shell:exec` (git and gh only; `cwd` confined to `workspaceRoot`, after `realpath`, when one is given), `open-path`, `open-external` |
| `fs:*`                                                  | File watch start and stop, `fs:read-file`, `fs:changed` pushes                                                                       |
| `extension:*`                                           | Install, toggle, reload, list, settings, commands, view bounds, insets, theme, exit gesture                                          |
| `notifications:*`                                       | Create, list, dismiss, trigger an action, push                                                                                       |
| `metrics:*`                                             | System and per-process metrics                                                                                                       |
| `menu:*`                                                | Native menu events pushed to the renderer                                                                                            |
| `editor:*`                                              | Detect and open an external editor                                                                                                   |
| `app:*`, `db:*`, `dialog:*`, `log:*`, `quick-actions:*` | App info, database health, folder picker, renderer log lines, opening Quick Actions                                                  |

An extension's channels are its own and the core knows nothing of them: git-integration registers `git:status`, `github:*` and others, Foundry `foundry:*`, task-vault `task-vault:*`. Each extension's spec files and `src/ipc/` directory are their reference.

### Types and schemas

- `src/shared/types/index.ts`: TypeScript interfaces both processes use.
- `src/shared/schemas/`: zod schemas for core payloads and stored shapes. A payload that fails its schema gets the `invalid` response declared in the channel's table row, usually an `{ error: 'VALIDATION_ERROR' }` envelope shaped like the channel's other responses.

---

## Data and persistence

```
Workspace ──── (many) ──── Project
                               │
                               └── (many) ── TerminalSession [in memory only]

GlobalSettings ──── (many) ──── WorkspaceSettings [per-workspace overrides]

Extension ──── contributes to ──── extension settings (by key)
```

| Entity                            | Stored? | Where                                                                            |
| --------------------------------- | ------- | -------------------------------------------------------------------------------- |
| Workspace, Project                | Yes     | electron-store `workspaces.json` (`src/main/storage/workspace-store.ts`)         |
| GlobalSettings, WorkspaceSettings | Yes     | electron-store `settings.json` (`src/main/storage/settings-store.ts`)            |
| Extension settings                | Yes     | electron-store `extension-settings.json` (`storage/extension-settings-store.ts`) |
| Extension registry                | Yes     | electron-store `extensions.json` (`src/main/extensions/extension-host.ts`)       |
| Extension data                    | Yes     | `userData/app.sqlite`, each extension's own tables                               |
| SessionRecord                     | Yes     | `session-records.json`; kept 30 days past close                                  |
| AgentConversation                 | Yes     | On its `SessionRecord`; the transcript itself is the agent's                     |
| Agent session reports             | Yes     | `userData/agent-sessions/<terminal id>.json`, one per terminal                   |
| Tracker credentials               | Yes     | `integrations.json`, each value `safeStorage`-encrypted                          |
| Tracker connection config         | Yes     | `integrations.json`, plaintext beside the credential                             |
| TerminalSession metadata          | No      | Renderer memory (`session.store.ts`) and `PtyManager`                            |
| xterm.js buffer                   | No      | The xterm.js `Terminal` instance                                                 |
| PTY process                       | No      | An OS process, killed on tab close or app quit                                   |

Terminal sessions do not survive an app restart. What the operator wrote about a session does: its description and its own work item link are a `SessionRecord`, kept until 30 days after the session closes (see [Home and the Monitor wall](#home-and-the-monitor-wall), ADR 054). So does the agent conversation that ran in it, which can be picked up again afterwards (see [Resuming an agent session](#resuming-an-agent-session), ADR 055).

See [ADR-003](adr/003-electron-store-for-persistence.md) for the storage decision. The core stores are read through a per-key cache (see [Loops in the main process](#loops-in-the-main-process)).

**Application database.** `userData/app.sqlite` is the one SQL database of the app, opened through Node's built-in `node:sqlite` (`DatabaseSync`, WAL journal, foreign keys on) in `src/main/db/index.ts`. The core owns no tables; each extension creates its own when it activates and reaches the database only through the injected `ExtensionDB` (`exec`, `query`, `get`, `run`, `transaction`). The extension host opens its own connection (WAL, `busy_timeout` 5 s), which every backend shares, so `transaction(fn)` runs `fn` in the extension's own process; main keeps one for the health check and the legacy import. On each connection statements and transactions run in call order; a statement issued while a transaction is open waits for it. `node:sqlite` is a release candidate (stability 1.2) in Node 24, the risk ADR 099 accepts. It replaced PGlite, which added about 250 MB to the main process and about 0.6 s to every start.

**Import from PGlite.** Up to and including the release before this one, the database was `userData/app.pglite`. On the first start where `app.sqlite` does not exist and `app.pglite` does, `src/main/db/legacy-pglite-import.ts` opens the old database once (PGlite is imported dynamically, on this path only, so a normal start never loads it) and, after the extensions have run their schema setup in `activate`, copies every row of each table that exists in both databases, in one transaction with foreign keys deferred. `app.pglite` is left untouched as the backup. If the import fails, the error is logged (`Legacy PGlite import failed`), the transaction is rolled back and the app starts with an empty database instead of refusing to start; the backup stays, and deleting `app.sqlite` makes the next start import again. Only tables of extensions that were activated on that start are imported. The import, the `@electric-sql/pglite` dependency and the `asarUnpack` entries for `postgres.wasm` and `postgres.data` are removed one release later (ADR 099).

**One process per profile.** `userData/app.sqlite` is opened by one process at a time. `src/main/claim-profile.ts`, the first import of `src/main/index.ts`, takes Electron's single-instance lock (a second launch exits and focuses the first window) and moves an unpackaged run to `<userData>-dev` unless `--user-data-dir` is given, so `npm run dev` never opens the installed app's database.

---

## Terminal sessions

```
createSession() called
      │
      ▼
terminal:create IPC ──► PtyManager.spawn()
      │                      │
      │                      ├─ spawns node-pty process
      │                      │  (env carries TERMINATOR_SESSION_ID, which is how
      │                      │   an agent's conversation is paired to this terminal)
      │                      ├─ registers onData → OutputRelay (batched, flow-controlled) → 'terminal:output'
      │                      └─ registers onExit → webContents.send('terminal:process-exit')
      │                         (exit code, or null when a signal ended the process)
      ▼
TerminalInstance created (renderer)
      │
      ├─ new Terminal({ scrollback }) from @xterm/xterm 6 (theme carries the scrollbar colours)
      ├─ subscribes to its session through the output router (one shared terminal:output listener)
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
      ├─ terminal:close IPC ──► PtyManager.kill(sessionId), then markClosed(sessionId) on its record
      ├─ session removed from Zustand store
      └─ TerminalInstance.dispose() — xterm.js instance disposed, output unsubscribed
```

The desktop and the phone client share one terminal library, `@xterm/xterm` 6 with `@xterm/addon-fit`
(ADR 097). xterm 6 draws its own scrollbar (`.xterm-scrollable-element`) and scrolls virtually, so the
scrollbar colours are set in the xterm theme objects (`XTERM_THEMES` in `TerminalSession.tsx`:
`scrollbarSliderBackground`, `scrollbarSliderHoverBackground`, `scrollbarSliderActiveBackground`), not in
CSS. Its width is fixed (14px) and `FitAddon` reserves it, whatever the OS scrollbar setting. Code and
tests that need the scroll position read the xterm buffer or the scrollbar slider, never the
`.xterm-viewport` element's `scrollTop`.

**Renderer choice.** A visible desktop terminal draws with `@xterm/addon-webgl`; the DOM renderer is the
fallback. `TerminalInstance.mount()` loads the add-on, and `unmount()` or `mountPreview()` (an Overview
tile) disposes it, so a hidden terminal or a thumbnail never holds a GPU context. Chromium keeps at most
16 live WebGL contexts, so `WebglContextBudget` (`src/renderer/terminal/webgl-contexts.ts`) hands out 12
and a terminal past that stays on the DOM renderer. A lost context (`onContextLoss`) or a machine without
WebGL2 also falls back to the DOM renderer. The DOM renderer clips the last column's glyph on macOS (about
2px), which WebGL does not do because it has no row boxes to clip. The phone client keeps the DOM renderer.
Because WebGL leaves no terminal text in the DOM, the renderer sets `window.terminatorE2E.terminalRows()`
(`src/renderer/terminal/terminal-rows.ts`), which reads every terminal's visible rows from its xterm buffer,
one terminal after another, and `terminalRowsIn(element)`, which reads only the terminal drawn in that
element; the end-to-end specs read terminals through them.

**Links.** `src/renderer/terminal/terminal-links.ts` finds the URLs and paths on a row and declares them to
xterm. `LinkPointer` (`src/renderer/terminal/link-pointer.ts`) underlines the link under the pointer while
⌘ (Ctrl off macOS) is held and opens it on ⌘-click. It maps the pointer to a cell from the box of
`.xterm-screen`, which both renderers size to exactly `cols × rows` cells inside the pane's padding
(`WebglRenderer.ts` and `DomRenderer.ts` in xterm.js). It never measures `.xterm-rows`, which the WebGL
renderer does not create.

**Batching and flow control.** A PTY produces thousands of small chunks a second. `OutputRelay`
(`src/main/terminal/output-relay.ts`) joins them in an `OutputBatcher` and sends one `terminal:output`
message per 16 ms frame, or at once when the batch reaches 128 KiB. Order is kept, and pending output is
flushed before `terminal:process-exit` is sent. Flow control follows the
[xterm.js guide](https://xtermjs.org/docs/guides/flowcontrol/): the renderer passes
`terminal.write(data, callback)` and the callback sends `terminal:acknowledge` with the number of characters
written. `FlowControl` (`src/main/terminal/flow-control.ts`) counts the characters sent and not yet
acknowledged, calls `PtyManager.pause()` (node-pty `pause()`) above 1 MiB and `resume()` below 256 KiB (characters), so a
process that prints faster than xterm can parse blocks on its own output instead of filling the renderer's
memory. Only output actually delivered to a window is counted, output for a session with no subscriber is
acknowledged on arrival, and `terminal:attach` forgets what an earlier renderer owed, so a reload cannot
leave a process paused. A browser client (remote) does not acknowledge: its output arrives by its own path. A terminal an extension
opens (`api.pty.openTerminal`, `api.pty.runInTerminal`) uses the same relay, not a broadcast to every
window and view.
In the renderer the output router (`src/renderer/terminal/output-router.ts`) holds the one
`terminal:output` listener and dispatches by session id.

**Exit status.** node-pty reports a process ended by a signal as `exitCode` 0 with `signal` set
(`WIFSIGNALED` in its [`src/unix/pty.cc`](https://github.com/microsoft/node-pty/blob/main/src/unix/pty.cc)).
`PtyManager` passes `null` for such a process, never that 0, so a terminal closed or killed before its
process finished does not read as a success. `api.pty.runInTerminal` runs a program as a tab's own
process and resolves with `{ sessionId, exitCode }` when it ends; it subscribes to the exit in the tick
it spawns, so a program that exits at once is not missed across the extension host's port.

---

## Settings resolution

Settings use a two-level hierarchy: global defaults + optional workspace overrides.

```
Resolved settings = GlobalSettings merged with WorkspaceSettings.overrides
```

The `resolveSettings(workspaceId?)` selector in `settings.store.ts` performs this merge. The result determines the `data-theme` attribute on `document.documentElement` (for CSS custom properties) and the `scrollback` value passed to new `Terminal` instances.

Theme changes take effect immediately — no restart needed — because the CSS variable system responds to the attribute change.

The shape is declared once, as zod schemas in `src/shared/schemas/settings.schema.ts`; `GlobalSettings`, `WorkspaceSettings` and the quick-action types are inferred from them. `settings-store.ts` merges a patch into what is stored and parses the result with the schema before saving, so a write that would break the shape stores nothing and `settings:update-global` / `settings:update-workspace` answer `{ error: 'VALIDATION_ERROR' }`.

---

## Extension system

The core and the extensions meet only through the Extension SDK, on VS Code's model ([ADR 094](adr/094-extensions-follow-the-vs-code-model.md), Constitution II). `packages/extension-sdk/types/api.d.ts` declares the API; `src/main/extensions/api.ts` implements it and the compiler checks the two agree. The core builds and runs with every extension directory deleted. How to write an extension is in [EXTENSION-DEVELOPMENT.md](EXTENSION-DEVELOPMENT.md); this section is how the core runs one.

Three classes share the work in main:

- `ExtensionHost` (`src/main/extensions/extension-host.ts`) reads and validates manifests, keeps each extension's status in `extensions.json`, and activates, reloads, toggles and unloads extensions.
- `ExtensionHostProcess` (`src/main/extensions/host/host-process.ts`) starts the extension host `utilityProcess` and restarts it. `ExtensionHost` is constructed with it (`src/main/index.ts`) and has no other way to load a backend; its unit specs give it a test double of the same `BackendHost` interface.
- `ExtensionViewHost` (`src/main/extensions/extension-view-host.ts`) creates, places and themes the extensions' `WebContentsView`s.

### The process boundary

| Piece                                          | Where          | What it does                                                                                                                           |
| ---------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `host/entry.ts` → `out/main/extension-host.js` | extension host | Receives a `MessagePort` and the snapshot, opens its own WAL connection to `app.sqlite`, runs `HostRuntime`                            |
| `host/host-runtime.ts`                         | extension host | `require()`s each backend, calls `activate(api)`, answers main's `channel.dispatch`, `command.run` and `callback`                      |
| `host/backend-loader.ts`                       | extension host | Requires a backend; on deactivate or a failed activate drops its entry point and its directory's modules from `require.cache`          |
| `host/host-api.ts`                             | extension host | The `ExtensionAPI` a backend receives: each member a request or event to main, a snapshot read, or local (`db`, `extensions`, `paths`) |
| `host/callbacks.ts`                            | both           | A function argument becomes `{ $callback: id }`; main calls it back with a `callback` event                                            |
| `host/api-server.ts`                           | main           | Runs each call on that extension's `ExtensionAPI` from `api.ts`, for members in `CROSSING_MEMBERS` only; keeps registrations by id     |
| `host/rpc-endpoint.ts`                         | both           | Requests with answers, events without, errors with their `name`                                                                        |
| `host/messages.ts`                             | both           | One record per message: an `ApiCall` (`extensionId`, `path`, `params`, `handleId` for a registration), a registration, a `CommandRun`  |

Values the core holds cross as promises, except `settings.get`, `workspace.list` / `listProjects` and `issues.supports*`, which read a snapshot main pushes on every change (`onExtensionSettingsChanged`, `onWorkspacesChanged`). `pty.onData` arrives batched, one message per frame (`src/main/extensions/pty-stream.ts`), every batch before the exit. A channel's or command's schema stays in the extension host, which validates the payload before `run`.

A reload is a `deactivate` then an `activate` message. The host drops the deactivated backend's entry point, and every module under its extension directory, from `require.cache` ([Node docs](https://nodejs.org/api/modules.html#requirecache)), so the next `activate` runs the code on disk; so does a backend whose `activate` threw. Modules outside the directory, such as another extension's, stay cached.

When the extension host exits unasked the app stays up: it is started again once (`HOST_RESTARTS`) and its backends activated again, each after the extensions it declares in `extensionDependencies`, as at startup, so a consumer's `api.extensions.get` returns its provider's new exports. A backend whose dependency fails to come back fails too. A second exit marks them all failed, and Settings → Extensions shows them as `error` with the reason as the status's tooltip. The failure is not stored, so the next launch tries again. Whenever what `listExtensions` returns changes (an install, a toggle, an uninstall, a failed activation, the host losing a backend or one coming back), `ExtensionHost` broadcasts `extension:list-changed`; Settings → Extensions (`extension.onListChanged`) reads the list and the settings schemas again, so it shows the change while it is open. The event is remote like `extension:list`, since the remote `/app/` shows the same panel.

### Loading an extension

Every directory under `extensions/` with a `manifest.json` is a bundled extension and is registered at startup ([ADR-007](adr/007-bundled-first-extension-distribution.md)); others are installed from Settings → Extensions → Install from Directory and remembered in `extensions.json`. Loading one:

1. Reads `manifest.json` and validates it with `ExtensionManifestSchema` (`src/shared/schemas/extension.schema.ts`).
2. Checks `minAppVersion` against the app version (`isVersionCompatible`); an incompatible extension is marked `error`.
3. Waits for the extensions it lists in `extensionDependencies`; a missing, disabled or failed dependency fails it with a message naming the dependency.
4. Creates the extension's `ExtensionAPI` in main (`createExtensionAPI` in `api.ts`) and asks the extension host to `require()` the manifest's `main`, a CommonJS file ([ADR-008](adr/008-extension-commonjs-compilation.md)), and call `activate` with the host-side API, whose calls run on main's.
5. Records what `activate` registered, so unloading disposes all of it. A throwing `activate` marks the extension `error`; the app and the other extensions are unaffected.

The renderer learns the enabled extensions from `extension:list` and turns each manifest's `contributes` into tabs, panels and commands (`initExtensions` in `src/renderer/extensions/loader.ts`), registered in the renderer's extension registry (`src/renderer/extensions/registry.ts`). That registry is internal to the core: an extension contributes surfaces only through its manifest.

### Extension views

```
Main window renderer                         Main process
  ExtensionPanelPortal (placeholder)  ──►    ExtensionViewHost
    reports its bounds over                    creates a WebContentsView in the
    extension:update-panel-bounds              'ext-views' partition, positions it
                                               over the placeholder, injects the
                                               design system CSS, stamps data-theme
                                                     │ loads
                                                     ▼
                                     ext://<extension id>/<manifest.renderer>?view=…&repoRoot=…
                                       preload: out/preload/webview.js (preload-webview.ts)
                                       window.electronAPI.extensionBridge.invoke / on
```

- The extension's bundle is never imported into the main renderer. A view is its own document with its own `webContents`, so it can crash without taking the core down ([ADR-022](adr/022-webview-isolated-extension-renderer.md)).
- The `ext://` protocol handler in `src/main/index.ts` serves only files inside the extension's directory, with `Cache-Control: no-store`; it is registered on the default session and on `ext-views`.
- The surface's `view` and the current `repoRoot` arrive as URL parameters; `workspace:changed` is sent on load and on every change.
- Reloading an extension (`extension:reload`) pushes `extension:renderer-reload`, and the portal remounts the view; the app is not rebuilt.
- A `WebContentsView` composites above the main window's DOM, so nothing the core draws can cover it. A centred core modal hides every view while it is open (`useModalEffect`, `src/renderer/stores/modal.store.ts`); a drawer moves views aside instead (`extension:set-left-inset`, `extension:set-bottom-inset`). An extension's own dialogs render inside its view ([ADR-038](adr/038-dialogs-render-in-the-extension-view.md)).
- `⌘P` / `Ctrl+P` pressed inside a view opens the core's Quick Actions: `ExtensionViewHost` watches each view's `before-input-event` (`isQuickActionsOpenShortcut`), focuses the main window and sends `quick-actions:open`.

**Pop-out windows.** `api.window.openAuxiliary(view, params)` opens a `BrowserWindow` that loads the extension's own view document with `?view=<view>` and the params, with the main preload and the design system CSS injected. One window is kept per `view`. Pop-outs are ordinary top-level windows: the Window menu (`src/main/window-menu.ts`) has the `window` role, so macOS lists every open window there, and each pop-out names itself through `document.title`.

### Building extensions

`scripts/build-extensions.cjs` (`npm run build:extensions`, run first by `npm run dev`, `npm run build` and `npm run package`) builds every extension in parallel:

- **Backend:** esbuild bundles `extensions/*/src/index.ts` into the file the manifest's `main` names (CommonJS, `platform: 'node'`). Packages that must be resolved from `node_modules` at run time (`electron-store`, `zod`, `fastify`, `web-tree-sitter` and others in its `external` list) stay outside the bundle. A `?raw` import plugin lets the design system's stylesheet be read as text. The output is gitignored and never edited (Constitution X).
- **View:** when `vite.renderer.config.ts` exists, the extension's own `npm run build:renderer` builds `index.html` into `dist/`.

### Shell execution

`api.shell.exec()` runs `git` or `gh` for an extension: the call crosses from the extension host on its port, main runs it through `src/main/shell/shell-executor.ts`, and `onOutput` chunks come back as callback events before the result. `api.github` runs gh through the same executor. Before either runs anything, `assertCwdInScope` checks the `cwd` against the extension's shell roots (`src/main/extensions/shell-roots.ts`, [ADR 102](adr/102-shell-exec-runs-in-declared-roots.md)): every workspace folder, every project worktree, the extension's own `api.paths.globalStorage` (`<userData>/extensions/<id>`, [ADR 103](adr/103-each-extension-has-its-own-data-folder.md)), and the folder settings the manifest declares in `contributes.shellRoots`. A `cwd` outside them rejects with `CwdOutOfScopeError`. The renderer's own `shell:exec` channel uses the same check with its single `workspaceRoot`, when given one. Both use `shell: false` and a minimal environment, and allow only `git` and `gh` (`COMMAND_NOT_ALLOWED` otherwise).

Commands resolve against `process.env.PATH`. On macOS an app started from the Dock or Finder gets `/usr/bin:/bin:/usr/sbin:/sbin`, which has no Homebrew `gh`, so at startup `src/main/shell/login-shell-path.ts` puts the login shell's PATH (`$SHELL -ilc`) ahead of it. A command that cannot be started reports its spawn error (`spawn gh ENOENT`) as stderr, never a bare exit code. A command killed by its timeout resolves with `timedOut: true` and exit code 124, never 0.

### File system watch

`FsWatcherService` (`src/main/fs/fs-watcher.ts`) wraps `fs.watch` with a polling fallback and pushes `fs:changed` to the renderer ([ADR-005](adr/005-native-fswatcher-over-chokidar.md)).

### Keyboard shortcuts

The core's own key bindings are in `src/renderer/hooks/useKeyboardShortcuts.ts` and the menu accelerators in `src/main/index.ts`; both are listed in `CORE_SHORTCUTS` (`src/renderer/quick-actions/shortcut-behaviors.ts`), and a unit test fails if either gains an accelerator with no matching action. An extension can bind a key three ways:

- `api.globalShortcut.register`: a system-wide accelerator through Electron's `globalShortcut`.
- `api.nativeMenu.addViewMenuItem` with an `accelerator`: works while Terminator is focused.
- A manifest `contributes.commands[].shortcut` in an extension that also contributes a `sidebarPanel`: `registerWebviewExtension` (`src/renderer/extensions/loader.ts`) binds it in the main window to toggle that panel.

Otherwise a command's `shortcut` is a display hint shown in the Quick Actions panel, and binds nothing ([ADR-057](adr/057-quick-actions-are-a-leader-panel.md)).

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

Both detectors share their pairing and guards (`src/shared/double-escape.ts`). The listeners are passive and bubble-phase, so an extension's own single-`Esc` dismissals are untouched. Core surfaces (`core.*` ids) are never exited, the gesture stands down inside a terminal, a text field, or an open modal, and remote `/app/` clients get the same gesture through a same-origin listener on the extension iframe. See [ADR-026](adr/026-double-escape-extension-exit.md).

A click in the sidebar dismisses the same way, and there core surfaces go too: `useDismissSurfaceOnClick` compares the global/workspace/project tab slots across the click and, if the click chose nothing itself, calls `registry.dismissSurfaces()` to clear all three. A click that opened or toggled a surface is left to stand; sidebar panels, which sit beside the terminal, stay open.

---

## Design system

The core and every extension are built from one design system, `packages/extension-ui` (`@terminator/extension-ui`), published outward: the core consumes it the way an extension does ([ADR 098](adr/098-one-design-system-documented-in-storybook.md), extending [ADR-039](adr/039-one-ui-layer-published-outward.md); Constitution XIII). It is a source-only workspace package: `main`, `module` and `types` point at `src/index.ts`, and `react`, `react-dom` and `lucide-react` are peer dependencies, so there is no build step and no second copy of React.

**Components.** `src/index.ts` exports `Dialog`, `ConfirmDialog`, `Popover`, `ToastRegion` / `Toast`, `EmptyState`, `Button`, `IconButton`, `Tabs`, `SegmentedControl`, `Markdown`, `RelativeTime`, `usePolling`, `useDismissible`, the layer scale and the modal-depth registry. The core's own dialogs, toast region and empty states use them (`src/renderer/components/ConfirmDialog.tsx` wraps the shared `ConfirmDialog`).

**Storybook.** `packages/extension-ui/stories/` documents each component in both themes (`npm run storybook`). The stories run as tests through the Vitest add-on (`npm run test:stories`), and Playwright screenshot tests guard them (`npm run test:visual`, `packages/extension-ui/playwright.visual.config.ts`).

**Tokens.** `packages/extension-ui/src/tokens.css` is the one definition of every token: colour, spacing, radius, fonts and the `--tm-layer-*` scale, under the `--tm-*` names, for both themes (a dark `:root` and a light `[data-theme='light']`). Tokens reach each document differently:

- The core renderer imports the file in `src/renderer/index.tsx`. `src/renderer/styles.css` defines the core's older names (`--bg-*`, `--text-*`, `--border-*`, `--accent`, `--font-*`) as aliases of `--tm-*`; they hold no value of their own.
- An extension view is a separate document, so CSS has to be injected into it. `EXTENSION_BASE_CSS` (`src/extension-base-css.ts`: `tokens.css`, `extension-base.css` with the icon scale and element resets, and `controls.css` with the one field height and the themed checkboxes and radios) is read at build time with Vite's `?raw` import, so nothing is looked up on disk at run time. `ExtensionViewHost` inserts it into every view on load, and `extensions/remote-control/src/server/remote-server.ts` serves the same constant to the remote client. The e2e specs that render extension stylesheets in plain Chromium rebuild it with `tests/e2e/extension-base-css.ts`, which reads the builder's own `?raw` imports, and `tests/unit/renderer/extension-base-css.spec.ts` checks the two are identical.
- An extension document never sees the main renderer's `data-theme`, so `ExtensionViewHost.setTheme` stamps it on every open view and remembers it for views created later, driven by the renderer over `extension:set-theme`.

A `--tm-*` name referenced but not defined makes its declaration invalid, and the browser drops it.

**Fonts** ship with the app. `@terminator/extension-ui/fonts` (`src/fonts.ts`) imports IBM Plex Sans and IBM Plex Mono from `@fontsource`; the core renderer and each extension view import it once in their entry, and the bundler copies the font files beside the script.

**Stacking** comes from a named scale (`src/layers.ts`), not from whoever picked the biggest number:

| Layer     | Value | For                               |
| --------- | ----- | --------------------------------- |
| `panel`   | 100   | In-flow raised surfaces           |
| `overlay` | 200   | Popovers, dropdowns, pickers      |
| `modal`   | 300   | Dialogs and their scrims          |
| `toast`   | 400   | Above everything, modals included |

`nestedLayerValue(name, containerValue)` places a surface inside another without leaving its band. A raw `z-index` number in an extension is a lint error.

**Modal depth is per document.** `contextIsolation: true` gives an extension page and its preload different `window` objects, so `Dialog` reports its depth across the bridge with `electronAPI.ui.setModalDepth`; that is how the double-Escape exit stands down while a dialog is open. Within one document, Escape is answered by the innermost surface only (`isInnermost` in `Dialog.tsx`).

**Contrast** is verified by rendering, not by reading the stylesheet: `tests/e2e/extension-themes.spec.ts` walks every visible text node in each extension view, in both themes, resolves the real composited backdrop through the translucent layers above it, and asserts WCAG AA. `color-mix` and layered alpha only resolve in a browser.

The written rules for extension UI are [EXTENSION-STYLE.md](EXTENSION-STYLE.md); its vocabulary rules are ESLint selectors with a fixture spec.

---

## Renderer state

The main window keeps its state in [Zustand](https://github.com/pmndrs/zustand) stores, one per domain, in `src/renderer/stores/`:

| Store                          | Holds                                                                                                                                 | Main actions                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `workspace.store.ts`           | workspaces, projects by workspace, the active workspace and project, collapse state, scratch                                          | `loadWorkspaces`, `createWorkspace`, `setActiveWorkspace`, `createProject`, `reorderProjects`, `deleteProject` |
| `session.store.ts`             | terminal sessions, their xterm instances, each project's view (active session, one split layout per split tab, order), focus requests | `createSession`, `adoptSession`, `closeSession`, `setActiveSessionForProject`, `activateSplit`, `requestFocus` |
| `settings.store.ts`            | global settings, workspace settings, the resolved theme                                                                               | `loadSettings`, `resolveSettings`, `updateGlobalTheme`, `updateQuickActions`                                   |
| `session-records.store.ts`     | session descriptions, links and agent conversations                                                                                   | `load`, `setDescription`, `setLink`, `transfer`, `forget`                                                      |
| `integrations.store.ts`        | tracker connections, project issue links, fetched issues, the link dialog and issue drawer                                            | `loadConnections`, `linkIssue`, `listMine`, `searchIssues`, `connect`, `openDrawer`                            |
| `change-stats.store.ts`        | each branch's `+n/−n` change counts, fetched out of band ([ADR-031](adr/031-change-stats-out-of-band.md))                             | `ensure`, `invalidate`, `invalidateAll`                                                                        |
| `extension-commands.store.ts`  | the commands extensions declared and registered, for Quick Actions                                                                    | `refresh`                                                                                                      |
| `notification.store.ts`        | the notification centre's entries, unread count, panel open                                                                           | `markRead`, `markAllRead`, `dismiss`, `togglePanel`                                                            |
| `toast.store.ts`               | the transient toast queue                                                                                                             | `addToast`, `removeToast`                                                                                      |
| `log.store.ts`                 | the log window's entries                                                                                                              | `addEntry`, `clear`                                                                                            |
| `metrics.store.ts`             | system CPU, memory and network; per-session process metrics                                                                           | `enableGlobalMetrics`, `disableGlobalMetrics`, `startPolling`, `stopPolling`                                   |
| `modal.store.ts`               | how many core modals are open (`useModalEffect`), which hides extension views                                                         | `push`, `pop`                                                                                                  |
| `terminal-open-error.store.ts` | the error and retry count when a project's terminal fails to open                                                                     | `setError`, `clearError`, `retry`                                                                              |

Beside them, `src/renderer/extensions/registry.ts` (`useExtensionRegistry`) holds what the extensions contributed: sidebar panels, global, workspace and project tabs, window views, commands, keyboard shortcuts, the active tab of each kind, and the Quick Actions groups.

Actions that change stored state call IPC first and update the store only when main answers with success.

Components read a store through a selector — `useStore(useShallow((s) => ({ a: s.a, b: s.b })))` — never the whole store, so a component re-renders only when a field it picked changes. A getter such as `statsFor`, `linkFor` or `resolveSettings` reads state through `get()`, so a selector that picks a getter called during render also picks the state behind it (`entries`, `links`, `globalSettings`); one called only from a handler or effect does not need to.

`session.store` changes about once a second per printing terminal (the activity stamp and latest line), and `metrics.store` on every sample. `App.tsx` therefore subscribes to neither: the parts that draw them — Home's badge and the metrics bar (`components/AppShellParts.tsx`), and Quick Actions (`components/QuickActionsHost.tsx`, mounted only while the panel is open) — subscribe on their own. The sidebar hands its branch rows a clock that moves only when the set of stale sessions changes (`useStalenessClock`), and drops a branch's change statistics when its terminals stop printing, once per burst rather than once per activity stamp.

Surfaces opened on demand — Settings, the Overview wall and the issue drawer — load with `React.lazy` behind a `Suspense` boundary, each as its own chunk, and the renderer build is minified (`electron.vite.config.ts`; electron-vite leaves renderers unminified by default). Quick Actions is not lazy: it is driven by keys typed straight after ⌘P, which would reach the app before a lazily loaded panel mounted. For the same reason the extension commands it offers live in `stores/extension-commands.store.ts`, read once at startup and again on each open, rather than in the panel, which would start from an empty list every time it mounts. The build warns on any chunk over `chunkSizeWarningLimit` (900 kB, `electron.vite.config.ts`), and CI fails the build on any warning.

---

## Notifications

Every notification — core app or extension-originated — goes through one
main-process dispatcher, `notificationManager.create()`
(`src/main/notifications/notification-manager.ts`). Callers never choose the
delivery mechanism: `create()` always resolves it. A core notification goes
through `resolveCoreNotificationTargets()` (`src/shared/notifications/resolve-targets.ts`)
against the user's notification settings (Settings → Notifications); an
extension's notification reads that extension's own `notify.<key>.*` settings,
falling back to the global defaults. A notification's type
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

A core-renderer notification may name a `sessionId`; `notifications:create` turns it into an `onClick` that shows the window and sends `terminal:navigate-to-session`. A native banner click runs `onClick` when there is one, else the first action — before, a notification with only `onClick` did nothing when its banner was clicked.

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

## Quick Actions

Feature 057 replaced the command palette (`⌘P`, label-only fuzzy search) with a leader + which-key panel: `⌘P` opens a panel of grouped actions with one-letter mnemonics; a letter acts immediately; `/`, or `⌘P` again, switches to fuzzy search over label, category and description. See [ADR-057](adr/057-quick-actions-are-a-leader-panel.md) for the decision and alternatives considered.

### Data flow: builders → rank → panel

```
core-actions.ts         (terminal/session/workspace/top actions, from CORE_SHORTCUTS)
surface-actions.ts      ("Open <label>" for every registered global/workspace/project/sidebar surface)
extension-actions.ts    (manifest `contributes.commands` + api.commands.register, per extension)
custom-runtime.ts       (user-defined shell/prompt actions from settings)
        │
        ▼
components/QuickActionsHost.tsx: actions = [...core, ...surface, ...extension, ...custom]
        │
        ▼
quick-actions/rank.ts: rankFirstScreen(actions, {pins, usage, now})
        │            → { pinned, recent } for the "Pinned & recent" row
        ▼
components/QuickActions.tsx (role="dialog", aria-label="Quick actions")
```

Every action is a single `QuickAction` (`quick-actions/types.ts`): `{ id, label, group, mnemonic?, shortcut?, description?, disabledReason?, run(ctx) }`. `disabledReason` renders the row dimmed with the reason in place of its description, and Enter/click sets the footer message instead of running it — an action that cannot run is always visible, never hidden (Constitution-adjacent design decision D5 in the spec). Groups (`quick-actions/groups.ts`) reserve `t`/`s`/`w`/`x` and the top-level letters `h`/`o`/`a`/`b` for core and allocate the rest to extensions: an extension names a `mnemonic` in its manifest, and if another extension already holds it, the loser gets the first free letter of its own label (`allocateExtensionGroups` in `groups.ts`, load order decides who wins, a warning goes to the renderer logger), never a core letter.

### The extension command contract

A manifest can declare `contributes.commands[]` (`{ id, label, description?, shortcut?, mnemonic?, requires? }`) and `contributes.quickActions.group` (`{ mnemonic, label }`). A declared command that the extension never calls `api.commands.register(...)` for shows dimmed with "Extension did not register this command" — declaring it in the manifest only reserves its place in the panel; the handler is what makes it real. `api.commands.register` takes a `CommandContribution` (`id`, `label`, `description?`, `mnemonic?`, `shortcut?`, `category?`, `requires?: 'repo' | 'session'`, `args?`) and a handler `(ctx: CommandContext) => void | Promise<void>`, where `ctx` is core-owned focus state (`projectId`, `sessionId`, `repoRoot`) passed outbound — extensions never reach into core to read it. `requires` dims the action from that context alone ("No repository focused" / "No terminal focused"). `shortcut` is a display hint, except in the one case described in [Keyboard shortcuts](#keyboard-shortcuts).

### Reaching the panel from an extension's own view

The leader is `CmdOrCtrl+P`: `⌘P` on macOS, `Ctrl+P` elsewhere, decided in one place, `isQuickActionsLeader` (`src/shared/quick-actions-leader.ts`). A focused terminal hands it on: xterm turns `Ctrl+P` into `^P` for the shell and stops the event, so `TerminalInstance`'s custom key handler returns `false` for the leader, and the keydown reaches the window listener in `useKeyboardShortcuts.ts`. An extension's UI is a separate `WebContentsView` with its own `webContents`; the host window's `⌘P` keydown listener never sees a keystroke that originated there. `extension-view-host.ts` attaches a `before-input-event` listener to every extension view (`isQuickActionsOpenShortcut`, unit-tested for both the mac and non-mac branches); on `⌘P`/`Ctrl+P` it calls `preventDefault()`, focuses the main window, and sends `quick-actions:open`, which `App.tsx` handles the same way as the in-window shortcut. The panel's own Escape closes only the panel — it claims Escape through the `useModalEffect` "modal depth" signal the double-Escape-exit detector already reads, so closing the panel is never counted as the first half of a double-Escape extension exit. The panel also moves DOM focus into itself on mount (a plain `tabIndex={-1}` container), because leaving focus on whatever was focused before `⌘P` — most often a terminal — meant xterm's own capture-phase Escape handler (attached directly to its textarea) could consume Escape and stop it from ever bubbling to the panel's own window-level listener.

### Persistence

Pins, usage (for frecency) and direct-shortcut-use counts live in `GlobalSettings.quickActions: { pins: string[], usage: ActionUsage[], directUse: DirectUse[], custom: CustomAction[] }` — all arrays, not records, because `deepMerge` in `settings-store.ts` replaces arrays wholesale but cannot delete record keys, and pruning entries for an uninstalled extension or a deleted custom action needs deletes. `quick-actions/usage.ts` prunes any entry whose id is no longer a live action before every save. Workspace-scoped custom actions live in `WorkspaceSettings.overrides.quickActions.custom[]`, listed after global ones, not merged by id.

---

## Navigation: the sidebar, Home and the wall

The primary navigation is a single resizable sidebar (`UnifiedSidebar`) listing **repos and their branches**. Terminals are not sidebar rows: they are tabs in the tab bar above the terminal, rows on Home, and tiles on the Overview wall (ADR 035, ADR 054).

### Component hierarchy

```
UnifiedSidebar (src/renderer/components/sidebar/UnifiedSidebar.tsx)
├── SidebarHeader                     — two bands, and no more (FR-033)
│   ├── AppBand — every app-level surface as one compact row of icons: core's
│   │     Home and Overview, the `contributes.globalTab` entries, and the
│   │     notification bell pushed to the
│   │     far edge. Icons only; the 8px text label became the accessible name
│   │     and tooltip it duplicated. Both contribution contracts unchanged —
│   │     only the render target and density moved (ADR 033, then FR-036).
│   └── search row — search, FilterMenu, DisplayMenu, "+ repo". These act on
│         the list below, which is why they sit here and not in the band.
├── [list]
│   ├── RepoHeader — three things at rest: name, branch count, and (only while
│   │     collapsed) a marker that a branch inside is waiting on you. The
│   │     colour swatch is not counted; it is identity, not a fact. Hover
│   │     reveals the chevron, "+ new branch" and the registered repo actions,
│   │     in reserved space so nothing already drawn moves. Carries the
│   │     drag handle for reordering repos.
│   ├── BranchRow[] — at most six things at rest: the state glyph in a fixed
│   │     16px gutter, the branch-kind glyph, the branch name in mono, the
│   │     issue key as plain text, the +n/−n change counts, and either a
│   │     state count or an age. The repo's 2px rail is excluded from the six.
│   └── scratch section — scratch terminals, drawn with BranchRow because in
│         that section a scratch terminal IS the unit of work. The one place
│         a terminal is still a row: nothing else can represent it.
└── resize handle
```

`FilterMenu` and `DisplayMenu` replaced four bands with two controls. Filter holds the saved views, the stale toggle, and a count of what is hidden — that badge is what deleted the standalone filter-notice strip, and it puts the way out of a filter in the same control as the way in. Display holds grouping and sort. Measured against the running app, chrome above the first row of work fell from **165px to 98px**.

### The view-model layer

`src/renderer/sidebar/` holds the pure core. **These modules import nothing but types** — no React, no store, no `Date.now()`; `now` is always a parameter. `tests/unit/renderer/sidebar/purity.spec.ts` guards the directory rather than any one module, so a file added here inherits the rule.

| Module                                                     | Role                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `branch-rows.ts`                                           | `buildBranchRows` — the sidebar's list: repos, and the branches under them               |
| `branch-state.ts`                                          | `aggregateBranchState`, `countInState` — a branch's one state, folded from its terminals |
| `session-facts.ts`, `work-item.ts`                         | `buildSessionFacts` — what Home and the wall say about every session; `resolveWorkItem`  |
| `ledger-rows.ts`, `logbook-groups.ts`, `session-filter.ts` | Home's two layouts: grouping, ordering, suggestions, and the text filter                 |
| `wall-order.ts`                                            | `placeWall` — each wall tile's band, CSS `order` and span, emitted in session id order   |
| `choice-prompt.ts`, `screen.ts`                            | `parseChoicePrompt`, `samePrompt`, `latestLineOf` — read off a settled terminal screen   |
| `home-prefs.ts`, `wall-prefs.ts`                           | Home and wall arrangement, persisted (the named `localStorage` side effect)              |
| `manual-order.ts`                                          | `mergeReorder` — folds a drag over the visible rows back into the stored list            |
| `view-model.ts`                                            | `STATUS_ORDER`, `isStale`, and the view/filter/sort types                                |
| `views.ts`                                                 | built-in views as data, and their persistence                                            |
| `session-status.ts`                                        | state → glyph/label, total over `AgentState`                                             |
| `branch-display.ts`                                        | `branchLabel`, `abbreviatePath`, `qualifiedBranchLabel`                                  |
| `collapse-state.ts`, `relative-time.ts`, `agent-state.ts`  | unchanged                                                                                |

`buildBranchRows` is the seam the whole list rests on. The rule that matters: **every branch is a row whether or not a terminal is open on it, unconditionally**. Filters lift one level — a branch matches when any of its terminals matches — with `hideStale` the deliberate exception, since it is about abandoned work and has nothing to say about a branch nobody has started.

**Ordering is `buildBranchRows`' job at both levels.** The sort key orders the repo groups as well as the branches inside each one — a sort that only reached inside a repo read as a sort that did nothing, because the group order was hard-coded alphabetical. `manual` is the order the stores hand the lists over in, read through an index map (`workspaces` for repos, `projects` within a repo) rather than left to a stable sort. Every computed key falls back to the repo name so equally quiet repos hold a fixed order; `manual` takes no such tie-break, because an alphabetical fallback is exactly what would swallow a drag. A repo with no branches is seeded as an empty group here rather than appended by the component, so it sorts and reorders with the rest instead of being pinned below them.

`UnifiedSidebar` writes that order back. `useDragReorder` is given the list **as drawn**, which is not the list as stored once a computed sort or a filter is on; `mergeReorder` rewrites only the slots the visible rows occupy, so a filtered-out repo keeps its place instead of being swept to the end by an order that never mentioned it. Committing a drop also sets the view's sort to `manual` — under any other key the next render would recompute the order and the drag would vanish. Repos reorder through `workspace:reorder`, branches through `project:reorder`; branch rows are not draggable under `groupBy: 'none'`, where one list spans every repo and the stores keep no order that crosses them.

Deliberately absent from a `BranchRow`: change statistics and the linked issue key. Both arrive from stores on their own schedule, and folding them in would make the result a function of when git or the tracker last answered (ADR 031).

### One state vocabulary, three surfaces

The sidebar gutter, the terminal tabs, Home and the Overview wall all read `STATUS_ORDER` and `statusPresentationFor`, so they cannot disagree about severity or shape. Nothing stores `agentState`: every surface derives it through `BellAndBusySource`, from exit, the bell, byte flow, and a numbered choice prompt left on screen. A `TerminalSession` still carries an `agentState` field, set once to `idle` and never updated; code that is not a sidebar row reads `agentStateOf(session)` (`src/renderer/sidebar/agent-state.ts`), never the field, which is how Next waiting and the tab glyphs once never saw a waiting session. A session whose process ended keeps `status: 'closed'` when its tab is selected. Emphasis is the `--state-op-*` scale in `styles.css` — opacity, never hue, because Constitution XII forbids differentiating an icon's state by colour, and because that is what keeps the four readable in greyscale.

Precedence is fixed: waiting on the user, then working, then idle, then exited. A branch with no terminals is **idle, not exited** — folding an empty list would otherwise land on the last entry in the order, and a branch you have not opened is not a finished one.

### Selecting a branch

Clicking a branch resolves to exactly one terminal: one that is waiting on you, else the one you last had open on that branch (which `session.store`'s `projectViews` has kept all along), else the most recently active. A branch with no terminals is simply selected — `App`'s auto-open effect gives it its first one, and starting one here as well opened two.

### Home and the Monitor wall

Two core global tabs draw every session from one view model. `useSessionFacts` builds `SessionFacts` from the session, workspace, session-records and integrations stores through `buildSessionFacts`, which is pure.

- **Ending and starting** are on the surfaces themselves: `CloseSessionButton` ends a live session through `closeSessionFromFacts` (leave the split, then close, as Cmd+W does) and removes a closed one through `session-records:forget`; `NewSessionMenu` starts one on Home and on the wall. Both live in `components/session/`, since Home and Overview share them.
- **Home** (`core.home`, `components/home/`) is the launch view: `App.tsx` activates it on mount, and `HomeBadge` (`components/AppShellParts.tsx`) keeps its app-band badge at the count of sessions waiting on you. `HomeScreen` switches between `LedgerView` (rows from `buildLedger`, arranged by `LedgerDisplayMenu`) and `LogbookView` (a list from `buildLogbook` and one session's detail). The layout and the Ledger's arrangement persist; the text and Needs you filters do not.
- **The Monitor wall** (`core.overview`, `OverviewScreen`) draws a `WallTile` per open session. **Every tile and both band headings are direct children of one grid**, and `placeWall` emits placements in session id order with position carried by CSS `order` and `grid-column: span`. That is load-bearing: `LivePreview` calls `mountPreview`, which moves the session's single xterm element into the tile, and a re-parented or reordered tile would tear the live terminal out. ADR 036's invariant, kept by ADR 054.
- **Live previews** fill their box's width and follow the cursor (`terminal/preview-window.ts`), re-placed on every xterm render.
- **Descriptions and session links** live in `src/main/sessions/session-record-store.ts`, beside `issue-link-store` and in its shape: in memory, mirrored to `userData/session-records.json` with a tmp-then-rename write, exposed as `session-records:*` on `window.electronAPI.sessionRecords`. A record exists only while a session has a description or its own link. `terminal:close` closes it, a startup sweep closes anything the last run left open (a quit closes no terminals one by one), and `pruneRecords` drops records 30 days after close. A session's work item is its own link, else its branch's. The branch link, and the agent context injected from it, are untouched. `forget` deletes a **closed** record outright, which is how the operator clears one from Home before retention does; it refuses an open one, whose record is what Home draws the session from.
- **Order follows standing, not output** (ADR 058). `wall-order`, `ledger-rows` and `logbook-groups` rank by `standingRank` — needs you, running (working and idle together), exited — then start time; the "recent" option sorts by `lastAttendedAt`. Nothing orders by `lastActivityAt`, which restamps once a second for every printing session. The Ledger lifts needs-you sessions into a first `needs-you` group.
- **State colour lives on fills and edges.** `StateChip` (`components/session/`) draws a label on `--state-*-fill` with a `--state-*` edge — amber needs you, green working, neutral otherwise — and its glyph keeps `currentColor` and opacity. `compact` drops the label for the sidebar gutter.
- **Work items read one way.** `SessionFacts.workItem` (own link, else branch link) feeds Home, the wall, the sidebar terminal row (`BranchTerminal.workItem`) and the tab bar, and a collapsed branch row shows its terminals' own keys after its own (`sessionIssueKeys`: one element, the rest counted as `+N`); every terminal-level Link/Change/Remove opens `SessionLinkDialog`. A session link also writes `userData/integrations/session-context/<sessionId>.json` (`integrations/session-context.ts`), which the user-level SessionStart hook prints for the terminal named by `TERMINATOR_SESSION_ID`; the project hook stays silent for that session.
- **Answering in place.** `session-controller` reads a terminal's visible rows once per busy → idle transition, stores `latestLine` and `parseChoicePrompt`'s result as view state, and clears the prompt on the next output. `answerChoice` re-reads the screen and types the option's digit only when `samePrompt` still holds. A bare digit answers a Claude Code select prompt, verified live on 2.1.273 (`tests/e2e/live/choice-prompt.spec.ts`).

### Revealing a session

Every way of opening a session — Home, the wall, the sidebar, a tab, Quick Actions, a shortcut, a notification, an extension's `terminal:navigate-to-session` — calls `revealSession` (`terminal/navigate-to-session.ts`). It leaves Home, the wall and any tab, switches workspace or scratch, activates the session, and calls `session.store`'s `requestFocus`, which bumps a nonce. `TerminalPane` focuses the requested terminal on each nonce change, after mount and never while a modal is open, so re-selecting the session that is already active still puts the cursor in it. A session's working state is held until 5 s of quiet (`WORKING_HOLD_MS` in `session-controller`); the screen is still read at 1.5 s. ADR 058.

### Resuming an agent session

A terminal dies with the app; the conversation that ran in it does not. Claude Code keeps a transcript per conversation and resumes one by id, so Terminator captures that id and offers to bring the conversation back. ADR 055.

- **Capture is a hook in the operator's own Claude settings.** At startup `installCaptureScript` writes `agent-session-hook.cjs` beside the profile (ADR 026's pattern: a loose script survives development and vanishes from a packaged bundle) and `installUserHook` merges one `SessionStart` entry into `~/.claude/settings.json`. The entry is matched by script _name_, so re-installing from a packaged app, a development run or a test profile replaces it rather than stacking copies, and its command is guarded with `test -f <script> … || true` so an entry whose script has gone does nothing instead of failing before every agent session on the machine. Removing the feature is removing that block; the user guide says so.
- **The terminal is named by the environment.** `terminal:create` exports `TERMINATOR_SESSION_ID` into the PTY. The hook runs beneath the agent, reads `session_id`, `transcript_path` and `cwd` from its stdin payload, and writes `userData/agent-sessions/<terminal id>.json`. This is exact where matching on folder or time is a guess, and it captures a `claude` the operator typed themselves. A conversation in a terminal outside Terminator names no terminal and is ignored.
- **The watcher folds reports into records.** `agent-session-watcher.ts` watches that directory with `fs.watch` ([ADR-005](adr/005-native-fswatcher-over-chokidar.md)) and reads it once at startup, for reports written while the application was closed. Each report is claimed by renaming it, parsed with the pure `parseHookReport`, passed to `setAgent` with the snapshot `makeSnapshotFor` builds from the PTY registry and the workspace store, and deleted, so it is handled once however many events announce it. A report for a terminal the registry cannot place is deleted too. There is no timer: a report whose event the platform drops stays on disk until the next start.
- **Resumability is read at answer time, never cached.** `session-records:list` stats the transcript for every record, because the file belongs to the agent and can be deleted at any moment; `useSessionFacts` asks again whenever a surface that draws Resume appears.
- **Resuming replaces the terminal.** `planResume` (pure) turns the facts into a plan, refusing anything that is not a conversation id rather than escaping it. `resumeSession` opens a terminal on the same branch in the recorded folder with `claude --resume <id>` as its `initialCommand`, calls `session-records:transfer` to move the description, link and conversation onto it, then closes the exited one. One terminal per conversation.
- **Proved live** on Claude Code 2.1.273 by `tests/e2e/live/resume-live.spec.ts`, which runs a real conversation, ends it, presses Resume, and asks it what it was told.

### Colour propagation

A repo's `color` appears in exactly two places: a 2px rail on its rows (`box-shadow: inset 2px 0 0 var(--ws-color, transparent)`) and a 7px swatch beside its name. No background tint at rest, on hover, or when selected; hover and selection are neutral theme surfaces identical for every repo; the repo name is `--text-primary`.

Every mix spells its fallback as `var(--ws-color, transparent)`: an unresolved custom property makes the _whole_ declaration invalid at computed-value time rather than just that term, which would leave the surface unpainted. `tests/unit/renderer/sidebar-workspace-tint.spec.ts` asserts the washes are gone, that the colour is used only as a rail and a swatch, and that the text tokens clear AA on the flat surfaces they now sit on, in both themes. See ADR 037.

### Collapse persistence

`collapse-state.ts` plus `localStorage` key `terminator.sidebar.collapsed`, keyed by grouping. Home's arrangement is `terminator.home.prefs` and the wall's is `terminator.wall.prefs`; both degrade field by field to defaults on corrupt storage. Filters are never persisted.

### Resize

The sidebar has a `div.unified-sidebar__resize-handle` on its right edge. `mousedown` starts a document-level drag; `widthRef` tracks the delta and the inline `style.width` is updated per frame to avoid re-renders. On `mouseup` the value is clamped to `[200, 480]` and written to `terminator.sidebar.width`. Double-click restores the default.

---

## Issue tracker integrations

One core-owned service reaches Linear and Jira; nothing else in the application holds a tracker
credential or contacts a tracker. See [ADR-029](adr/029-core-issue-tracker-service.md).

```
  renderer ──integrations:*──▶ ┌────────────────────────────────────────┐
   (settings, sidebar,         │  src/main/integrations/                │
    dialogs, drawer)           │    tracker-store    creds (safeStorage)│
                               │    issue-service    cache, single-     │──▶ Linear (@linear/sdk)
  extensions ──api.issues────▶ │                     flight, backoff    │──▶ Jira (REST v3)
   (foundry,                   │    providers/       one per tracker    │
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

**Three writes: comment, transition, create.** The provider interface exposes no way to change an
existing issue's assignee or any other field, or to delete one, and a test asserts the shape of that
surface so it stays true. `transition` moves an issue by intent (ADR-041); `create` files one the
operator asked for, Linear only (ADR-061).

**One writer at a time.** Every `tracker-store` change reads, edits and writes `integrations.json`;
changes run through one queue, so two at once (a field's blur and a Disconnect click) both land.

**End to end against stubs.** `tests/e2e/issue-trackers.spec.ts` drives every `integrations:*`
channel against stub Linear and Jira at their real addresses: the app runs with
`NODE_USE_ENV_PROXY=1`, `HTTPS_PROXY` naming a local proxy and `NODE_EXTRA_CA_CERTS` naming a CA made
for the run, so Node's fetch tunnels to `tests/e2e/tracker-stub.ts`, which answers TLS itself and
refuses every other host. Verification stays on. The CA and the leaf certificate are made with
`openssl x509 -req -extfile` and an explicit extension list, so no openssl.cnf default can add a
second copy of an extension. macOS ships LibreSSL's config, Linux ships OpenSSL's. The leaf's
SANs name both hosts, it has `extendedKeyUsage=serverAuth`, and its key identifiers link it to the CA.
The stub records every CONNECT and TLS error, and the spec prints them when a tracker fails to
connect. `close()` destroys the open tunnels, so a failed test cannot hold up `afterAll`.

---

## Security model

- **Renderers have no Node.** The main window, extension views and pop-out windows run with `contextIsolation: true` and `nodeIntegration: false`; they reach main only through their preload's `window.electronAPI`.
- **Every invoke payload is parsed by a zod schema in main** before a handler sees it, for core and extension channels alike ([ADR-096](adr/096-every-ipc-channel-has-a-schema.md)), as Electron's [security checklist](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages) asks.
- **Extensions are not sandboxed.** Their backends run in the extension host, a separate process, with full Node.js privileges. The process boundary protects the terminals and the core from an extension's slow or failing code, not from a malicious extension. Install only extensions you trust.
- **An extension's view can read only its own files.** The `ext://` handler serves files inside the extension's own directory and answers `403` for any path outside it.
- **Shell commands are limited.** `api.shell.exec` and `shell:exec` run only `git` and `gh`, without a shell, in a minimal environment (`src/main/shell/shell-executor.ts`).
- **Shell commands run only in declared roots.** An extension's `api.shell.exec` and `api.github` run in a workspace folder, a project worktree, the extension's own data folder `api.paths.globalStorage` or a folder setting its manifest declares in `contributes.shellRoots`, and nowhere else ([ADR 102](adr/102-shell-exec-runs-in-declared-roots.md), superseding ADR-006's workspace-only rule; [ADR 103](adr/103-each-extension-has-its-own-data-folder.md) replaced the shared userData root with the extension's own folder). Both the `cwd` and the roots are compared after `realpath`, by path segment, so neither a symlink nor a `..` nor a sibling sharing a prefix leads out. A manifest that declares another extension's setting is refused at load.
- **Tracker credentials never leave main.** They are `safeStorage`-encrypted in `integrations.json`, read only by a provider, and no channel returns one (see [Issue tracker integrations](#issue-tracker-integrations)).
- **The remote bridge is default-deny.** Only channels in the allowlist `src/main/remote/remote-accessible-channels.ts` (derived from the manifest) and extension channels registered `remoteAccessible: true` are reachable from a browser. Internal channels (`dialog:*`, `db:health`, `integrations:connect` / `disconnect`) and every other extension channel are not; Task Vault's SQL console and Notepad's file import and export are never opted in. See [Remote Control](#remote-control).

---

## Built-in extensions

Five extensions ship with the app in `extensions/`. Each follows the extension rules above with no exception: it imports only the SDK, the design system and its own packages, its backend runs in the extension host, and its channels are its own. Each extension's `CLAUDE.md` or `README.md` holds its development rules.

### Remote Control

When it is turned on in its Remote Control tab, the extension's backend starts an embedded [Fastify](https://fastify.dev/) HTTP and WebSocket server inside the extension host. The server binds to `0.0.0.0` so it is reachable directly over the LAN (the `remote:status` payload reports both a `lanUrl` and an optional ngrok `publicUrl`). Access is gated by a password checked once at login (exchanged for a session cookie), a `Host`-header check, and single-use tickets — not by the bind address.

```
Remote Control Extension (extensions/remote-control/)
│
├── RemoteServer (Fastify, binds 0.0.0.0 — LAN + ngrok)
│   ├── GET    /health                         → { ok: true }
│   ├── POST   /api/login                      → checks the password once; sets the remote-session cookie
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
└── NgrokManager         spawns `ngrok http <port>` (plus `--authtoken` when set), polls localhost:4040/api/tunnels
```

**Security constraints**:

- Server binds to `0.0.0.0` so phones/tablets on the same LAN can connect directly; remote (off-LAN) access is via ngrok. Security relies on auth, the `Host`-header check, per-IP rate limiting, and tickets rather than the bind address. See [ADR-017](adr/017-embedded-http-remote-server.md) § Threat Model & Accepted Risk.
- The password is checked once, by `POST /api/login`, against a scrypt hash with a random salt (`password-hash.ts`, `crypto.timingSafeEqual`). A correct password is exchanged for an HttpOnly, SameSite=Strict `remote-session` cookie (8h TTL, `Path=/`); every other `/api` route (except `/health` and the ticket-authenticated socket routes) requires that cookie. The password is never sent again, never stored by the browser and never put in the QR code. Only the hash is stored (the password is shown once when generated); settings written by earlier versions are migrated at start (plaintext is hashed and erased, a bcrypt hash is cleared and the password must be set again). See [ADR-100](adr/100-remote-control-credentials.md).
- Failed logins are rate-limited per client IP (`auth-rate-limiter.ts`): after 10 failures within 15 minutes the client is locked out (`429`) until the window drains. This is what makes a single shared password tolerable on a `0.0.0.0`-bound listener.
- `Host` header is checked against `localhost`, `127.0.0.1`, RFC-1918 private ranges, and the ngrok domain.
- WebSocket upgrade requires a single-use ticket issued by `POST /api/terminals/:id/ws-ticket`; ticket is consumed on first use and expires after 30 s.
- Input is accepted from the primary subscriber only (first WS client to connect to a session).
- `/app/*` and `/mobile/*` static assets are each gated behind a dedicated HttpOnly SameSite=Strict cookie (`app-session` / `mobile-session`, 8h TTL) issued when a valid one-time ticket (`POST /api/app-ticket` / `POST /api/mobile-ticket`) is consumed at `GET /app/` / `GET /mobile/`. Requests to those paths without a valid cookie receive `403 FORBIDDEN`. Session tokens carry an expiry and are purged hourly.
- The IPC bridge (`GET /api/bridge`) requires a single-use bridge ticket and lets the browser invoke/send/subscribe to IPC channels on behalf of the browser-side SPA. The bridge is **default-deny across all three message types** (`invoke`, `send`, `subscribe`): a message is rejected unless its channel is in the central allowlist `src/main/remote/remote-accessible-channels.ts` (surfaced to the extension via `api.ipc.isRemoteAccessible`). Extension channels are local-only unless they opt in with `registerHandler(channel, handler, { remoteAccessible: true })`; the declaration at registration is recorded in the bridge registry and is the only thing that admits them. That file is the single auditable definition of the remote attack surface, and `remote-accessible-channels.spec.ts` asserts it stays in sync with the channels the `/app/` shim actually uses — so the enforcement and the allowlist can never half-ship independently (the prior `/app/` outage).

**Browser login SPA + mobile client** (`src/renderer-remote/`): A separate Vite build (`npm run build:remote`) produces `out/renderer-remote/` which Fastify serves at `/`. After the login page has posted the password to `POST /api/login` and received the session cookie, it either calls `POST /api/app-ticket` and redirects to `/app/?t=<ticket>` to load the full Electron renderer bundle, or calls `POST /api/mobile-ticket` and redirects to `/mobile/?t=<ticket>` to load the touch-optimised mobile client (`mobile.html` from the same renderer-remote output directory).

**Full Electron renderer in browser** (`out/renderer/`): Fastify also serves the regular Electron renderer bundle under `/app/`. A `remote-shim.js` script is injected into `index.html` to polyfill `window.electronAPI` — all IPC calls are forwarded over the bridge WebSocket instead of the Electron `contextBridge`.

See [ADR-017](adr/017-embedded-http-remote-server.md) for the architectural decision.

### Git integration (`extensions/git-integration/`)

The Git project tab (status, staging, commit, pull requests), the Code Reviews workspace tab and the Reviews global tab. It runs git and gh through `api.shell.exec` and `api.github`, and is the only git parser in the repository ([ADR 094](adr/094-extensions-follow-the-vs-code-model.md) ended ADR-025's two parsers).

Its e2e specs run against real local repositories with a bare `origin` and a stub GitHub at the boundary the app has, the gh CLI: `tests/e2e/fixtures/bin/gh`, on the app's PATH beside the `claude` stub, forwards a call to `tests/e2e/github-stub.ts` when the app's `XDG_CONFIG_HOME` holds `gh/e2e-stub-url`, and otherwise runs the real gh. gh itself cannot be pointed at a local server (`GH_HOST` means HTTPS to `<host>/api/v3`, and the core passes no `GH_HOST`). Each extension view is a WebContentsView, which Playwright lists among the app's windows, so `tests/e2e/git-harness.ts` drives it as a page.

#### The review window

`window:open-pr-review` and the `review-pull-request` command call `openPrReviewWindow` (`src/review-command.ts`), which calls `api.window.openAuxiliary('pr-review', params)` with `repoRoot`, and `prNumber` and `showOverview` to restore straight into a review; the View menu's "Code Reviews in New Window" opens it with no params. The window loads the extension's own view, whose `src/renderer/App.tsx` routes `pr-review` to the review UI. Closing a review pauses its session through the store's `setPaused`, which writes the whole session (viewed marks, private notes and unsent draft comments included); a session written without them would replace the stored one and erase them. Every markdown preview in the extension, including the Open Pull Request template preview, goes through the sanitising `RichContent` component (ADR 091), which renders with the design system's `Markdown`.

The review's cost grows with the PR, so two paths keep it bounded. In the backend, `github:pr-review-detail` runs `analysePr` (`src/review/analyse.ts`), which parses each file's patch once and hands the parsed files to the reading-order, moved-code and insights passes. Every tree-sitter parse goes through `withSyntaxTree` (`src/review/symbols.ts`), which deletes the tree when its reader returns: web-tree-sitter trees live in WASM memory that garbage collection does not reclaim. In the view, `ReviewDiffPane` flattens a file into list entries (`src/review/diff-items.ts`) and `VirtualDiffList` mounts only those in the viewport and five past each edge with `@tanstack/react-virtual`, measuring each entry so comments keep their place. Code rows are memoised (`DiffLineRows.tsx`), so a drag or a divider move re-renders only the rows whose state changed. Rows off screen are not in the DOM: scroll to a hunk or line by entry index, never by querying rows.

#### MergeFlow conflict resolver

MergeFlow is a subsystem of the `git-integration` extension that provides an intent-first, card-based git merge conflict resolution UI. It lives entirely in `extensions/git-integration/src/` with no core file modifications.

##### Entry Points

- `GitFullView.tsx` shows a "Resolve conflicts →" button when `status.hasConflicts === true`, setting `gitStore.view = 'merge-flow'`, and renders `<MergeFlowView>` when `view === 'merge-flow'`.

##### Session Lifecycle

1. **Open**: `MergeFlowView` mounts → checks `electron-store` for a persisted session → if none, calls `git:conflicts-list` to build a fresh `ConflictSession`.
2. **Resolve**: User resolves conflicts one block at a time → each decision calls `git:resolve-conflict` (writes to working-tree file) and `git:session-persist` (persists undo stack).
3. **Commit**: `CompletionScreen` calls `git:merge-commit` (stages resolved files + runs `git commit`) → on success: clears electron-store session + closes MergeFlow.
4. **Undo**: Renderer owns the undo stack (`ResolutionDecision[]` in `merge-flow.store.ts`) → undo calls `git:undo-resolve` to restore conflict markers in the file.

##### IPC channels

All registered in `extensions/git-integration/src/ipc/merge-flow.ipc.ts` and documented in `specs/006-mergeflow-conflict-resolver/contracts/ipc-channels.md`.

##### Files

| File                               | Purpose                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/schemas/merge-flow.schema.ts` | Zod schemas for all MergeFlow data entities                                                                                                                              |
| `src/git/conflict-reader.ts`       | Git subprocess helpers: conflict block parsing, REBASE_HEAD detection, author info                                                                                       |
| `src/ipc/merge-flow.ipc.ts`        | IPC handler registration (9 channels)                                                                                                                                    |
| `src/api/merge-flow.ts`            | Renderer bridge (extensionBridge wrappers)                                                                                                                               |
| `src/stores/merge-flow.store.ts`   | Zustand store: session state, navigation, undo stack, modal state                                                                                                        |
| `src/components/merge-flow/*.tsx`  | UI components: MergeFlowView, ConflictHub, ConflictResolver, ConflictHeader, ConflictPanel, ResultPreviewStrip, ActionBar, KeepBothModal, ManualEditor, CompletionScreen |

### Task Vault (`extensions/task-vault/`)

The task-vault extension (`extensions/task-vault/`) implements a GTD+BuJo+PARA productivity system. The shared **SQLite** database (`node:sqlite`, see Persistence boundaries) is the datastore for all structured queries and CRUD. Key subsystems:

#### Vault Layer (`src/vault/`)

- **db.ts** — Defines the `settings`, `tasks`, `projects`, `areas`, and `links` schema via `applyTaskVaultSchema()`, which creates the final schema in one idempotent step (`CREATE TABLE IF NOT EXISTS`; no column-by-column migrations, because every SQLite database is created from it). All IPC handlers receive the extension's `api.db` and access data exclusively through it. Runs `backfillRecurringTasks` on startup to gap-fill any missing future occurrences. The `settings` table is shared with other extensions and keyed `PRIMARY KEY (extension_id, key)`; Task Vault reads, writes and resets only rows with `extension_id = 'task-vault'`.
- **recurrence.ts** — `RecurrenceRule` discriminated union, `parseRecurrenceRule` (throws `InvalidRecurrenceRuleError` on unknown input), and `computeNextDueDate` (strict mode: next date = previous + interval, never completion date). Also exports `localDate()` helper.
- **ensure-next-occurrence.ts** — `ensureNextOccurrence(db, taskId)`: idempotent function that checks whether a future `status='open'` instance already exists and inserts one if not. `backfillRecurringTasks(db)`: called at extension startup to handle days the app was closed.
- **tags.ts** — Utilities for extracting and normalising `@context`, `+project`, `#area`, and `due:` inline tags from task text.
- **types.ts** — `TaskStatus`, `IndexedTask`, `IndexedProject`, `KanbanConfig`, and other shared TypeScript types used by both the IPC layer and renderer components.

#### IPC Layer (`src/ipc/`)

- **vault.ipc.ts** — All vault CRUD handlers. Core task handlers: `capture`, `get-today`, `get-daily`, `add-task`, `add-subtask`, `edit-task`, `delete-task`, `complete-task`, `cancel-task`, `restore-task`, `reopen-task`, `migrate-task`, `block-task`, `unblock-task`, `reorder-tasks`. Recurrence handlers: `set-recurrence`, `clear-recurrence`. View/query handlers: `query`, `process-inbox-item`, `get-inbox`, `list-areas`, `archive-area`, `delete-area`, `create-area`, `list-archive`, `list-someday`, `someday-to-today`, `get-calendar-month`. Detail handlers: `get-task-detail`, `save-task-detail`. Bulk I/O: `export-json`, `import-json`. All handlers validate with Zod; stale IDs return `{ error: 'STALE_ID' }`.
- **projects.ipc.ts** — project list, update-project-status, and weekly-review payload handler.
- **links.ipc.ts** — bidirectional link handlers (create/remove/get-for-terminator-target).
- **kanban.ipc.ts**, **weekly-review.ipc.ts**, **admin.ipc.ts** — the board, the weekly review, and database administration (the SQL console), which stays local-only.
- **register.ts** — the registrar every file uses: each channel declares its schema, and `handleRemote` opts a channel in to the remote client.

#### Recurring Task Engine

Recurrence state lives in three first-class SQL columns on the `tasks` table (not in the metadata blob):

| Column                   | Format                                                               | Purpose                                                         |
| ------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| `recurrence_rule`        | `'daily'` \| `'weekly:1,3'` \| `'biweekly'` \| `'monthly'` \| `NULL` | The recurrence interval; weekly days encoded in the rule string |
| `recurrence_template_id` | UUID FK → `tasks(id)`                                                | Links every spawned instance back to its origin (template) task |
| `recurrence_notify_at`   | `'HH:MM'` \| `NULL`                                                  | Per-task notification time override                             |

End conditions (`recurrence_end_type`, `recurrence_end_date`, `recurrence_end_count`, `recurrence_completed_count`) remain in the `metadata` JSON blob because they are configuration, not runtime state.

**Core invariant:** for every recurring task, exactly one `status='open'` future instance exists in the database. This invariant is enforced by `ensureNextOccurrence(db, taskId)` — a single idempotent function in `src/vault/ensure-next-occurrence.ts`.

**Trigger points** (the only places that create new occurrence rows):

1. Extension startup — `applyTaskVaultSchema` runs, then `backfillRecurringTasks`. Handles days the app was closed.
2. `task-vault:vault:complete-task` IPC handler — completes the current task and calls `ensureNextOccurrence` in the same SQLite transaction.
3. `task-vault:vault:set-recurrence` IPC handler — sets the rule and immediately materialises the first future instance.

**The notification scheduler (`task-scheduler.ts`) is notification-only.** It reads the `recurrence_notify_at` column to determine per-task alert times but never inserts task rows.

**Strict recurrence mode:** next `due_date` is always `previous_due_date + interval`, regardless of completion date (e.g., a weekly Monday task completed on Wednesday still recurs next Monday).

A `UNIQUE INDEX` on `(recurrence_template_id, due_date)` enforces the invariant at the database level, preventing duplicate instances even under concurrent writes.

#### Task ID Format

Tasks are identified by a UUID (`crypto.randomUUID()`) assigned at insert time and stored in the `tasks.id` column. IDs are stable across restarts. `{ error: 'STALE_ID' }` is returned when a handler receives an ID that no longer exists in the database (e.g. after a delete or migration).

### Notepad (`extensions/notepad/`)

Markdown notes and Excalidraw diagrams, with live preview, margin comments, tags, folders and search. See [ADR-018](adr/018-codemirror6-editor.md) for the editor engine.

#### Backend and view

```
Extension host
  └─ extensions/notepad/src/index.ts (activate / deactivate)
       ├─ api.db — the shared app.sqlite; schema in src/db/db.ts
       └─ channels registered from src/ipc/: notes, tags, folders, comments,
          diagrams, diagram comments, search, export / import

Extension view (ext://terminator.notepad/dist/index.html)
  └─ src/renderer/main.tsx → App.tsx, routed by ?view=
       ├─ main    → NotepadView: NoteList, the CodeMirror 6 editor,
       │            a right rail with NoteOutline and CommentMargin
       ├─ note    → NoteWindowView (a pop-out for one note)
       └─ diagram → DiagramWindowView (a pop-out for one diagram)
     plus QuickCreateOverlay, SearchOverlay and ExportDialog
```

Channels are named `terminator.notepad:<name>` and register through `createIpcRegistrar` (`src/ipc/register.ts`): `handle` for local-only channels, `handleRemote` for the ones the remote client may call. File import and export stay local.

#### Database

Notes and diagrams are stored in the shared SQLite database at `<userData>/app.sqlite`, reached only through `api.db`. `applyNotepadSchema` (`src/db/db.ts`) creates every table and index with `IF NOT EXISTS`, so running it on each launch changes nothing that already exists; the database is created from this schema, which is why there are no column migrations. The import of the old better-sqlite3 `notepad.db` / `vault.db` files through `sql.js` is removed ([ADR 099](adr/099-node-sqlite-replaces-pglite.md)).

**Search** uses `LIKE` rather than an FTS5 table (`src/ipc/search.ipc.ts`). SQLite's `LIKE` folds case for ASCII letters only, so a search for `é` does not match `É`. Tag filters are applied in the same query with `EXISTS` subqueries, and results are returned in `updated_at DESC` order. See [ADR-019](adr/019-ilike-search-over-fts5.md) for the trade-off; its `pg_trgm` upgrade path was PGlite-specific and no longer applies.

#### Data flow

1. **Create and autosave**: view → `notes.autosave` → the `notes` table. Inline `#tag` parsing on autosave reconciles the `note_tags` join table (`reconcileTags`).
2. **Search**: view → `search.query` → `LIKE '%query%'` across `title` and `body`; `tag:foo` / `-tag:bar` tokens are resolved to tag ids before the main query.
3. **Folders**: notes and diagrams each carry a nullable `folder_id`. `folders.create/rename/delete` manage the `folders` table; `notes.reorder` and `folders.move` update `sort_order` and `folder_id` through an explicit `{ note: 'notes', diagram: 'diagrams' }` table map, never string interpolation.
4. **Comment anchoring**: a selection becomes `comments.create` with `startOffset`, `endOffset`, `quote`, `prefix` and `suffix`. On load `reanchorComment()` tries the offsets first and falls back to a text-quote search (the W3C TextQuoteSelector pattern). The CodeMirror `commentAnchorField` remaps positions on every transaction, and anchors that collapse or are not found are listed as orphaned in `CommentMargin`.
5. **Export and import**: `export.run` writes `.md` files with YAML front matter (`src/ipc/front-matter.ts`, on `js-yaml`) and diagrams as `.excalidraw` files (Excalidraw JSON, in a diagrams folder). Re-export matches existing files by the front matter's `id`, and `import.run` upserts by `id`. `GROUP_CONCAT` aggregates tags in the export query.

The channels and their payloads are in `src/ipc/` and the feature's contract, `specs/010-markdown-notepad/contracts/ipc-channels.md`.

### Foundry (`extensions/foundry/`)

Foundry is a **software factory**: an idea or a tracker issue becomes a **work
order** that compiles, and the order is executed by an orchestration that
manages the agents, the checks and the interruptions. It replaces the SpecKit
Pilot's card model and ten-phase pipeline (ADR-040, superseding ADR-010 and
ADR-012).

Two loops, one contract. Nothing but the work order crosses between them — no
phase name, no state file, no directory layout, no card.

#### The work order

Validated with zod on every read, because it is written by an agent and edited
through a surface, so nothing about it is trustworthy by construction. It
carries the intent, the acceptance criteria and how each is proven, the plan
(units and lanes), the risk grade and its triggers, the budgets, the
assumptions, the open questions, the adversarial findings, and the provenance
of every decision taken about it.

`src/order/schema.ts` answers _shape_; `src/order/compile.ts` answers
_completeness_. Five checks, none of which can be waved through:

| Check        | Fails when                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| `questions`  | anything is still unanswered                                                                                   |
| `verifiable` | a criterion has no executable proof and was not accepted as unverifiable **in writing**                        |
| `coverage`   | a criterion has no unit, a unit satisfies no criterion, or two lanes change one file with no declared producer |
| `risk`       | the plan touches something outside the blast radius the grade was taken over                                   |
| `redTeam`    | a blocking adversarial finding is neither resolved nor accepted with a reason (ADR 069)                        |

A check names what is missing **and what is enough**, because one that names
only the first gets over-served (ADR-049). `verifiable`'s picture rule says one
criterion closes it, of a surface the plan already touches: coverage runs both
ways, so every surface a criterion names is one the plan then has to touch, and
an architect that answered "no criterion asks for a picture" with three of them
across five extension panels turned a one-line ask into a 41-file plan.

A failure names a criterion by its statement and a unit by its title, never
by id alone: the detail is read by a person on the Plan step, and `AC-1` means
nothing to them. The architect still finds the row, because the rendered order
it amends carries each statement beside its id.

Budgets are the operator's (ADR 052), and there are two: agents at once and
minutes. A count of files is not one (ADR 056). The order schema also carries a
`tokens` field, which every draft sets to `null` and nothing enforces. The architect's proposal never changes
them. A draft's budgets are set on the Forge's Plan step
(`foundry:order.budgets`). On a running order, the one budget it went past is
raised at its `budget.exceeded` gate: the gate carries the `breach`, and
`foundry:inbox.decide` writes the new limit to the order before resuming. Any
enforced budget may be `null`, meaning no limit, which the breach check and the
scheduler treat as unbounded. In Settings, no limit
is written as `0`.

`agreeOrder` is the only thing that may set an order to `agreed`, which is what
makes the checks a gate rather than a suggestion. It also writes down the
derived lane ordering, so the Line reads the plan that was agreed rather than
repeating a derivation it could get differently.

#### The Forge (`src/forge/`)

Seeds an order from typed text or a tracker issue, having already read the
repository: the toolchain probe, the house documents, and the past decisions
about any file the idea names. A question that survives that is one the code
genuinely could not answer — a question the code _could_ have answered is a
defect in intake rather than a question. At most three questions are ever
surfaced at once.

**An amendment is not a redraft** (ADR-048). Converging is a conversation, and
every turn after the first is amending an order that already exists, so the
brief says so and carries the order to be amended. The architect's `reads:`
names `order`, which is what puts the rendered order — criteria, units, the
coverage matrix, and which of the checks refuse it — into the brief, and
`convergeBrief` adds the framing that tells it this turn changes that document
rather than deriving one. Both halves were missing and each cost a turn on
their own: measured on WO-0910-6ea, "Ask for the gap to be closed" produced
`coverage — nothing in the plan builds AC-1` about a plan the architect had
never been shown, so it went looking for the proposal it remembered writing —
which `readProposal` unlinks as it applies it — and then rebuilt the order from
`order.json` and the ledger by hand: 31 shell commands and just under seven
minutes before it wrote a line, on a one-criterion order.

Whether a turn amends is read from `provenance.decisions`, which grows once per
applied proposal and nowhere else while an order is a draft. A refused turn
appends nothing and a ticket that stated its own acceptance criteria is not a
plan the architect wrote, so neither is mistaken for work to amend — telling an
architect it wrote something it did not is the same class of defect in the
other direction.

**An ask is answered where it was asked.** A failing check's "Ask for…"
button starts a turn whose instruction the ledger's `converge.started` line
keeps; `lastIntake` hands it back as `asked`. Everything waiting on the operator
(open questions and open _blocking_ red-team findings) sits in the "Needs you"
band. There each question is answered, and each finding is asked about, told how
to fix, or accepted with a reason. One Send carries all of it as a `settle` on
`foundry:order.converge`: answers and accepts apply at once, and every ask and
fix goes to the architect in a single turn. The band stays usable while a turn
runs; a Send made then waits and goes out when the turn ends. A redraft closes
the structural findings it cleared (`settleFindings`). A reviewer's finding
closes only when the proposal lists it in `resolveFindings` with how (ADR 068).

**The red team argues before agreement (ADR 069).** A finding carries a
`category`, and only `wrong-outcome`, `regression` and `unprovable` block. The
others (`scope`, `process`, `pre-existing`, `infra`) are notes the builder sees.
Once a redraft passes every other check, the Forge loop (`createForgeLoop`,
`src/forge/forge-loop.ts`) runs a red-team round in the Forge; `src/forge/review-loop.ts`
holds its prompt and decides what follows each round. The architect gets every blocking finding in one
turn. The fix is ready for hand-off unless the red team set `anotherPass` or a blocking
finding is still open (ADR 075); then the next round attacks only what changed. The red team reads what
earlier rounds settled and may reopen a finding only with new evidence. After
three rounds the order goes to the operator. A clean round says the order is
ready and stops: hand-off is the operator's, and nothing agrees an order the
operator has not released or starts its Line on its own (ADR 078). The one
exception is an order the operator already released that a defect sent back:
once the amended plan passes every check, `src/forge/release-again.ts` agrees
it again and restarts the run. Beside the first draft, the scout reads the
repository; the architect does not wait for it (ADR 084).

**The Forge reads one readiness (ADR 074).** `src/forge/readiness.ts` is a pure
function over the order, its compile result, the last intake turn and the loop
facts read from the ledger (`loopFacts`, `agreedFacts`, `turnEndedAt` in
`src/forge/intake-outcome.ts`). It returns who holds the order, the status
strip, the six hand-off rows, each step's state word, the red-team findings
grouped by who acts, and the reason each lockable control is locked. The Forge
draws it and decides nothing. Every turn writes a start line: the loop's fix
turn records `converge.started` with reason `red team round N fix`. An
`order.agreed` by `rule:forge` is that re-agreement of a released order (`agreedFacts` reads it
as `automatic`); any other one is from a ledger written before ADR 078. `foundry:order.hold` records
`review.held` / `review.released`; every automatic continuation checks it, and
a release resumes through `afterRelease` (`src/forge/review-loop.ts`).
`foundry:order.recipe` saves the operator's shape to `order.recipe`, which
`recipeLadder` reads first. Unavailable controls are `ReasonButton`s:
`aria-disabled` plus `aria-describedby`, never the native `disabled`.

#### The Line (`src/line/`, `src/recipe/`, `src/verify/`, `src/gates/`)

- **Recipes** (`recipe/parse.ts`, `recipe/resolve.ts`) are YAML: a list of steps
  over five kinds — `agent`, `run`, `gate`, `fanout`, `join`. There is
  no sixth. The ten SpecKit phases are one recipe, `recipes/speckit.yaml`.
- **A failed check sends the work back** (ADR-063). A `run` step whose command
  is not a slash command runs as a command in a terminal tab
  (`SupervisedRunner.runCommand`), with `${toolchain.<check>}` resolved by
  `resolveCommand`; a check the repository has no command for is `skipped` and
  recorded as `step.not_measured`. Its output is tee'd to
  `<order>/runs/<node>.<attempt>.log`. The executor's `runCommand` and
  `collect` seams are required, so a `run` step never falls back to an agent
  because nothing could run it. A step with
  `onFail: { rework, max }` that fails while `reworks < max` calls
  `scheduler.rework`: the target's node in the checked lane, everything between
  it and the check, and the check go back to `waiting`, and the target's
  `feedback` carries the command, exit status and the last 120 lines of output
  into the builder's next brief. Ledger: `rework.started`. `direct`,
  `standard` and `bugfix` lint in the lane right after the build when the
  probe found a lint command. Before a node resumes a lane's conversation, its
  previous process is ended (`endSession` → `endAndWait`).
- **Skills are mounted, never installed** (ADR-065). Roles and steps declare
  `skills: [id]`, resolved like recipes on three rungs
  (`<dataRoot>/skills/<id>/SKILL.md`, a repository's `.foundry/skills/`, the
  extension's `skills/`). Before a node's agent launches, its skills are copied
  to `<order>/skills-mount/<node>/.claude/skills/` and passed with `--add-dir`;
  the tool policy allows reads there and refuses writes. An unknown skill
  refuses the run before it starts. The builder carries `ci-fix`.
- **A fan-out parallelises lanes, never units in one lane** (ADR-044). A lane is
  a worktree and a branch, so units inside one cannot run at the same time
  however many nodes point at them. `over: plan.units[role=builder] by lane`
  gives one node per lane, carrying that lane's units in dependency order —
  `RunNode.unitIds`, and every one of them listed in the brief with its own
  files and criteria. Measured on WO-0907-3c1, fanning out over seven units in
  a single lane spent seven cold `claude` starts on work that was serial in one
  checkout; the run's 21 nodes are 8 under the same order today.
- **`verify` is one fresh-context agent, not one per unit.** Fresh context is
  what makes a verdict independent of the work; fresh context _per unit_ adds
  nothing on top of that and doubled the session count of every order.
- **No recipe re-plans an agreed order.** The Forge's `converge` is the
  architect, and its plan is what the compile checks agreed. `direct` and
  `standard` used to open with a `plan` step that ran the architect again over
  an order it may not change — `applyRungOutput` refuses a `plan` from a rung —
  so it could only end in silence or a halt. It cost 8.2 minutes doing neither.
- **The shape is chosen from lanes and risk, never from unit count**
  (`proposeRecipe`, `recipeLadder`): `direct` (one lane at P2 or P3,
  flagged or not) → `standard` (more than one lane, or above P2). `direct`
  needs nothing from the repository: it checks with the project's own test
  command when there is one and with a fresh verifier when there is not (ADR
  086). A proposal walks the ladder to the first shape this repository can
  run, while an operator's explicit choice is honoured or refused, never
  quietly swapped.
- **Effort is a property of the shape** (ADR-050). A recipe declares
  `effort: low | medium | high | xhigh | max`, every agent step inherits it and
  a step may override it; the executor hands it to the launch beside the model
  tier and `buildLaunchSpec` passes it as `--effort`. `direct` and
  `research` run at `medium`, every other built-in at `high`. A recipe that declares none
  passes no flag, and a fast-tier role is never passed one — the fast model
  does not take it.
- **Six shapes** (ADR 086): `direct`, `standard`, `bugfix`, `refactor`,
  `speckit` and `research`. `direct` builds by lane, lints, checks (the test
  command as a `check` step when the repository has one, a fresh `verify` agent
  when it has not), inspects on a risk trigger, documents unless the change is
  graded P3, and ships. `research` (scout, author, fresh verifier) is the one
  shape whose product is a document, and it is never proposed: an operator
  picks it in the Forge.
- **Agents' work is committed by the line, and an empty change is a failure**
  (ADR 086). After an agent whose role may write the checkout passes, the
  executor commits its lane's worktree (`commitNode` → `commitWorktree`) with
  `<step>: <unit titles>`. A builder or author that passed with nothing to
  commit fails with `made no change to the checkout` (`step.no_change`); a
  scribe with nothing to document does not, and neither does an author whose
  document is outside the checkout. A commit git refuses — a pre-commit hook
  failing, most often — is not "no change": `commitWorktree` returns
  `refused` with what git printed, the step fails with "changed the checkout,
  but `git commit` exited 1" (`step.commit_refused`), that output is added to
  the node's `feedback` for its next attempt, and the repeat-fail gate carries
  it as evidence. `git commit` has five minutes (the repository's hooks run
  in it), and a commit that timed out is `refused` with "git commit timed out
  after 300 seconds", never read as a clean tree.
- **The author hands back a document** (ADR 086). `writes: [docs, document]`:
  the author writes `{ path, url?, location }` to its rung file, collected
  like the other artefacts onto `order.document` and recorded as
  `document.handed_back`. It may write under `<order>/outputs/` (named in its
  brief) as well as documentation in the checkout. `checkout` ships as a pull
  request; `outputs` and `published` open none, and the run ends on
  `run.document_ready`, which `standingOf` reads as done, "Finished · document
  ready". An author that hands nothing back fails the run with "the author
  handed back no document".
- **A documentation-only change runs a short final check** (ADR 086). When every
  changed path is documentation (`*.md`, `docs/`, `specs/`, `README*`,
  `CHANGELOG*`), `ladderFor` leaves only Format and Lint runnable and marks the
  other command steps not run, reason "documentation only".
- **Roles** are YAML data too, with a write list. A role with none is run
  read-only, enforced by the `PreToolUse` hook rather than by its prompt.
  `verifier` carries `allowResume: false`, and `assertResumable` refuses to
  hand it a session — a verdict from the working session is the builder marking
  its own homework with extra steps.
- **A rung hands back what it found through a file** (`line/rung-output.ts`).
  When the standard shape had nine steps, four were read-only roles whose whole
  product is a document — the scout's reconnaissance, the architect's plan, the
  red team's attack, the inspector's findings. (The scout, the plan and the red
  team have since moved into the Forge, and `standard` has seven steps.) The Line kept none of them:
  the brief named no destination, nothing read a rung's result past its exit
  status, and the read-only policy refused every channel the agents invented
  (`cat >`, `sed`, `awk`, then `Write`). Intake had always had the answer, so
  the Line now uses it: one JSON file at `<order>/rungs/<node>.json`, its schema
  in the brief, that one path allowed through `decideTool`, and a validated
  read-back that is merged and then cleared. **A role may only write the
  artefacts its own `writes:` declares** — `context`, `findings`, `plan`,
  `acceptance`, `document` (`COLLECTABLE`) — so the channel is a permission, not an open door, and a scout
  that decided to rewrite the plan is refused at the boundary.
- **What a rung disagrees with is a question, not an edit.** `context` informs
  the briefs that follow and leaves the order agreed. `findings` land where the
  structural red-team pass puts its own and take the amendment path. `plan` and
  `acceptance` are **reported and never applied**: the graph was compiled from
  the agreed order before the rung ran, so replacing it would orphan work in
  flight. Either kind of disagreement raises `forge-defect` — the rule for an
  order that contradicts itself, which was declared, rendered in the queue above the Forge, and
  until now raised by nothing.
  Answering it sends the order to the architect. Once the amended plan passes
  every check, `forge/release-again.ts` agrees it again and restarts the run,
  because the operator already released it. If either step fails, it records
  `run.refused` (ADR 090).
- **Nothing stops silently** (ADR 090). Every order whose standing says it is
  the operator's turn, and that no gate, question or held call already
  accounts for, is counted on the Forge badge (`ordersWaiting`) and listed
  there with its reason. A draft that no live session or pending decision is
  shaping is the operator's turn.
- **A run can be taken away again** (`line/teardown.ts`). `removeCheckout`
  shipped with the feature that cuts worktrees, was exported, was tested, and
  was called by nothing — so every run ever done left its checkout registered
  in the target repository's `.git/worktrees/` plus its branch. Two operations
  now, because they answer different questions. `foundry:run.reset` destroys
  what the **run** made — every lane's checkout and branch, the graph, the
  gates, the rung outputs — and returns the order to `agreed` so it runs again
  from node zero; the ask, the criteria, the plan and the ledger stay, which is
  the difference between starting over and retyping. `foundry:order.delete`
  does that and then takes the order's whole directory, ledger included.
  `order.cancel` is still there for a record worth keeping: it marks an order
  `cancelled` and changes nothing on disk.
- **One sidebar project per order, per repository** (`line/order-project.ts`,
  ADR-061). The lane checkout is cut before the architect's first turn, and
  the architect, every lane agent and every check command run in it — so the
  order is one project, named with lane 1's branch (`branchFor`): the ticket's
  recommended branch, else the lane's declared branch, else the repository's
  head branch, else `foundry/wo-…`. The order's ticket is linked to it, it
  sits under the workspace whose folder is the repository (not the first
  workspace in the sidebar), and reset and delete remove it with the
  checkout. A typed idea is offered a Linear ticket first when Linear is
  connected (`forge/ticket-offer.ts`), so its project can carry the ticket's
  name too. An intake conversation filed under another directory is started
  fresh, not resumed (`resumableIn`).
- **A deleted project closes its sessions** (`src/main/terminal/project-sessions.ts`).
  Whoever deletes a project — the sidebar, or an extension through
  `workspace.deleteProject` — every PTY in it is killed, its record marked
  closed, and its tabs dropped. Deleting an order also stops its architect.
- **The Forge decides what it is sure of** (`forge/autonomy.ts`, ADR-062).
  Questions at ≥ 0.9 confidence are answered with the recommended option and
  recorded as assumptions; a finding of any severity the architect is ≥ 0.9
  sure does not apply is accepted with its reason (`dismissConfidentFindings`:
  whether a finding blocks is now its `category`); closable failing checks go
  back to the architect up to twice (`MAX_AUTO_TURNS`).
- **Agent text is markdown** — rendered by the design system's `Markdown`
  (with `inline` for buttons and labels), which sanitises it so nothing an
  agent writes runs as HTML. Tool input stays literal.
- **Both order-level controls are always on the Floor.** They used to render
  only inside the "nothing is running this" band, so a live run — or one halted
  at a gate — had no way out on that screen at all, while `order.cancel`
  refuses a running order and points back at the gate. Each is a two-step
  confirm naming exactly what it will destroy: `window.confirm` inside an
  extension's WebContentsView blocks every event the view would receive
  afterwards.
- **Three-rung resolution** for every recipe, role and rule: the data root, the
  repository's own `.foundry/`, then the built-ins. The middle rung is honoured
  and never created (ADR-042).
- **Verdicts** are three-valued: `pass`, `fail`, `not_measured`. Coercing the
  third to a boolean anywhere turns "we did not check" into "it is fine".
- **Only a checking party stamps a verdict.** A role that may write is the one
  that did the work, and its turn ending says nothing about whether the criteria
  its unit claims are met — that claim is what verification exists to test. The
  executor used to write a verdict for every node with a unit, so a builder
  finishing recorded `pass` on every criterion off its own exit code, labelled
  `verifier`; `makeVerdict`'s structural guard was satisfied by passing
  `<sessionId>-verify` as the checking session, one suffix away from the working
  one. The checker is its own session now, held against the recorded session that
  produced the work, and absence reads as "not measured" in both the ladder and
  the pull-request body.
- **The regrade reads the world, not the plan.** `inspectionFor` and `regrade`
  answer for "the change the work turned out to be", and both were handed
  `plan.units.flatMap(u => u.touches)`, the files the plan _predicted_, with
  `linesChanged` hardcoded to zero. So no change could grade worse than it was
  planned as, and the `outside_blast_radius` trigger could only fire on an order
  inconsistent with itself. They read the working copies now, through the `readChangedFiles` and
  `readDiffSummary` that were already written and already correct and that the
  Line had never asked anything.
- **The ladder** (`verify/ladder.ts`) stops at the first failure, so a run does
  not spend an inspection budget on a change that does not compile.
- **Gates** (`gates/rules.ts`) are raised by ten named rules, never by phase
  boundaries. Each carries the rule, the reason, the evidence, its options with
  their consequences, and what happens if nobody answers. The **autonomy dial**
  selects which are live; six — `risk.p0`, `budget.exceeded`,
  `ready-for-review`, `run.interrupted`, `ci.red`, `refinery.conflict` — stay
  live at every setting.
- **The executor** (`line/executor.ts`) joins the scheduler, the roles and the
  supervised runner: a wave at a time, so the agent budget means something.
- **An accidental question costs five minutes, not a click** (ADR-049).
  `runtime/tool-decision.ts` takes the ordinary decisions an agent's tool calls
  need, and `DEFAULT_ASK_AFTER_MS` holds anything it does not take for five
  minutes before handing back to a terminal nobody is sitting at. Reading a
  command correctly is therefore a latency requirement, not only a correctness
  one: measured on WO-0910-1fb, thirteen of a builder's 131 calls were held and
  those thirteen ate 16.6 of the run's 26.7 minutes of tool time — 77 seconds
  a call against 5 for one that was taken. Four defects did it, all in reading:
  a discard was only a discard with whitespace after it, a parenthesis inside a
  quoted argument opened a nesting level, a heredoc body was read as shell, and
  the harness's own scratch directory was treated as territory outside the
  checkout. `shell-split.ts` tracks quoting and escaping and now heredocs,
  which are quoting; it is still not a shell parser. The OS temp roots are
  scratch, with the hole that names — a data root configured inside temp — in
  the ADR.
- **Auto mode answers what the policy abstains on (ADR 077).** With
  `terminator.foundry.letAutoModeDecide` on (the default), `decideTool` returns
  `mode` instead of `null` for a call it has no opinion on, a destructive one
  included. The one exception is the `escorted` setting. The bridge answers `defer`,
  and the hook script prints nothing, so Claude Code's `--permission-mode auto`
  decides. Returning `ask` would force a confirmation prompt, even in auto mode.
- **A stall is measured from the state the session is in now.**
  `evaluate-stall.ts` takes the later of the last tool call and `stateSince`,
  and the runner moves a session's `startedAt` whenever it is given a new turn.
  A session spans turns and its transcript keeps all of them, so a conversation
  the operator came back to twenty minutes later carried the previous turn's
  last call as its most recent activity: `run.stalled` landed on WO-0910-1fb
  twenty-one seconds into the run, raised against the architect's intake
  session rather than any run node.
- **A node carries its session while the agent is still in it.** `sessionId` was
  written onto the node after `deps.run` resolved — which is when the turn is
  over — so for the whole life of a rung the graph said `running` and named
  nobody, and the Floor's Watch and Attach, which render on
  `node.sessionId !== null`, appeared only once there was nothing left to attach
  to. The runner reports the session the moment it registers; the result names
  it again for a caller that reports none, and a set makes the second one a
  no-op rather than a second start.

#### Shipping (`src/line/integrate.ts`, `src/trackers/write-back.ts`)

Work ends in a draft pull request without being asked, one per repository, in
merge order, cross-linked. The decision offered afterwards is whether to mark
it ready — never whether to create it. For the two highest risk grades the
operator decides before anything reaches the remote; for everything lower the
draft opens first, so review happens on a real change.

**The draft opens before the final check** (ADR-085, `src/line/early-ship.ts`).
`shipOrder` (`src/line/integrate.ts`) is `openDrafts` then `watchAndFinish`;
`createEarlyShip` splits the two around the ladder. For a run whose work is done,
with no open gate and no inspection owed, and a grade below P1, the executor
calls `beforeFinalCheck` just before the ladder climbs: the drafts open and the
CI watch starts, and the ladder runs beside it. The ready gate is raised only
when the ladder passed and CI is green. A failed ladder raises the executor's
`verify.*` gates, records `ship.final_check_failed` and leaves the draft a
draft. Files a check wrote are committed (`commitWorktree`), pushed and watched
again. A lane already in `pulls.json` is reused, never created twice. The
recipe's terminal `ready-for-review` node stays `running` through all of this;
`settleShip` passes it when the ready gate is raised and returns it to
`waiting` if shipping stopped short, and `reclaim` ignores a running gate. The
ladder runs each distinct command once (`reusedFrom` on the step outcome), and
a role that writes only `docs` is refused edits outside documentation paths.

**CI is a check with rounds** (ADR-064, `src/line/ci.ts`, `src/line/ship-tail.ts`).
Before the ready gate, a recipe with `ci: { rounds }` has every draft's checks
polled through `gh pr checks --json` until nothing is pending. Green adds "CI
passed" to the ready gate; no checks is "not measured", never green. Red with
rounds left sends `gh run view --log-failed` back to the build step as `ci`
feedback, runs the Line again and pushes the lanes (`pushLanes`). With the
rounds spent, `ci.red` replaces the ready gate, and its "Another round" runs
one more. The state is in the order's `ci.json`, rewritten whenever the set of
check buckets changes while a round is watched (and `ci.watching` is recorded as
each round starts); `ciLabel` (`src/line/ci-label.ts`) is the words a surface
shows for it. The ready gate's `why` is Markdown, one fact per line: units and CI,
Acceptance (or "No verdicts were recorded"), Inspection ("Not run: <reason>"
when it was skipped), Not measured here, Judged against. A skipped `RunNode`
carries `skipReason` (from `whenSkipReason`, or "no <name> command in this
repository" for an unresolved `run` step). A failed one carries `failReason`
("exited 1 running `<command>`. The output is in `<log>`", "made no change to
the checkout", "changed the checkout, but `git commit` exited 1", or the unmet
expectations), and the stall gate's `why` comes from
`stalledWhy`: each failed step and its reason, then what is held up behind it,
or, with nothing failed, what each outstanding step waits on.

**The refinery restacks, it never merges** (ADR-067, `src/line/refinery.ts`,
`src/line/restack.ts`). Running and shipped orders in one repository and base
queue in agreed order; an order overlaps an earlier one when their changed
files intersect, and the Forge says so at agreement. A 60-second tick asks
GitHub whether each draft merged; when one has, each later overlapping order
is rebased lane by lane and pushed with lease, and its CI is watched again. A
conflicting rebase is aborted and raises `refinery.conflict`. `refinery.json`
records each merge acted on. The rebase and the push each have 120 seconds; one
that timed out is a `failed` restack ("git push timed out after 120 seconds"),
not a conflict, and a timed-out rebase is aborted. Shipping's push has the same
120 seconds and throws `PushRefusedError` on a timeout.

**Every command runs in the lane's worktree**, derived per lane by
`checkoutPath` exactly as the branch is derived by `branchFor`. Both were once
read raw off `context.repos[]`, which holds the _repository_ and a `headBranch`
that nothing writes — so shipping pushed `HEAD:` (refused outright by the first
real `git`) and then, once that was fixed, pushed the repository's `main` to the
head branch, putting the branch on the remote at the commit it was cut from.
GitHub answered the pull request with "No commits between main and
<branch>". Both are derived now, and `markReady` follows the path the draft was
opened from.

Three write-backs to the source issue: the agreed order as a comment, the
workflow state (`ExtensionAPI.issues.transition`, v2.3.0, ADR-041), and the
pull request links. A tracker write never affects the work: a failure is
retried, an unsupported capability is recorded once at agreement and never
asked about again.

The state follows the work, at three moments: the run starting moves the issue
to In Progress; opening the draft moves it to In Review (`shipOrder` calls
`IntegrateDeps.onDraftOpened` once every lane's draft is open, before the CI
watch, so the move no longer waits for CI); and the issue goes to Done only when
the refinery tick first sees every lane's pull request merged
(`RefineryTickDeps.onMerged`, once per order, guarded by `mergedAt`). Marking a
draft ready writes nothing to the tracker. Each successful write records
`writeback.ok` in the ledger beside the existing `writeback.failed`. A Linear
team with a single started state has no review state: the In Review move fails
and the ledger says the issue stays In Progress for that reason.

#### Sensors and signals (`src/sensors/`, ADR-066)

Sensors read the product's signals back into the factory and **propose** work;
nothing they see starts a run. A sensor is YAML resolved on the three rungs
(`sensors/<id>.yaml`): a source (`github-runs` on a branch, `github-issues`
with a label, or a `tracker` query), an interval and a severity. The two
built-ins, `ci-main-red` and `tracker-query`, are off until enabled in
Settings, which also names the repository each watches. One 60-second tick
(`src/sensors/sensor-tick.ts`, started by `activate()`) runs whatever is due,
and only while the application is open.

Collectors use `gh` and the core's issues API only. Items cluster by key
(workflow name; label and a normalised title) into signals in
`<dataRoot>/signals/signals.jsonl` (append-only; the latest line per signal
wins) with each sensor's state in `state.json`. Impact is occurrences × severity
(1, 3, 9). The queue above the Forge lists open signals below the gates, and the
Forge tab's badge counts no signals: it counts live undecided gates, orders waiting
on the operator, open questions and held tool calls (`countAttention`). Dismissing hides a signal until it grows by half again.
Promoting seeds a draft order whose `source.kind` is `signal`; it still has to
converge in the Forge and be agreed by a person.

#### The ledger (`src/ledger/`)

Append-only JSONL, one file per order, one object per line. A reversal is a new
entry; nothing rewrites a line. That is what lets several unit writers append
at once without a lock, and what makes the curator's citations meaningful
later. Every entry names an actor (`operator`, `rule:<id>` or `role:<id>`), an
action, a subject and a reason.

The **curator** (`ledger/curator.ts`) reads it and, _only when asked_, proposes
a rule for anything the operator has rejected three times for the same reason,
citing the entries. It imports no filesystem module and schedules nothing, and
the append path cannot reach it — an assistant that volunteers rules is one
whose rules get accepted without being read.

**Factory metrics** (`factory/metrics.ts`, `foundry:factory.metrics`) are a pure
function of what is already recorded — ledgers, gates and run graphs — so they
store nothing and can always be recomputed. Per order and over 30 days or all
time:

| Metric                 | Definition                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Lead time              | first `order.seeded` → first `ship.draft_opened`                                                        |
| Build time             | first `run.started` → first `ship.draft_opened`                                                         |
| Your time              | Σ (decided − raised) over gates the operator decided                                                    |
| First-pass yield       | shipped orders with no `rework.started`, `ci.round` or Send back, over shipped orders                   |
| Reworks, CI rounds     | counts of `rework.started`, `ci.round`                                                                  |
| Sessions               | Σ attempts over agent and fan-out nodes                                                                 |
| Forge follow-ups       | count of `converge.followed_up`, the turns the Forge started itself                                     |
| Forge decisions struck | struck `A-Q-*` assumptions over all of them — how well the architect's ≥ 90% confidence holds (ADR-062) |

The Ledger shows them under **Factory**, the factory site on its status wall,
and each hall's status wall draws its own order's time to ship, reworks and CI
rounds.

#### Surfaces

```
App
  ├─ Inbox   — a band across the top of the Forge, absent when empty: one
  │            queue, ranked by how much work each decision unblocks, every row
  │            naming the rule that raised it and what happens if it is ignored
  ├─ Orders  — the door; a row links its pull request and ticket, spins while
  │            CI works, and answers an open gate in place. The factory hall
  │            draws its waiting gates through the same one-line gate card
  │    ├─ Forge  — steps (intent → hand off), five checks, at most three questions
  │    └─ Floor  — the standing band with each running agent's last few
  │                transcript lines, the run graph, the merge order, held tool
  │                calls, the pull request and ticket links, the CI card, a
  │                Review button that runs the git extension's
  │                `review-pull-request` command, and a way into the terminal
  ├─ Ledger  — every decision, filtered by order / actor / action; the one
  │            button that asks the curator
  └─ Settings — the model picker, the model that answers asks, and the
                sensors; everything else is registered through the
                application's own settings API
```

#### What it does not do

- **It writes nothing into the repositories it works on** — no scaffolding, no
  configuration, not even a `.gitignore` entry (ADR-042). Records go to
  `terminator.foundry.dataDir`, or `<workdir>/.foundry/`, resolved once in
  `src/data-root.ts` and handed down as an absolute path.
- **It assumes no toolchain.** `verify/toolchain-probe.ts` reads manifests,
  tool configuration, Makefiles and CI workflows — and never executes them —
  recording the real command or `null`.
- **It holds no credential.** Tracker access is `ExtensionAPI.issues`, and
  `api.shell.exec` admits only `git` and `gh`. Each verification command runs
  in a terminal tab of its own in the lane's checkout
  (`SupervisedRunner.runCommand`): its output is visible, and its verdict is
  the tab's exit status, with no agent in between (ADR 059). The command's
  script is the tab's own process (`api.pty.runInTerminal`), nothing is typed
  into a shell, and an exit with no status (a signal, or the tab closed
  first) is "not measured", never a pass. The tab runs
  `$SHELL -i -l -c "exec $SHELL <script>"`: an interactive login shell reads
  the user's startup files, so what they export reaches the check as it did
  when the command was typed, then `exec` makes the script the process whose
  exit is reported.
- **It closes the tabs it opens (ADR 076).** A tab is titled for its agent
  ("Architect", "Red team", "Builder") or its check ("Lint"). An agent is
  stopped once its turn's output is collected, and `SupervisedRunner` closes a
  tab through `pty.closeTerminalTab` when its run or command ends cleanly. A
  failed one stays open, exited, so its output can be read. A later node in the
  lane resumes the conversation in a fresh tab.
- **It does not read its own records twice.** `src/state/foundry-index.ts` holds
  orders, run graphs, gates and ledgers in memory, one index per data root,
  loaded from disk the first time each is asked for. Every write still goes to
  disk first (disk is the source of truth) and then tells the index, which
  broadcasts `foundry:changed` `{ kind: 'order' | 'graph' | 'gates' | 'ledger' |
'live', orderId }` through `api.window.broadcast`. The renderer reads once on
  mount and again only for a change it draws (`renderer/use-pushed.ts`), so an
  open Floor costs the core nothing while nothing happens. `live` is the
  one kind with no file behind it — a held tool call, a stall, a running or
  stranded agent, an open intake, the feed — and carries an empty `orderId` when
  it is not tied to one order. The only polls left read what agents write in
  their own processes (transcript tails) or what sensors record on their own
  tick, and they stop while the view is hidden (`usePolling` in `@terminator/extension-ui`).
  **A record edited by hand under the data root is not noticed until the
  application restarts**: the index is told about Foundry's own writes and
  nothing else. The refinery's queue never runs git either: the files a
  checkout changed are recorded in `observed-files.json` when a step settles
  and read back from there.
- All `foundry:*` IPC channels are extension-owned. The core app has no
  knowledge of them: delete `extensions/foundry/` and core still builds.

#### Where the code lives

`src/index.ts` is a composition of under 80 lines: `activate` connects the
index, starts the supervision runtime, the sensor tick and the refinery tick,
and registers each surface's channels from its own module; `deactivate` stops
each. Process-wide state lives with its owner: the runtime's parts in
`runtime/runtime-state.ts`, the index in `state/live-index.ts`, the Forge's open
conversations in `forge/intake-sessions.ts`, executing and adopted orders in
`line/run-control.ts`. Channel registration is per surface in
`src/ipc/*-registration.ts`; the work they call is in `forge/` (`intake-turn.ts`,
`forge-loop.ts`), `line/` (`executor-deps.ts`, `execute-run.ts`, `ship-deps.ts`,
`run-control.ts`, `refinery-run.ts`) and `runtime/` (`supervision-runtime.ts`,
`held-calls.ts`, `palette-commands.ts`, `agent-policy.ts`).
`extensions/foundry/CLAUDE.md` has the full table.

#### ADRs

- [ADR-007: agent-runner-subprocess](adr/007-agent-runner-subprocess.md) — spawn Claude Code as a child process rather than using the Anthropic API directly.
- [ADR-026: supervised runs in a terminal](adr/026-supervised-runs-in-a-terminal.md) — work runs `claude` in a visible terminal behind a `PreToolUse` control server; the verified hook contract; why the stall detector ships in shadow mode.
- [ADR-040: the work order is the contract](adr/040-the-work-order-is-the-contract.md) — supersedes the card model (ADR-010) and the run modes (ADR-012).
- [ADR-041: an extension may move an issue](adr/041-an-extension-may-move-an-issue.md) — `ExtensionAPI.issues` v2.3.0, and the two writes it now permits.
- [ADR-067: the refinery restacks, it never merges](adr/067-the-refinery-restacks-it-never-merges.md) — overlapping orders queue; a merge restacks the later ones with lease and rechecks CI, or raises `refinery.conflict`.
- [ADR-066: sensors propose work, they never start it](adr/066-sensors-propose-never-start.md) — YAML sensors on a tick while the app is open, clustered signals in the Inbox, promote seeds a draft.
- [ADR-065: skills are mounted, never installed](adr/065-skills-are-mounted-never-installed.md) — `skills:` on roles and steps, three rungs, copied per node and passed with `--add-dir`.
- [ADR-087: the hall labels what it draws](adr/087-the-hall-labels-what-it-draws.md) — scoreboard, queue plate, junctions and CI tower say what they mean; aggregates replace per-check lamps; CI is recorded for replay.
- [ADR-086: six shapes and a document hand-back](adr/086-six-shapes-and-a-document-hand-back.md) — design-doc, poc, spike and quick removed; Foundry commits what agents write; research finishes on a document.
- [ADR-085: the draft opens before the final check](adr/085-the-draft-opens-before-the-final-check.md) — the final check runs beside CI; the scribe writes documentation only; repeated commands run once; the ship node stays running.
- [ADR-084: shaping starts with the architect](adr/084-shaping-starts-with-the-architect.md) — the scout runs beside the first draft; small orders skip the red team; amends ADR 075.
- [ADR-083: extension commands take validated arguments](adr/083-extension-commands-take-arguments.md) — `api.commands.register` accepts an `args` schema; views run another extension's command by id; v2.7.0.
- [ADR-082: the hall keeps time for its animations](adr/082-the-hall-keeps-time-for-its-animations.md) — a beat scheduler gives each animation its minimum time; replay starts at the first movement; idle crew wander.
- [ADR-064: CI is a check with rounds](adr/064-ci-is-a-check-with-rounds.md) — drafts' CI is watched, a red one goes back to the builder twice, then `ci.red`.
- [ADR-063: a failed check sends the work back](adr/063-a-failed-check-sends-the-work-back.md) — run steps run as commands, `onFail` reworks the builder with the failing output, the stalled gate names its node.
- [ADR-062: the Forge decides what it is sure of](adr/062-the-forge-decides-what-it-is-sure-of.md) — questions at ≥ 90% confidence are decided, low/medium findings dismissable, failing checks sent back up to twice.
- [ADR-061: one project per order, and an extension may file an issue](adr/061-one-project-per-order.md) — an order is one sidebar project named after its ticket's branch; `ExtensionAPI.issues.create` v2.5.0.
- [ADR-042: Foundry installs nothing](adr/042-foundry-installs-nothing.md) — the data root, the three rungs, and the toolchain probe.
- [ADR-043: an agent proposes the order](adr/043-an-agent-proposes-the-order-and-never-writes-it.md) — intake is an agent turn, and what it may and may not write.
- [ADR-049: an accidental question costs five minutes](adr/049-an-accidental-question-costs-five-minutes.md) — why a policy that asks by accident is a latency defect, and the eight changes measured against one live run.
- [ADR-056: a file count is not a budget](adr/056-a-file-count-is-not-a-budget.md) — budgets are agents and minutes; the files budget and the `budgets` check are gone.
- [ADR-070: E2E is deterministic and selective](adr/070-e2e-is-deterministic-and-selective.md) — no retries, flakes fixed at their cause, and a PR runs only the specs its diff selects.
- [ADR-072: a review reads definitions before their callers](adr/072-a-review-reads-definitions-before-callers.md) — tree-sitter orders a PR's files so a function comes before the code that calls it.
- [ADR-073: the review agent reads, and never writes](adr/073-the-review-agent-reads-and-never-writes.md) — headless `claude -p` with Read, Grep and Glob only, in a worktree at the PR head; findings stay private until posted.

The feature's own design documents are in
[`specs/037-foundry-software-factory/`](../specs/037-foundry-software-factory/):
the spec, the plan, fourteen research decisions, the data model, five contracts
and a ten-scenario quickstart.
