# Implementation Plan: Remote Control Browser Access

**Branch**: `remote-control` | **Date**: 2026-06-11 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/008-remote-control-browser/spec.md`

## Summary

Embed a password-protected Fastify HTTP + WebSocket server in the Electron main process. When the user enables Remote Control in Settings, the server starts on a configurable localhost port and an ngrok tunnel is spawned to produce a temporary public HTTPS URL. Browser clients authenticate with a bcrypt-verified password, then interact with live terminal sessions (full PTY streaming via WebSocket), and browse workspaces/projects. All remote server events route to the app's existing LogWindow. The feature is off by default and shuts down completely when disabled.

## Technical Context

**Language/Version**: TypeScript 5.x (existing project standard)  
**Primary Dependencies**: Fastify 4.x + @fastify/websocket 11.x + @fastify/static 8.x (new); bcryptjs (new); @xterm/xterm 6.x + @xterm/addon-attach + @xterm/addon-fit (new, browser SPA only); existing: node-pty 1.0.0, electron-store, zod 3.x, vitest 2.x  
**Storage**: electron-store (existing) — adds `remoteControl` key to GlobalSettings  
**Testing**: vitest 2.0.5 + fastify's built-in `inject()` for HTTP routes; `ws` package in devDependencies for WebSocket integration tests  
**Target Platform**: macOS (primary), Electron main process (Node.js runtime)  
**Performance Goals**: Terminal output ≤200ms round-trip on LAN; tunnel up within 10s of enable  
**Constraints**: Server binds 127.0.0.1 only; no 0.0.0.0 binding ever; bcrypt work factor 10; WsTickets expire in 30s  
**Scale/Scope**: Single-owner, single active session; no concurrency beyond multiple WS subscribers per terminal

## Constitution Check

| Principle                        | Status       | Notes                                                                                                                                                   |
| -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity              | ✅           | All dependency choices cite official docs (see research.md)                                                                                             |
| II. Extension Isolation          | ✅           | Remote server is core app code, not an extension                                                                                                        |
| IV. Dependency Stewardship       | ✅           | Fastify (multi-maintainer), bcryptjs (established), @xterm/xterm (official xterm.js org). All pinned.                                                   |
| V. Code Readability & Minimalism | ✅           | No speculative abstractions; WsTicket store is a plain Map                                                                                              |
| VI. TDD — 80% coverage gate      | ⚠️ MANDATORY | All new files in `src/main/remote/` and `src/renderer-remote/` MUST reach ≥80% before merge. Fastify `inject()` covers HTTP routes without a live port. |
| VII. SOLID & YAGNI               | ✅           | Phase 3 endpoints (git, task-vault) deferred; no premature abstraction                                                                                  |
| VIII. Documentation              | ✅           | ADR-017, README update, ARCHITECTURE.md, ipc-channels.md additions are explicit tasks                                                                   |
| IX. ADRs                         | ✅           | ADR-017 required for embedded HTTP server decision                                                                                                      |
| X. Code Cleanliness              | ✅           | No dead exports; lint must pass 0 errors before done                                                                                                    |
| XI. Functional Purity            | ✅           | WsSubscriberManager and WsTicketStore are side-effect-isolated modules                                                                                  |

## Project Structure

### Documentation (this feature)

```text
specs/008-remote-control-browser/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── contracts/
│   └── http-api.md      ← Phase 1 output
└── tasks.md             ← Phase 2 output (/speckit-tasks)
```

### Source Code Layout

```text
src/
├── main/
│   ├── remote/                          ← NEW: entire remote server module
│   │   ├── remote-server.ts             ← Fastify factory: start()/stop()
│   │   ├── auth.middleware.ts           ← onRequest hook: Bearer + Host validation
│   │   ├── ws-ticket-store.ts           ← In-memory ticket Map, expiry cleanup
│   │   ├── ws-subscriber-manager.ts     ← Per-session WS subscriber sets + primary tracking
│   │   ├── ngrok-manager.ts             ← spawn/kill ngrok, poll for URL
│   │   ├── routes/
│   │   │   ├── health.route.ts
│   │   │   ├── workspace.routes.ts
│   │   │   ├── terminal.routes.ts       ← CRUD + ws-ticket + WS upgrade
│   │   │   └── static.routes.ts         ← serves out/renderer-remote/
│   │   └── __tests__/
│   │       ├── auth.middleware.spec.ts
│   │       ├── ws-ticket-store.spec.ts
│   │       ├── ws-subscriber-manager.spec.ts
│   │       ├── ngrok-manager.spec.ts
│   │       ├── health.route.spec.ts
│   │       ├── workspace.routes.spec.ts
│   │       └── terminal.routes.spec.ts
│   ├── ipc/
│   │   └── remote.ipc.ts                ← NEW: registers remote: IPC handlers (reconnect, status)
│   ├── index.ts                         ← MODIFIED: wire remoteServer + remoteIpc
│   └── logger.ts                        ← UNMODIFIED (used via makeLogger)
├── shared/
│   ├── types/index.ts                   ← MODIFIED: add remoteControl to GlobalSettings
│   └── schemas/settings.schema.ts      ← MODIFIED: add remoteControl Zod schema + defaults
└── renderer/
    ├── App.tsx                          ← MODIFIED: add log:push + remote:* IPC listeners
    ├── components/
    │   └── settings/
    │       └── GlobalSettings.tsx       ← MODIFIED: add Remote Control section
    └── stores/
        └── log.store.ts                 ← UNMODIFIED (addEntry called via IPC listener)

