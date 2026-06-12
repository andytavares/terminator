# Tasks: Remote Control Browser Access

**Input**: Design documents from `specs/008-remote-control-browser/`  
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/http-api.md ✅

**Tests**: TDD is NON-NEGOTIABLE (Constitution §VI). Write failing tests first — Red → Green → Refactor. Every new production file must reach ≥80% coverage before merge.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: User story label — US1 through US6 (maps to spec.md priorities)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies and scaffold the new module directories.

- [ ] T001 Install production dependencies: `fastify@4.28.1`, `@fastify/websocket@11.0.1`, `@fastify/static@8.0.0`, `bcryptjs@2.4.3`, `@xterm/xterm@6.0.0`, `@xterm/addon-attach@0.11.0`, `@xterm/addon-fit@0.10.0` in root `package.json` (pinned exact versions — no `^`)
- [ ] T002 Install dev dependencies: `ws@8.18.0`, `@types/bcryptjs@2.4.6`, `@types/ws@8.5.13` in root `package.json` (pinned exact versions — no `^`)
- [ ] T003 [P] Create directory scaffold: `src/main/remote/`, `src/main/remote/routes/`, `src/main/remote/__tests__/`, `src/renderer-remote/`, `src/renderer-remote/components/`, `src/renderer-remote/api/`
- [ ] T004 [P] Add `renderer-remote` entry to `electron.vite.config.ts` pointing to `src/renderer-remote/index.html`, output to `out/renderer-remote/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core data layer and pure utility modules that all user stories depend on. No user story work begins until this phase is complete.

**⚠️ CRITICAL**: All Phase 3+ tasks depend on this phase being complete.

- [ ] T005 Add `remoteControl: { enabled: boolean; port: number; password: string; passwordHash: string }` to `GlobalSettings` interface in `src/shared/types/index.ts`
- [ ] T006 Add `remoteControl` Zod schema and defaults `{ enabled: false, port: 7681, password: '', passwordHash: '' }` to `src/shared/schemas/settings.schema.ts`
- [ ] T007 [P] Write tests for `remoteControl` schema validation (valid port range 1024–65535, invalid port rejection, defaults) in `src/shared/schemas/__tests__/settings.schema.spec.ts`
- [ ] T009 [P] Write tests for `WsTicketStore`: create returns 64-char hex; consume returns sessionId on first call, null on second; expired ticket returns null; cleanup interval cleared on stop in `src/main/remote/__tests__/ws-ticket-store.spec.ts`
- [ ] T008 Implement `WsTicketStore`: `createTicket(sessionId)`, `consumeTicket(ticket)`, `startCleanup()`, `stopCleanup()` — 30s expiry, single-use, 60s background prune in `src/main/remote/ws-ticket-store.ts` (after T009 is RED)
- [ ] T011 [P] Write tests for `WsSubscriberManager`: first subscriber becomes primary; second subscriber added but not primary; broadcast sends to all; remove primary sets primary to null; destroySession closes all subscribers in `src/main/remote/__tests__/ws-subscriber-manager.spec.ts`
- [ ] T010 Implement `WsSubscriberManager`: `addSubscriber(sessionId, ws)`, `removeSubscriber(sessionId, ws)`, `isPrimary(sessionId, ws)`, `broadcast(sessionId, data)`, `destroySession(sessionId)`, `getPrimary(sessionId)` in `src/main/remote/ws-subscriber-manager.ts` (after T011 is RED)

**Checkpoint**: Schema extended, WsTicketStore and WsSubscriberManager tested and green. User story work can now begin.

---

## Phase 3: User Story 1 — Enable Remote Access from Settings (Priority: P1) 🎯 MVP

**Goal**: User enables Remote Control in Settings → server starts on localhost, ngrok spawns and provides a public URL, user can toggle it off to tear everything down.

**Independent Test**: Toggle Remote Control on in Settings UI. Verify public URL appears in ≤10s. Toggle off. Verify URL disappears and no port remains bound.

### Tests for User Story 1

> **Write these tests FIRST — ensure they FAIL before implementation**

- [ ] T012 [P] [US1] Write tests for `RemoteServer`: `start()` binds to 127.0.0.1 on configured port; `stop()` closes the server; double-stop is safe; `/health` returns 200 `{ ok: true }` via `fastify.inject()` in `src/main/remote/__tests__/remote-server.spec.ts`
- [ ] T013 [P] [US1] Write tests for `NgrokManager`: `isInstalled()` returns true/false based on mocked `which`; `start(port)` spawns ngrok and resolves with URL from mocked agent API poll; `start(port)` rejects after 10 failed polls; `stop()` sends SIGTERM; unexpected exit fires `onCrash` callback in `src/main/remote/__tests__/ngrok-manager.spec.ts`
- [ ] T014 [P] [US1] Write tests for `remote.ipc.ts`: `sendStatus(win, payload)` calls `webContents.send('remote:status', payload)`; `sendLog(win, level, msg)` calls `webContents.send('log:push', ...)` in `src/main/ipc/__tests__/remote.ipc.spec.ts`

### Implementation for User Story 1

- [ ] T015 [US1] Implement `RemoteServer` factory with Fastify: `start({ port, ptyManager, settingsStore, getWindow })` binds `127.0.0.1`, registers health route, returns `{ stop() }` in `src/main/remote/remote-server.ts`
- [ ] T016 [US1] Implement health route `GET /health → { ok: true }` (no auth) in `src/main/remote/routes/health.route.ts`
- [ ] T017 [US1] Implement `NgrokManager`: `isInstalled()` via `which ngrok`; `start(port)` spawns child process and polls `localhost:4040/api/tunnels` (10 × 500ms); `stop()` sends SIGTERM; `onCrash` callback support in `src/main/remote/ngrok-manager.ts`
- [ ] T018 [US1] Implement `remote.ipc.ts`: register `ipcMain.on('remote:tunnel-reconnect', ...)` to restart ngrok; expose `sendStatus(win, payload)` and `sendLog(win, level, msg)` helpers for main→renderer push in `src/main/ipc/remote.ipc.ts`
- [ ] T019 [US1] Wire Remote Control into `src/main/index.ts`: call `registerRemoteHandlers(getWindow)`, start remote server + ngrok if `settings.remoteControl.enabled` in `app.whenReady()`; add `await remoteServer.stop()` BEFORE `ptyManager.killAll()` in `before-quit`
- [ ] T020 [US1] Add `log:push` and `remote:status` / `remote:tunnel-disconnected` / `remote:tunnel-reconnect` IPC listeners to `src/renderer/App.tsx` — `log:push` calls `useLogStore().addEntry()`; `remote:tunnel-disconnected` shows toast with "Reconnect" button
- [ ] T021 [US1] Add Remote Control section to `src/renderer/components/settings/GlobalSettings.tsx`: enable/disable toggle; port input; active tunnel URL + copy button; LAN URL + copy button; reads state from `remote:status` IPC event

- [ ] T056 [US1] Write test for `RemoteServer` EADDRINUSE: when `start()` receives `EADDRINUSE` error, it calls `sendStatus` with `{ error: 'PORT_IN_USE' }` and rejects with a user-readable message in `src/main/remote/__tests__/remote-server.spec.ts`
- [ ] T057 [US1] Handle `EADDRINUSE` in `RemoteServer.start()`: catch the bind error, call `getWindow()?.webContents.send('remote:status', { error: 'PORT_IN_USE', message: 'Port X is already in use. Change the port in Settings.' })`, reject the promise in `src/main/remote/remote-server.ts`

**Checkpoint**: Remote Control can be toggled on/off in Settings. Public URL appears, LAN URL shown, server shuts down cleanly on toggle-off. Port collision surfaces a toast.

---

## Phase 4: User Story 2 — Browser Terminal Interaction (Priority: P1)

**Goal**: From the browser UI, user creates a terminal, types commands, sees real-time output, resizes, and closes the terminal.

**Independent Test**: With server running locally, open `http://localhost:7681/` in browser (bypass auth for this test with correct password). Create terminal, run `echo hello`, verify output appears in ≤200ms. Resize window, verify terminal redraws. Close terminal, verify PTY is gone from `ptyManager.getSessionIds()`.

