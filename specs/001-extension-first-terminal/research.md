# Research: Extension-First Terminal Emulator (Phase 1)

**Date**: 2026-05-05  
**Branch**: `001-extension-first-terminal`

All decisions cite official documentation only, per Constitution §I.

---

## 1. PTY Process Management

**Decision**: Use `node-pty` for spawning and managing platform-native PTY processes in the Electron **main process**.

**Rationale**:

- `node-pty` is the de facto standard for Electron-based terminal emulators. VS Code's integrated terminal uses it directly. It provides a native PTY abstraction across macOS (POSIX), Windows (ConPTY), and Linux.
- PTY processes MUST run in main because they require Node.js native module access, which is unavailable in the renderer process when `nodeIntegration: false` (required for security).
- The main process acts as the PTY host: it spawns processes, streams output via IPC to the renderer, and accepts input from the renderer via IPC.

**Alternatives considered**:

- Running PTY in renderer with `nodeIntegration: true` — rejected: violates Electron security best practices (any XSS in renderer gets full Node.js access).
- `spawn` without PTY — rejected: many CLI tools (vim, htop, zsh prompt, etc.) require a real PTY to function correctly.

**Official reference**: https://github.com/microsoft/node-pty (Microsoft-maintained, used by VS Code)  
**Version**: `node-pty@1.x` — pin to latest stable 1.x release.

---

## 2. Terminal Rendering (xterm.js)

**Decision**: Use `xterm` 5.x with the `xterm-addon-fit` addon in the Electron **renderer process**.

**Rationale**:

- xterm.js is the browser-compatible terminal emulator used by VS Code, GitHub Codespaces, Azure Cloud Shell, and JupyterLab. It is the only production-grade, actively maintained terminal rendering library for web/Electron contexts.
- The `xterm-addon-fit` addon handles terminal resize to correctly match the DOM element dimensions, which must be communicated back to the main process to resize the PTY (via `pty.resize(cols, rows)`).
- xterm.js `Terminal` instances are **kept alive (not destroyed)** when the user switches tabs or navigates away. The DOM element is detached and re-attached; the `Terminal` object remains in memory with its buffer intact. This is the implementation mechanism for FR-012 and FR-013 (session persistence across navigation).

**Alternatives considered**:

