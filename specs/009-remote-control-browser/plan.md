# Implementation Plan: Remote Control Browser Access

**Branch**: `remote-control` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/009-remote-control-browser/spec.md`

## Summary

Embed a password-protected Fastify HTTP + WebSocket server in the Electron main process, exposed via an ngrok tunnel, so users can interact with their live Terminator terminals and workspaces from any browser. The server binds exclusively to `127.0.0.1`, uses bcrypt-hashed password auth with DNS-rebinding protection, and serves a minimal React SPA for login and terminal streaming (xterm.js v6). All core tech decisions are pre-resolved in `research.md` (8 decisions from the original planning session + 3 new decisions from the 2026-06-13 clarification session).

---

## Technical Context

**Language/Version**: TypeScript 5.x / Node.js 20 (Electron 30 runtime)  
**Primary Dependencies**:

- Server: `fastify@4.28.1`, `@fastify/websocket@11.0.1`, `@fastify/static@8.0.0`
- Auth: `bcryptjs@2.4.3` (pure-JS bcrypt, no native recompile)
- Browser SPA: `@xterm/xterm@6.0.0`, `@xterm/addon-attach@0.11.0`, `@xterm/addon-fit@0.10.0`
- Dev: `ws@8.18.0` (WS client for tests), `@types/bcryptjs@2.4.6`, `@types/ws@8.5.13`

**Storage**: `electron-store` (existing) — `GlobalSettings.remoteControl` key added  
**Testing**: vitest + `fastify.inject()` for routes (no live port needed); `ws` package for WebSocket tests  
**Target Platform**: macOS (primary), Electron 30 / Chromium 124 / Node.js 20  
**Project Type**: Electron desktop-app with embedded HTTP server  
**Performance Goals**: Terminal output <200ms p95 on LAN (SC-002); tunnel active <30s from enable (SC-001)  
**Constraints**: Bind to `127.0.0.1` only (FR-002); 80% coverage gate (SC-007); no `0.0.0.0` exposure  
**Scale/Scope**: Single owner, single password, up to 20 WS subscribers per terminal session (FR-032)

---

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design._

| Principle                  | Gate                                             | Status  | Notes                                                                                 |
| -------------------------- | ------------------------------------------------ | ------- | ------------------------------------------------------------------------------------- |
| I. Source Integrity        | All tech choices from official docs              | ✅ PASS | Fastify, ngrok agent API, xterm cited in research.md                                  |
| II. Extension Isolation    | N/A — this feature is core app, not an extension | ✅ N/A  | The `src/main/remote/` module is standalone; no extension API surface required        |
| IV. Dependency Stewardship | Multi-maintainer, no CVEs, pinned versions       | ✅ PASS | Fastify (multi-maintainer), bcryptjs (DefinitelyTyped), @xterm (official xtermjs org) |
| V. Code Readability        | No speculative code; YAGNI                       | ✅ PASS | Phase 3 endpoints (git, task-vault) explicitly deferred out of scope                  |
| VI. TDD                    | Red → Green → Refactor; 80% coverage gate        | ✅ PASS | All tasks.md test tasks precede their implementation tasks                            |
| VII. SOLID & YAGNI         | Solve today's problem; no premature abstraction  | ✅ PASS | WsSubscriberManager, WsTicketStore are minimal focused classes                        |
| VIII. Documentation        | Docs ship with code                              | ✅ PASS | ADR 017, ipc-channels.md, ARCHITECTURE.md updates required before merge               |
| IX. ADRs                   | Significant decision captured                    | ✅ PASS | `docs/adr/017-embedded-http-remote-server.md` already exists                          |
| X. Code Cleanliness        | 0 lint errors                                    | ✅ PASS | Enforced by pre-commit hook                                                           |
| XI. Functional Purity      | Side effects isolated                            | ✅ PASS | WsTicketStore, NgrokManager have isolated I/O boundaries                              |
| XII. UI Icons              | lucide-react only                                | ✅ PASS | Settings UI must use lucide-react icons (no emoji, no unicode)                        |

**No violations. All gates pass. Proceed to Phase 1.**

---

## Project Structure

### Documentation (this feature)

```text
specs/009-remote-control-browser/
├── plan.md              ← This file
├── spec.md              ← Feature specification
├── research.md          ← 11 technical decisions
├── data-model.md        ← Entity definitions + state transitions
├── quickstart.md        ← End-to-end test scenarios
├── contracts/
│   └── http-api.md      ← REST + WebSocket endpoint contract
├── checklists/
│   └── requirements.md  ← Quality checklist (all passing)
└── tasks.md             ← Task breakdown (run /speckit-tasks to regenerate)
```

### Source Code

```text
src/main/remote/                        # NEW — HTTP server + tunnel management
├── remote-server.ts                    # Fastify factory: start(), stop(), isListening()
├── auth.middleware.ts                  # onRequest hook: Bearer token + Host header check
├── ngrok-manager.ts                    # Spawn/poll/stop ngrok; --web-addr 0.0.0.0:4041
├── ws-ticket-store.ts                  # 30s expiry, single-use, in-memory Map
├── ws-subscriber-manager.ts            # Per-session Set<WebSocket>; primary tracking; cap enforcement
├── bridge-event-bus.ts                 # EventEmitter: main-process → WS bridge relay
├── ipc-registry.ts                     # Map of registered ipcMain handlers (for bridge routing)
└── routes/
    ├── health.route.ts                 # GET /health → { ok: true }
    ├── terminal.routes.ts              # POST/GET/DELETE /api/terminals + resize + ws-ticket
    ├── workspace.routes.ts             # GET /api/workspaces + /api/projects
    └── bridge.route.ts                 # WS /api/bridge (IPC bridge proxy)