### Tests for User Story 2

> **Write these tests FIRST — ensure they FAIL before implementation**

- [ ] T022 [P] [US2] Write tests for terminal HTTP routes (no WebSocket): `POST /api/terminals` → 201 `{ sessionId }` (mock ptyManager.spawn); `GET /api/terminals/:id` → 200 metadata; `DELETE /api/terminals/:id` → 200 + mock kill; `POST /api/terminals/:id/resize` → 200 + mock resize; `POST /api/terminals/:id/ws-ticket` → 201 `{ ticket }`; all 404 for unknown IDs in `src/main/remote/__tests__/terminal.routes.spec.ts`
- [ ] T023 [US2] Write WebSocket integration tests: WS upgrade with valid ticket → connection established + PTY output forwarded; primary subscriber input forwarded to ptyManager.write; secondary subscriber input dropped; PTY exit closes WS with code 1000; invalid ticket → close 4001; unknown session → close 4002 in `src/main/remote/__tests__/terminal.routes.spec.ts` (add to same file, requires live test server + `ws` client)

### Implementation for User Story 2

- [ ] T024 [US2] Implement terminal HTTP routes: `POST /api/terminals`, `GET /api/terminals/:id`, `DELETE /api/terminals/:id`, `POST /api/terminals/:id/resize`, `POST /api/terminals/:id/ws-ticket` using Zod validation matching `CreateTerminalSchema` from `src/main/ipc/terminal.ipc.ts` in `src/main/remote/routes/terminal.routes.ts`
- [ ] T025 [US2] Add WebSocket route `GET /ws/terminals/:sessionId` to `src/main/remote/routes/terminal.routes.ts`: validate ticket via `WsTicketStore`; register with `WsSubscriberManager`; fan PTY `onData` to `broadcast()`; forward primary-subscriber text frames to `ptyManager.write()`; send correct close codes on PTY exit / session not found / invalid ticket
- [ ] T026 [US2] Register terminal routes in `RemoteServer` and register `@fastify/static` to serve `out/renderer-remote/` at `/` in `src/main/remote/remote-server.ts`
- [ ] T027 [P] [US2] Create browser SPA entry: `src/renderer-remote/index.html` (minimal HTML shell), `src/renderer-remote/main.tsx` (React root mount)
- [ ] T028 [P] [US2] Implement `src/renderer-remote/api/remote-client.ts`: fetch wrapper that injects `Authorization: Bearer <password>` from sessionStorage on every request; `createTerminal()`, `deleteTerminal()`, `resizeTerminal()`, `getWsTicket()`, `listWorkspaces()`, `listProjects()`
- [ ] T029 [US2] Implement `src/renderer-remote/components/RemoteTerminal.tsx`: xterm.js v6 terminal using `@xterm/xterm`, `@xterm/addon-attach` (WebSocket connection), `@xterm/addon-fit` (resize on window resize); calls `resizeTerminal()` API on resize
- [ ] T030 [US2] Implement `src/renderer-remote/App.tsx`: login screen (password entry → sessionStorage); authenticated shell with terminal create/close controls and `RemoteTerminal` component; reads `?sessionId` from URL or creates new terminal on load