src/renderer-remote/                     ← NEW: browser SPA entry
├── index.html
├── main.tsx
├── App.tsx
├── components/
│   ├── RemoteTerminal.tsx               ← xterm.js v6 + @xterm/addon-attach
│   └── WorkspaceNav.tsx
└── api/
    └── remote-client.ts                 ← fetch wrapper with Bearer token

docs/
└── adr/
    └── 017-embedded-http-remote-server.md   ← NEW

electron.vite.config.ts                 ← MODIFIED: add renderer-remote entry
```

## Implementation Phases

### Phase 1: Settings Schema Extension

Extend `GlobalSettings` with `remoteControl` and wire defaults. No UI yet — just the data layer.

**Files**:

- `src/shared/types/index.ts` — add `remoteControl` to `GlobalSettings` interface
- `src/shared/schemas/settings.schema.ts` — add `remoteControl` Zod schema + defaults

**Tests**: Settings schema tests (existing pattern — add test cases for new fields).

---

### Phase 2: Core Remote Server (no auth yet)

Implement `RemoteServer` factory with Fastify, health route, and graceful start/stop. No auth middleware yet.

**Files**:

- `src/main/remote/remote-server.ts`
- `src/main/remote/routes/health.route.ts`
- `src/main/remote/__tests__/health.route.spec.ts`

**Acceptance test**: `fastify.inject({ method: 'GET', url: '/health' })` returns `{ ok: true }` with status 200.

---

### Phase 3: Auth Middleware

Implement Bearer token validation and Host header DNS rebinding protection.

**Files**:

- `src/main/remote/auth.middleware.ts`
- `src/main/remote/__tests__/auth.middleware.spec.ts`

**Acceptance tests**:

- Missing `Authorization` header → 401 `{ error: 'UNAUTHORIZED' }`
- Wrong password → 401
- Correct password → pass-through to route
- `Host: evil.attacker.com` → 403 `{ error: 'FORBIDDEN' }`
- `Host: localhost` → pass-through

---

### Phase 4: WsTicket Store

Implement ticket creation, consumption, and expiry.

**Files**:

- `src/main/remote/ws-ticket-store.ts`
- `src/main/remote/__tests__/ws-ticket-store.spec.ts`

**Acceptance tests**:

- `createTicket(sessionId)` returns a 64-char hex string
- `consumeTicket(ticket)` returns the sessionId on first call, `null` on second (single-use)
- `consumeTicket(expiredTicket)` returns `null` after 30s
- `startCleanup()` / `stopCleanup()` start/stop the 60s interval

---

### Phase 5: WsSubscriberManager

Implement per-session subscriber sets with primary tracking.

**Files**:

- `src/main/remote/ws-subscriber-manager.ts`
- `src/main/remote/__tests__/ws-subscriber-manager.spec.ts`

**Acceptance tests**:

- `addSubscriber(sessionId, ws)` → first subscriber becomes primary
- Second `addSubscriber` → added to set, not primary
- `isPrimary(sessionId, ws)` → true only for first subscriber
- `broadcast(sessionId, data)` → data sent to all subscribers
- `removeSubscriber(sessionId, ws)` → removes from set; if was primary, `getPrimary()` returns `null`
- `destroySession(sessionId)` → all subscribers receive close frame, session removed

---

### Phase 6: NgrokManager

Implement ngrok child process lifecycle and URL discovery.

**Files**:

- `src/main/remote/ngrok-manager.ts`
- `src/main/remote/__tests__/ngrok-manager.spec.ts`

**Acceptance tests** (mock `child_process.spawn` and HTTP polling):

- `start(port)` spawns `ngrok http <port>`, polls until URL found, returns URL
- `start(port)` rejects after 10 failed polls
- `stop()` sends SIGTERM to child process
- `isInstalled()` returns `true` when `which ngrok` succeeds, `false` otherwise
- Unexpected process exit fires `onCrash` callback

---

### Phase 7: Workspace & Terminal HTTP Routes

Wire workspace listing and terminal CRUD routes to existing service layer.

**Files**:

- `src/main/remote/routes/workspace.routes.ts`
- `src/main/remote/routes/terminal.routes.ts` (CRUD + ws-ticket; WebSocket route in Phase 8)
- `src/main/remote/__tests__/workspace.routes.spec.ts`
- `src/main/remote/__tests__/terminal.routes.spec.ts`

**Acceptance tests** (via `fastify.inject()`):

- `GET /api/workspaces` → matches mock workspace store output
- `GET /api/projects?workspaceId=<id>` → matches mock project store output
- `POST /api/terminals` → 201 `{ sessionId }`, ptyManager.spawn called with correct args
- `DELETE /api/terminals/:id` → 200 `{ ok: true }`, ptyManager.kill called
- `POST /api/terminals/:id/resize` → 200, ptyManager.resize called with cols/rows
- `POST /api/terminals/:id/ws-ticket` → 201 `{ ticket }`, ticket length 64
- All above → 401 without correct password (auth middleware integration)

---

### Phase 8: WebSocket Terminal Streaming

Add the WS upgrade route and connect PTY output fan-out.

**Files**:

- `src/main/remote/routes/terminal.routes.ts` (WS route added)
- `src/main/remote/__tests__/terminal.routes.spec.ts` (WS tests added — requires live test server + `ws` devDep)

**Acceptance tests**:

- WS upgrade with valid ticket → connection established, PTY output forwarded as text frames
- WS upgrade with expired ticket → close code 4001
- WS upgrade with invalid session → close code 4002
- Text frame from primary subscriber → forwarded to ptyManager.write
- Text frame from secondary subscriber → silently dropped
- PTY exit → all subscribers receive close frame 1000

---

### Phase 9: Remote IPC + LogWindow Bridge

Wire `log:push` and `remote:*` IPC events to bridge main-process events to the renderer.

**Files**:

- `src/main/ipc/remote.ipc.ts` (NEW)
- `src/renderer/App.tsx` (add `window.electron.ipcRenderer.on('log:push', ...)` and `remote:*` listeners)

**Acceptance tests**:

- `remote.ipc.ts` unit tests: mock mainWindow, verify `webContents.send` is called with correct events

---

### Phase 10: Wiring in Main Process

Integrate `remoteServer` and `ngrokManager` into `src/main/index.ts`.

**Changes**:

- `app.whenReady()`: call `registerRemoteHandlers()` + conditionally start server if `settings.remoteControl.enabled`
- `before-quit`: `await remoteServer.stop()` BEFORE `ptyManager.killAll()`

---

### Phase 11: Settings UI — Remote Control Panel

Add Remote Control section to `GlobalSettings.tsx` in the Settings panel.

**Components**:

- Enable/disable toggle (calls `settings:update-global` with `remoteControl.enabled`)
- Port input (validated 1024–65535)
- Active tunnel URL display + copy button (reads from `remote:status` IPC)
- LAN URL display + copy button
- ngrok installed indicator with install hint
- Password masked field + show/copy + "Generate new" button
- All state driven by `remote:status` IPC event from main process

---

### Phase 12: Browser SPA

Implement the minimal remote-control browser UI.

**Files**: `src/renderer-remote/` — complete standalone React app.

**Components**:

- Login screen (password entry → stores token in sessionStorage)
- Workspace/project nav sidebar
- Terminal area with xterm.js v6 + `@xterm/addon-attach` + `@xterm/addon-fit`
- Terminal create/close controls

**Build**: Add `renderer-remote` entry to `electron.vite.config.ts`.

---

### Phase 13: Documentation

- `docs/adr/017-embedded-http-remote-server.md`
- `README.md` — add Remote Control to features table
- `docs/ARCHITECTURE.md` — add remote server to process model diagram
- `specs/001-extension-first-terminal/contracts/ipc-channels.md` — add `log:push`, `remote:*`, `remote:tunnel-disconnected`, `remote:tunnel-reconnect`, `remote:status`
- `src/renderer/electron.d.ts` — add new IPC channel type declarations

---

## New npm Dependencies

| Package                       | Where              | Justification                                                                                         |
| ----------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| `fastify@^4.28.1`             | root               | HTTP server framework. Multi-maintainer, TypeScript-first, testable via `inject()` without live port. |
| `@fastify/websocket@^11.0.1`  | root               | Official Fastify WS plugin, built on `ws@8`.                                                          |
| `@fastify/static@^8.0.0`      | root               | Serves browser SPA bundle. Official Fastify plugin.                                                   |
| `bcryptjs@^2.4.3`             | root               | Pure-JS bcrypt — no native compilation, no electron-rebuild step.                                     |
| `@xterm/xterm@^6.0.0`         | root (browser SPA) | Browser terminal emulator. Official xterm.js v6 package namespace.                                    |
| `@xterm/addon-attach@^0.11.0` | root (browser SPA) | Attaches xterm.js to WebSocket. Official addon.                                                       |
| `@xterm/addon-fit@^0.10.0`    | root (browser SPA) | Resizes terminal to container. Official addon.                                                        |
| `ws@^8.18.0`                  | devDependencies    | WebSocket test client for integration tests. Same version used by @fastify/websocket.                 |
| `@types/bcryptjs@^2.4.6`      | devDependencies    | TypeScript types for bcryptjs.                                                                        |
| `@types/ws@^8.5.13`           | devDependencies    | TypeScript types for ws test client.                                                                  |

## ADR Reference

**ADR-017** (`docs/adr/017-embedded-http-remote-server.md`): Documents the decision to embed a Fastify HTTP server in the Electron main process for remote browser access, including the rationale (PTY in main process as per ADR-001, no IPC double-hop), alternatives considered (separate Node.js process, Electron remote module), and security constraints (localhost-only binding, ngrok tunnel, password protection).

## Complexity Tracking

No constitution violations requiring justification. No complexity deviations from spec.