src/main/remote/__tests__/              # NEW — vitest specs (1:1 with above files)
├── remote-server.spec.ts
├── auth.middleware.spec.ts
├── ngrok-manager.spec.ts
├── ws-ticket-store.spec.ts
├── ws-subscriber-manager.spec.ts
└── routes/
    ├── terminal.routes.spec.ts
    ├── workspace.routes.spec.ts
    └── bridge.route.spec.ts

src/main/ipc/remote.ipc.ts             # NEW — IPC handlers: remote:start/stop/status/reconnect
src/main/ipc/__tests__/remote.ipc.spec.ts  # NEW

src/renderer-remote/                   # NEW — Browser login + terminal SPA (separate Vite entry)
├── index.html
├── main.tsx
├── App.tsx                             # Login screen → authenticated shell
├── components/
│   ├── RemoteTerminal.tsx              # xterm.js v6 + addon-attach + addon-fit
│   ├── WorkspaceNav.tsx                # Workspace/project sidebar
│   └── Login.tsx                      # Password form
└── api/
    └── remote-client.ts               # fetch wrapper: Authorization header injection

src/shared/types/index.ts              # MODIFIED — GlobalSettings.remoteControl field added
src/shared/schemas/settings.schema.ts  # MODIFIED — Zod remoteControl schema + defaults

src/renderer/components/settings/GlobalSettings.tsx  # MODIFIED — Remote Control section
src/renderer/App.tsx                                 # MODIFIED — log:push + remote:status IPC listeners

docs/adr/017-embedded-http-remote-server.md  # EXISTS — no changes required
docs/ARCHITECTURE.md                          # MODIFIED — Remote Control Server section
specs/001-extension-first-terminal/contracts/ipc-channels.md  # MODIFIED — new channels + HTTP endpoints
```

**Structure Decision**: Single-project layout. The remote server lives entirely within `src/main/remote/` — a self-contained module with no coupling to extension infrastructure. The browser SPA lives in `src/renderer-remote/` as a second Vite renderer entry that produces a separate bundle (`out/renderer-remote/`). This avoids any `xterm@5` / `@xterm/xterm@6` namespace collision with the Electron renderer.

---

## Implementation Phases

### Phase 1: Setup

Install dependencies, scaffold directories, add Vite entry for renderer-remote, extend `GlobalSettings` type + schema.

Key tasks:

- Pin all new deps (no `^` — exact versions)
- `maxSubscribers` field included in GlobalSettings from day one (default: 5)
- `renderer-remote` Vite entry outputs to `out/renderer-remote/` (served by `@fastify/static`)

### Phase 2: Foundational

Core pure utilities with full test coverage before any user story work:

- `WsTicketStore` (30s expiry, single-use, 60s background prune)
- `WsSubscriberManager` (primary tracking, per-session cap enforcement via `maxSubscribers`)
- `GlobalSettings` schema validation tests

### Phase 3: User Story 1 — Enable/Disable Remote Control

Server lifecycle + ngrok tunnel + Settings UI:

- `RemoteServer` factory binds `127.0.0.1`, registers health route
- `NgrokManager` spawns with `--web-addr 0.0.0.0:4041`, polls port 4041 for URL
- Port-change-while-running triggers auto-restart (stop → start on new port, ngrok restart)
- Settings UI toggle, URL display, LAN URL, ngrok status indicator

### Phase 4: User Story 2 — Browser Terminal Interaction

Terminal streaming end-to-end:

- Auth middleware (Bearer token + Host header)
- Terminal routes (create/read/delete/resize/ws-ticket)
- WebSocket terminal handler (subscriber fan-out, primary write gating, cap enforcement with close code 4003)
- Browser SPA: Login → RemoteTerminal (xterm.js v6 + addon-attach + addon-fit)

### Phase 5: User Story 3 — Password Configuration

- `POST /api/terminals/:id/ws-ticket` → 30s expiry, single-use
- "Generate new" invalidates all active sessions
- Password auto-generation on empty field save

### Phase 6: User Story 4 — ngrok Crash / Reconnect

- `onCrash` callback → `remote:tunnel-disconnected` IPC → toast + "Reconnect" button
- Manual reconnect via `remote:tunnel-reconnect` IPC
- 3-failure abort with error toast (per FR-006a)

### Phase 7: User Story 5 — Workspace & Project Browsing

- Workspace routes (`/api/workspaces`, `/api/projects`)
- `WorkspaceNav.tsx` sidebar in browser SPA
- Terminal creation with project `cwd`

### Phase 8: User Story 6 — LAN-Only Access

- LAN URL always shown (uses `os.networkInterfaces()`, Decision 5 in research.md)
- "Copy Caddyfile" generates reverse-proxy config (FR-030)

### Phase 9: User Story 7 — ngrok Not Installed

- `NgrokManager.isInstalled()` → Settings UI shows install hint if false
- Local server still starts; LAN URL shown; tunnel section hidden with explanation

### Phase 10: Polish & Validation

- `npm run lint` → 0 errors
- `npx vitest run --coverage` → all thresholds ≥ 80%
- `docs/ARCHITECTURE.md` Remote Control section
- `ipc-channels.md` updated with all new channels + HTTP endpoints
- Manual end-to-end test via quickstart.md scenarios

---

## Complexity Tracking

No constitution violations requiring justification. All complexity deviations from YAGNI are documented as explicit Phase 3 deferrals in the spec's Out of Scope section.