**Checkpoint**: Open `http://localhost:7681/` in a browser. Enter password. Create and interact with a live terminal. Resize and close it.

---

## Phase 5: User Story 3 — Password Protection (Priority: P1)

**Goal**: Every request without the correct password is rejected. Correct password grants access. No app data is leaked to unauthenticated callers.

**Independent Test**: With server running, make unauthenticated `GET /api/workspaces` → 401. Wrong password → 401. Correct password → 200. Host header `evil.com` → 403.

### Tests for User Story 3

> **Write these tests FIRST — ensure they FAIL before implementation**

- [ ] T031 [P] [US3] Write tests for `auth.middleware.ts`: missing `Authorization` header → 401 `{ error: 'UNAUTHORIZED' }`; wrong password → 401; correct password (bcrypt match) → passes to route; `Host: evil.attacker.com` → 403 `{ error: 'FORBIDDEN' }`; `Host: localhost` → passes; `Host: <ngrokDomain>` → passes in `src/main/remote/__tests__/auth.middleware.spec.ts`
- [ ] T032 [P] [US3] Write integration test: mount auth middleware + workspace route via `fastify.inject()`, verify 401 without token, 200 with correct token, 403 with bad Host in `src/main/remote/__tests__/auth.middleware.spec.ts`

### Implementation for User Story 3