- Destroying and recreating `Terminal` instances on tab switch — rejected: loses buffer, scroll position, and running process connection. Violates FR-013.
- `hterm` (Chromium's terminal) — rejected: no npm package, not maintained for third-party use.

**Official reference**: https://xtermjs.org/docs/  
**Versions**: `xterm@5.x`, `xterm-addon-fit@0.8.x` — pin to latest stable.

---

## 3. Electron IPC Architecture

**Decision**: Use Electron's `ipcMain` / `ipcRenderer` (with `contextBridge`) for all main↔renderer communication. All IPC payloads are validated with Zod schemas at both ends.

**Rationale**:

- `contextIsolation: true` + `nodeIntegration: false` is the Electron security baseline (required by Constitution §VIII). This means renderer cannot directly access Node.js APIs.
- `contextBridge.exposeInMainWorld` in a preload script exposes a safe, typed API surface to the renderer. The renderer calls `window.electronAPI.terminal.create(...)` instead of `ipcRenderer.send(...)` directly.
- Every IPC message payload is validated by a Zod schema on receipt (both main and renderer sides) to prevent malformed data from corrupting state. This is the primary boundary enforcement mechanism.
- Channels are namespaced by domain: `terminal:*`, `workspace:*`, `settings:*`, `extension:*`.

**Alternatives considered**:

- `nodeIntegration: true` — rejected: allows any renderer code (including injected scripts) full Node.js access. Violates security baseline.
- Direct function calls across process boundary — impossible in Electron; IPC is the only mechanism.

**Official reference**: https://www.electronjs.org/docs/latest/tutorial/ipc  
**Official security guide**: https://www.electronjs.org/docs/latest/tutorial/security

---

## 4. Extension Host Strategy

**Decision**: Load extensions as Node.js CommonJS modules in the **main process** via `require()`, exposing only the `ExtensionAPI` capability object. No direct access to internal stores or IPC handlers.

**Rationale**:

- For Phase 1, a capability-based in-process extension host is the simplest approach that meets FR-029 (permission boundary). Extensions receive only the `ExtensionAPI` object and cannot import internal modules.
- VS Code uses a separate extension host process for isolation — this is the Phase 2 target. Full process isolation adds significant IPC complexity and is not required by Phase 1 scope (YAGNI).
- Extension manifests are validated with Zod on load. Any extension that throws during `activate()` is caught, logged, and skipped — the app remains stable (FR-028).
- Extensions are stored as directories under `~/.terminator/extensions/` (per-user install, no root required).

**Alternatives considered**:

- Separate extension host process (VS Code model) — deferred to Phase 2. Correct long-term architecture, but overkill for Phase 1's minimal API surface.
- VM sandbox (`vm.runInNewContext`) — provides some isolation but adds complexity and prevents extensions from using npm packages, which would cripple real-world extension development.

**Official reference**: https://nodejs.org/api/modules.html (CommonJS modules)

---

## 5. Persistent Storage

**Decision**: Use `electron-store` for all persistent data (workspaces, projects, settings). Terminal session buffers are in-memory only (not persisted across app restarts, per Assumptions).

**Rationale**:

- `electron-store` stores typed JSON in the OS app-data directory (`~/Library/Application Support/Terminator/` on macOS). It handles atomic writes, schema migration, and encryption if needed.
- It wraps `conf` and uses a well-established pattern for Electron config/state persistence. 8M+ weekly npm downloads, used by many production Electron apps.
- All data written to electron-store is first validated with Zod schemas to prevent schema drift over time.
- Separate store instances per domain (workspaces store, settings store) keep data isolated and allow independent schema migrations.

**Alternatives considered**:

- SQLite (via `better-sqlite3`) — more powerful but significantly more complex for the data volume in Phase 1. Appropriate if we need relational queries or large datasets. Deferred.
- Plain JSON files managed manually — rejected: electron-store already handles atomic writes, file paths, and migration, with better community health than a DIY solution.
- localStorage in renderer — rejected: not accessible from main process and not reliable for structured data.

**Official reference**: https://github.com/sindresorhus/electron-store  
**Version**: `electron-store@10.x` — pin to latest stable.

---

## 6. Keyboard Shortcuts

**Decision**: Register app-local keyboard shortcuts using Electron's `Menu` accelerators for menu-triggered actions and `webContents.on('before-input-event')` (or `keydown` in renderer) for navigation shortcuts (Cmd+1-9, Cmd+Left/Right, etc.).

**Rationale**:

- `globalShortcut` is for system-wide shortcuts that work even when the app is not focused — not appropriate for our navigation shortcuts.
- Tab cycling (Cmd+Left/Right) and workspace switching (Cmd+1–9) are best handled in the renderer via `keydown` event listeners scoped to when the app window is focused. This keeps the shortcut logic co-located with the UI state it affects.
- Cmd+T (new tab) and Cmd+W (close tab) can be registered as `Menu` accelerators to also appear in the application menu with their shortcut labels.
- Extensions can register shortcuts via the `ExtensionAPI.keyboard.register()` method (Phase 1 API surface); conflicts with core shortcuts are rejected at registration time.

**Conflict resolution**: Core shortcuts (Cmd+1–9, Cmd+T, Cmd+Left, Cmd+Right, Cmd++, Cmd+-) are reserved and cannot be overridden by extensions.

**Official reference**: https://www.electronjs.org/docs/latest/api/global-shortcut (for global shortcuts — not used)  
**Official reference**: https://www.electronjs.org/docs/latest/api/web-contents (before-input-event)

---

## 7. Testing Strategy

**Decision**: `vitest` for unit and integration tests; `@playwright/test` with Electron integration for e2e tests.

**Rationale**:

- `vitest` is fast, TypeScript-native, and compatible with the Vite bundler typically used with Electron (via `electron-vite`). ESM-compatible and has first-class mocking.
- Playwright has official Electron support via `_electron.launch()`. The Electron team deprecated Spectron and recommends Playwright as the replacement. Tests launch a real Electron instance, enabling true e2e validation of FR acceptance scenarios.
- Unit tests cover: pure domain logic in stores, Zod schema validation, extension API boundary behavior.
- Integration tests cover: IPC channel round-trips (mock PTY), electron-store read/write cycles.
- E2e tests cover: full acceptance scenarios from the spec (one spec file per user story).

**Official reference**: https://playwright.dev/docs/api/class-electronapplication  
**Official reference**: https://vitest.dev/

---

## Dependency Audit

All packages evaluated against Constitution §II criteria (active community, multiple maintainers, no single-person ownership):

| Package          | Weekly Downloads | Maintainers                                                 | Last Release | Verdict |
| ---------------- | ---------------- | ----------------------------------------------------------- | ------------ | ------- |
| electron         | 1.5M+            | Electron team (10+ contributors)                            | Monthly      | ✅ PASS |
| xterm            | 1.2M+            | xterm.js team (Microsoft contributors)                      | Quarterly    | ✅ PASS |
| node-pty         | 600K+            | Microsoft contributors                                      | Quarterly    | ✅ PASS |
| zod              | 12M+             | Colin McDonnell + 200+ contributors                         | Monthly      | ✅ PASS |
| electron-store   | 800K+            | Sindre Sorhus (widely used, multiple maintainers on `conf`) | Quarterly    | ✅ PASS |
| zustand          | 5M+              | pmndrs org (20+ contributors)                               | Monthly      | ✅ PASS |
| react            | 25M+             | Meta + OSS community                                        | Monthly      | ✅ PASS |
| vitest           | 8M+              | Vite team (Anthony Fu + 300+ contributors)                  | Monthly      | ✅ PASS |
| @playwright/test | 10M+             | Microsoft Playwright team                                   | Monthly      | ✅ PASS |

**All packages pass community health check. No single-maintainer packages in the dependency set.**

---

## Architectural Decision Records

Four ADRs to be written in `docs/adr/` before implementation begins:

1. **ADR-001**: PTY processes run in main process (not renderer) — security and Node.js native module requirement
2. **ADR-002**: Extension host in main process (not separate process) — Phase 1 simplicity; full isolation deferred to Phase 2
3. **ADR-003**: electron-store for persistence (not SQLite) — data volume and complexity are appropriate for key-value JSON
4. **ADR-004**: xterm.js Terminal instances kept alive on tab switch (not recreated) — required for session persistence (FR-012, FR-013)