- [ ] T033 [US3] Implement `auth.middleware.ts` as a Fastify `onRequest` hook: extract password from `Authorization: Bearer <password>` header; call `await bcryptjs.compare(password, storedHash)` (async promise form — NEVER `bcryptjs.compareSync` which blocks the main process event loop); check `Host` header against allowlist `['localhost', '127.0.0.1', ngrokDomain]`; reject with 401/403 on failure in `src/main/remote/auth.middleware.ts`
- [ ] T034 [US3] Register auth middleware in `RemoteServer` as a global `onRequest` hook, with `/health` excluded from auth in `src/main/remote/remote-server.ts`
- [ ] T035 [US3] Hash `password` into `passwordHash` via `bcryptjs.hash(password, 10)` when Remote Control is enabled (or password changes) and persist via `updateGlobalSettings` in `src/main/ipc/remote.ipc.ts`

**Checkpoint**: All protected endpoints require the correct password. Unauthenticated requests receive 401. DNS rebinding attempts receive 403.

---

## Phase 6: User Story 4 — Password Configuration (Priority: P2)

**Goal**: User sets a custom password in Settings. Clearing the field auto-generates a new one. Generating a new password disconnects active clients.

**Independent Test**: Set custom password "mypassword" in Settings, save. Verify `GET /api/workspaces` accepts "mypassword" but rejects previous password. Clear field, save — verify a new random password is generated and displayed.

### Tests for User Story 4

> **Write these tests FIRST — ensure they FAIL before implementation**

- [ ] T036 [P] [US4] Write tests for password lifecycle in `remote.ipc.ts`: empty password → auto-generates 16-char base64url; new password hashed and stored; password change disconnects all active WS clients via `WsSubscriberManager.destroyAll()` in `src/main/ipc/__tests__/remote.ipc.spec.ts`

### Implementation for User Story 4

- [ ] T037 [US4] Add `destroyAll()` method to `WsSubscriberManager` (closes all subscribers across all sessions) in `src/main/remote/ws-subscriber-manager.ts`; add test for `destroyAll()` to `src/main/remote/__tests__/ws-subscriber-manager.spec.ts`
- [ ] T038 [US4] Implement password auto-generation logic in `src/main/ipc/remote.ipc.ts`: if `password` is empty string, generate `crypto.randomBytes(16).toString('base64url')`; hash with bcryptjs; persist both plaintext + hash via `updateGlobalSettings`; call `wsSubscriberManager.destroyAll()`
- [ ] T039 [US4] Add password UI section to `src/renderer/components/settings/GlobalSettings.tsx`: masked password input with show/copy toggle; "Generate new" button calls `settings:update-global` with `{ remoteControl: { password: '' } }` to trigger auto-generation; field displays current plaintext from `remote:status`

**Checkpoint**: User can set, view, copy, and regenerate the Remote Control password from Settings.

---

## Phase 7: User Story 5 — Workspace and Project Browsing (Priority: P2)

**Goal**: Authenticated browser UI displays workspaces and projects matching the Terminator app state. User can open a terminal in a specific project's directory.

**Independent Test**: With workspaces present in the app, open the browser UI. Verify workspace list matches. Select a workspace, verify projects list. Create a terminal from a project → verify working directory is correct.

### Tests for User Story 5

> **Write these tests FIRST — ensure they FAIL before implementation**

- [ ] T040 [P] [US5] Write tests for workspace routes: `GET /api/workspaces` → mocked `workspaceStore.getAll()` output; `GET /api/projects?workspaceId=<id>` → mocked project list; `GET /api/projects` without `workspaceId` → 400 validation error in `src/main/remote/__tests__/workspace.routes.spec.ts`

### Implementation for User Story 5

- [ ] T041 [US5] Implement workspace routes `GET /api/workspaces` and `GET /api/projects?workspaceId=` calling existing workspace store functions directly (not via IPC re-invoke) in `src/main/remote/routes/workspace.routes.ts`
- [ ] T042 [US5] Register workspace routes in `RemoteServer` in `src/main/remote/remote-server.ts`
- [ ] T043 [US5] Implement `src/renderer-remote/components/WorkspaceNav.tsx`: sidebar listing workspaces and projects fetched from `/api/workspaces` + `/api/projects`; clicking a project creates a new terminal with that project's `worktreePath` or workspace `folderPath` as `cwd`

**Checkpoint**: Browser UI shows real workspace/project data. Terminal opens in the correct directory for the selected project.

---

## Phase 8: User Story 6 — ngrok Not Installed (Priority: P3)

**Goal**: When ngrok is absent, the server starts (LAN access works), a clear install hint is shown in Settings, and enabling/disabling still works without crashing.

**Independent Test**: Mock `which ngrok` to fail. Enable Remote Control. Verify server starts, LAN URL shown, tunnel section shows install hint with `brew install ngrok`.

### Tests for User Story 6

> **Write these tests FIRST — ensure they FAIL before implementation**

- [ ] T044 [P] [US6] Write tests for `NgrokManager.isInstalled()` with mocked `child_process.execSync`: returns `true` when `which ngrok` exits 0; returns `false` when it throws in `src/main/remote/__tests__/ngrok-manager.spec.ts` (add to existing file)
- [ ] T045 [P] [US6] Write test for Remote Control enable when ngrok not installed: server starts, `sendStatus` called with `{ ngrokInstalled: false, publicUrl: null }` in `src/main/ipc/__tests__/remote.ipc.spec.ts`

### Implementation for User Story 6

- [ ] T046 [US6] Guard ngrok spawn in `src/main/ipc/remote.ipc.ts` enable flow: if `!NgrokManager.isInstalled()`, skip spawn, send `remote:status` with `{ ngrokInstalled: false, publicUrl: null }`; log to LogWindow via `sendLog`
- [ ] T047 [US6] Update Settings UI ngrok section in `src/renderer/components/settings/GlobalSettings.tsx`: when `remote:status` has `ngrokInstalled: false`, show "ngrok not found — install with `brew install ngrok`" hint instead of public URL display

**Checkpoint**: Enabling Remote Control on a machine without ngrok shows a clear install hint and does not crash. LAN URL still available.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, type declarations, coverage gate, lint.

- [x] T048 [P] Write `docs/adr/017-embedded-http-remote-server.md` (already scaffolded — verify content is complete and accurate against implementation)
- [x] T049 [P] Add Remote Control to `README.md` features table
- [x] T050 [P] Update `docs/ARCHITECTURE.md` to include Remote Server in the process model diagram section
- [x] T051 [P] Add `log:push`, `remote:status`, `remote:tunnel-disconnected`, `remote:tunnel-reconnect` channel definitions to `specs/001-extension-first-terminal/contracts/ipc-channels.md`
- [x] T052 [P] Add type declarations for new IPC channels to `src/renderer/electron.d.ts`
- [x] T053 Run `npm run lint` — fix all errors (0 errors required before done)
- [x] T054 Run `npx vitest run --coverage` — verify all thresholds ≥80% for `src/main/remote/**` and `src/renderer-remote/**`; fix any gaps
- [x] T055 Run `npm run build:extensions` — verify extension builds are unaffected

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1)**: Depends on Phase 2 — enables the core on/off toggle (MVP threshold)
- **Phase 4 (US2)**: Depends on Phase 2 + Phase 3 (server must exist before terminal routes are wired)
- **Phase 5 (US3)**: Depends on Phase 2 + Phase 3 (auth middleware applied to RemoteServer)
- **Phase 6 (US4)**: Depends on Phase 5 (auth must be in place before password config matters)
- **Phase 7 (US5)**: Depends on Phase 3 (server must run); can run in parallel with US2/US3/US4
- **Phase 8 (US6)**: Depends on Phase 3 (NgrokManager must exist); can run after US1
- **Phase 9 (Polish)**: Depends on all user story phases complete

### User Story Dependencies

- **US1 (P1)**: After Foundational — no other story dependencies
- **US2 (P1)**: After US1 (RemoteServer must be running)
- **US3 (P1)**: After US1 (RemoteServer must exist to attach middleware)
- **US4 (P2)**: After US3 (password must be in place)
- **US5 (P2)**: After US1 — independent of US2/US3/US4
- **US6 (P3)**: After US1 — independent of US2–US5

### Within Each User Story

- Tests MUST be written and FAIL before implementation begins
- For US2: HTTP route tests before WebSocket tests (WS depends on ticket route)
- For US3: Auth middleware unit tests before integration wiring

### Parallel Opportunities

- T003, T004 — Setup: parallel (different files)
- T008–T011 — Foundational: all parallel (independent modules)
- T012–T014 — US1 tests: all parallel
- T015–T017 — US1 impl core modules: parallel (different files)
- T027–T028 — US2 browser SPA scaffold: parallel
- T031–T032 — US3 tests: parallel
- T040 — US5 tests: parallel with US3/US4
- T048–T052 — Polish docs: all parallel

---

## Parallel Example: User Story 2

```bash
# Write all US2 tests in parallel:
Task T022: terminal HTTP route tests (terminal.routes.spec.ts)
Task T023: WebSocket integration tests (same file, different describe block)

# Then implement in parallel where files differ:
Task T027: browser SPA index.html + main.tsx
Task T028: remote-client.ts API wrapper

# Then sequentially (depend on T024):
Task T024 → T025 → T026 (routes, WS, static serving)
Task T029 → T030 (RemoteTerminal → App)
```

---

## Implementation Strategy

### MVP First (P1 User Stories: US1 + US2 + US3)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (schema, WsTicketStore, WsSubscriberManager)
3. Complete Phase 3: US1 — toggle on/off, server starts, ngrok URL appears
4. Complete Phase 4: US2 — browser terminal works end-to-end
5. Complete Phase 5: US3 — password protection in place
6. **STOP and VALIDATE**: All three P1 stories independently testable
7. Run `npx vitest run --coverage` — gate must pass

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → server toggles on/off, URL visible in Settings (no auth, no terminal yet)
3. US2 → browser terminal streaming works
4. US3 → password protection active (feature now shippable)
5. US4 → password UX improved
6. US5 → workspace/project navigation added
7. US6 → graceful degradation when ngrok absent

---

## Notes

- `[P]` tasks can be started in parallel — they touch different files with no shared incomplete dependencies
- `[Story]` labels map directly to spec.md user story numbers for full traceability
- Constitution §VI: tests MUST be written and confirmed FAILING before any implementation starts
- Never re-invoke `ipcMain.handle` from the HTTP server — call service modules (`ptyManager`, `workspaceStore`) directly
- `before-quit` ordering is critical: `remoteServer.stop()` BEFORE `ptyManager.killAll()` (see T019)
- Password stored as both plaintext (display) and bcrypt hash (comparison) — see data-model.md
- `WsSubscriberManager` primary tracking: first subscriber gets input rights; subsequent subscribers are read-only
