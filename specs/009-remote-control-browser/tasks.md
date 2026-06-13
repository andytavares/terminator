# Tasks: Remote Control Browser Access

**Input**: Design documents from `specs/009-remote-control-browser/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/http-api.md ✅ quickstart.md ✅

**Tests**: TDD is NON-NEGOTIABLE (Constitution §VI). Write failing tests first — Red → Green → Refactor. Every new production source file MUST reach ≥80% coverage before merge.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: User story label (US1–US7, maps to spec.md priorities)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies, scaffold directories, configure the second Vite renderer entry.

- [x] T001 Install production dependencies (pinned exact versions, no `^`): `fastify@4.28.1`, `@fastify/websocket@11.0.1`, `@fastify/static@8.0.0`, `bcryptjs@2.4.3`, `@xterm/xterm@6.0.0`, `@xterm/addon-attach@0.11.0`, `@xterm/addon-fit@0.10.0` in root `package.json`
- [x] T002 Install dev dependencies (pinned exact versions): `ws@8.18.0`, `@types/bcryptjs@2.4.6`, `@types/ws@8.5.13` in root `package.json`
- [x] T003 [P] Create directory scaffold: `src/main/remote/`, `src/main/remote/routes/`, `src/main/remote/__tests__/`, `src/renderer-remote/`, `src/renderer-remote/components/`, `src/renderer-remote/api/`
- [x] T004 [P] Add `renderer-remote` renderer entry to `electron.vite.config.ts` pointing to `src/renderer-remote/index.html`, output to `out/renderer-remote/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core shared data layer and pure utility modules. All user story phases depend on this phase.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

- [x] T005 Add `remoteControl: { enabled: boolean; port: number; password: string; passwordHash: string; maxSubscribers: number }` to `GlobalSettings` interface in `src/shared/types/index.ts`
- [x] T006 Add `remoteControl` Zod schema with defaults `{ enabled: false, port: 7681, password: '', passwordHash: '', maxSubscribers: 5 }` and validation rules (`port` integer 1024–65535, `maxSubscribers` integer 1–20) to `src/shared/schemas/settings.schema.ts`
- [x] T007 [P] Write tests for `remoteControl` schema: valid port range, invalid port rejection, maxSubscribers range 1–20, defaults applied when fields omitted in `src/shared/schemas/__tests__/settings.schema.spec.ts`
- [x] T008 [P] Write tests for `WsTicketStore`: `createTicket(sessionId)` returns 64-char hex; `consumeTicket()` returns sessionId on first call, null on second (single-use); expired ticket (>30s) returns null; `startCleanup()` / `stopCleanup()` wires and clears the interval in `src/main/remote/__tests__/ws-ticket-store.spec.ts`
- [x] T009 Implement `WsTicketStore`: `createTicket(sessionId): string`, `consumeTicket(ticket): string | null`, `startCleanup(): void`, `stopCleanup(): void` — 30s expiry, single-use, 60s background prune, all in `src/main/remote/ws-ticket-store.ts` (implement after T008 is RED)
- [x] T010 [P] Write tests for `WsSubscriberManager`: first subscriber becomes primary; second subscriber added but not primary; broadcast sends to all; `isPrimary()` returns true only for first; `removeSubscriber()` on primary sets primary to null; `destroySession()` closes all WS connections with close frame; sixth subscriber rejected (close code 4003) when `maxSubscribers` is 5 in `src/main/remote/__tests__/ws-subscriber-manager.spec.ts`
- [x] T011 Implement `WsSubscriberManager`: `addSubscriber(sessionId, ws, maxSubscribers): boolean`, `removeSubscriber(sessionId, ws): void`, `isPrimary(sessionId, ws): boolean`, `broadcast(sessionId, data): void`, `destroySession(sessionId): void`, `getCount(sessionId): number` — rejects with close code 4003 when count ≥ maxSubscribers in `src/main/remote/ws-subscriber-manager.ts` (implement after T010 is RED)

**Checkpoint**: Schema extended with `maxSubscribers`, `WsTicketStore` and `WsSubscriberManager` tested and green. User story phases can now begin.

---

## Phase 3: User Story 1 — Enable/Disable Remote Control (Priority: P1) 🎯 MVP

**Goal**: User toggles Remote Control on in Settings → server starts on localhost, ngrok tunnel established with public URL; toggle off tears everything down cleanly.

**Independent Test**: Toggle Remote Control on. Run `curl http://localhost:7681/health` → HTTP 200. Toggle off. Verify `lsof -i :7681` shows no listener (quickstart.md Scenario 1).

### Tests for User Story 1

> **Write these tests FIRST — ensure they FAIL before implementation**

- [x] T012 [P] [US1] Write tests for `RemoteServer`: `start()` binds to `127.0.0.1` on configured port; `stop()` closes server; double `stop()` is safe (idempotent); `isListening()` returns correct state; `GET /health` via `fastify.inject()` returns HTTP 200 `{ ok: true }`; `EADDRINUSE` on start calls `sendStatus` with `{ error: 'PORT_IN_USE' }` and rejects in `src/main/remote/__tests__/remote-server.spec.ts`
- [x] T013 [P] [US1] Write tests for `NgrokManager`: `isInstalled()` returns true/false based on mocked `execSync`; `start(port)` spawns ngrok with args `['http', String(port), '--web-addr', '0.0.0.0:4041']` and resolves with URL from mocked `localhost:4041/api/tunnels`; `start(port)` rejects after 10 failed polls; `stop()` sends SIGTERM to child process; unexpected process exit fires the `onCrash` callback in `src/main/remote/__tests__/ngrok-manager.spec.ts`
- [x] T014 [P] [US1] Write tests for `remote.ipc.ts`: `sendStatus(win, payload)` calls `webContents.send('remote:status', payload)`; `sendLog(win, level, msg)` calls `webContents.send('log:push', { level, message: msg })`; port-change handler calls `remoteServer.stop()` then `remoteServer.start()` with new port and restarts ngrok if active in `src/main/ipc/__tests__/remote.ipc.spec.ts`

### Implementation for User Story 1

- [x] T015 [US1] Implement `RemoteServer` factory with Fastify: `createRemoteServer({ port, ptyManager, settingsStore, getWindow })`; bind `127.0.0.1`; register `@fastify/websocket` + `@fastify/static` (serving `out/renderer-remote/` at `/`); return `{ start(), stop(), isListening() }`; catch `EADDRINUSE` and call `getWindow()?.webContents.send('remote:status', { error: 'PORT_IN_USE', message: 'Port X already in use. Change the port in Settings.' })` in `src/main/remote/remote-server.ts`
- [x] T016 [US1] Implement `GET /health → { ok: true }` route (no auth) in `src/main/remote/routes/health.route.ts`; register it in `RemoteServer`
- [x] T017 [US1] Implement `NgrokManager`: `isInstalled(): boolean` via `execSync('which ngrok')`; `start(port): Promise<string>` spawns `ngrok http <port> --web-addr 0.0.0.0:4041` and polls `http://localhost:4041/api/tunnels` (10 × 500ms) for `tunnels[0].public_url`; `stop(): void` sends `SIGTERM`; `setOnCrash(cb): void` wires the exit handler in `src/main/remote/ngrok-manager.ts`
- [x] T018 [US1] Implement `getLanUrl(port): string` using `os.networkInterfaces()` — find first non-loopback IPv4 address, fall back to `127.0.0.1`; export from `src/main/remote/ngrok-manager.ts`
- [x] T019 [US1] Implement `remote.ipc.ts`: `registerRemoteHandlers(getWindow, getServer, getNgrokManager, settingsStore)`; handle `ipcMain.on('remote:start', ...)` (start server + ngrok, emit `remote:status`); handle `ipcMain.on('remote:stop', ...)` (stop both); handle `ipcMain.on('remote:port-change', { port })` (stop server + ngrok → restart on new port → emit updated `remote:status` with toast flag); handle `ipcMain.on('remote:tunnel-reconnect', ...)` (restart ngrok); expose `sendStatus(win, payload)` and `sendLog(win, level, msg)` in `src/main/ipc/remote.ipc.ts`
- [x] T020 [US1] Wire Remote Control into `src/main/index.ts`: call `registerRemoteHandlers(...)` in `app.whenReady()`; if `settings.remoteControl.enabled` call `remoteServer.start()` + ngrok start on launch; in `app.on('before-quit', ...)` `await remoteServer.stop()` BEFORE `ptyManager.killAll()`
- [x] T021 [US1] Add `remote:status`, `remote:tunnel-disconnected`, and `log:push` IPC listeners to `src/renderer/App.tsx`; `remote:status` updates remote control state in a local `useState`; `remote:tunnel-disconnected` shows toast with "Reconnect" button that sends `remote:tunnel-reconnect`; `log:push` calls `useLogStore().addEntry(level, message)`
- [x] T022 [US1] Add "Remote Control" section to `src/renderer/components/settings/GlobalSettings.tsx`: enable/disable toggle (sends `remote:start` / `remote:stop`); port number input (on change while enabled, sends `remote:port-change`); active tunnel URL + copy button; LAN URL + copy button; ngrok status indicator; max subscribers input (1–20); reads all state from `remote:status` IPC event

**Checkpoint**: Remote Control toggles on/off in Settings. Public URL appears within 10s, LAN URL always shown, port changes auto-restart the server, EADDRINUSE surfaces a toast. Quickstart Scenario 1 passes.

---

## Phase 4: User Story 2 — Browser Terminal Interaction (Priority: P1)

**Goal**: From the remote browser, user creates a terminal, types commands, sees output in real time, resizes, and closes — all using xterm.js v6.

**Independent Test**: With server running locally, open `http://localhost:7681/` in a browser, authenticate, create and interact with a terminal (quickstart.md Scenarios 3 and 5).

### Tests for User Story 2

> **Write these tests FIRST — ensure they FAIL before implementation**

- [x] T023 [P] [US2] Write tests for auth middleware: request with no `Authorization` header → HTTP 401 `{ error: 'UNAUTHORIZED' }`; wrong password → HTTP 401; correct password → passes to next handler; `Host` not matching `localhost`/`127.0.0.1`/tunnel domain → HTTP 403 `{ error: 'FORBIDDEN' }`; health route bypasses auth in `src/main/remote/__tests__/auth.middleware.spec.ts`
- [x] T024 [P] [US2] Write tests for terminal routes via `fastify.inject()`: `POST /api/terminals` with valid body → 201 `{ sessionId }`; missing `cwd` → 400 `VALIDATION_ERROR`; `GET /api/terminals/:id` existing → 200 with metadata; `GET /api/terminals/:id` missing → 404; `DELETE /api/terminals/:id` → 200 + PTY killed; `POST /api/terminals/:id/resize` valid body → 200; invalid `cols`/`rows` → 400; `POST /api/terminals/:id/ws-ticket` → 201 `{ ticket }` 64-char hex in `src/main/remote/__tests__/routes/terminal.routes.spec.ts`

### Implementation for User Story 2

- [x] T025 [US2] Implement auth middleware: `registerAuthMiddleware(fastify, settingsStore)` — `fastify.addHook('onRequest', ...)` validates `Authorization: Bearer <password>` via `bcrypt.compare()` and `Host` header; bypass `/health`; attach `ngrokDomain` to request for Host check in `src/main/remote/auth.middleware.ts`
- [x] T026 [US2] Implement terminal routes in `src/main/remote/routes/terminal.routes.ts`: `POST /api/terminals` → call `ptyManager.spawn()` with `onData` closure that broadcasts to all `WsSubscriberManager` subscribers for this session; `GET /api/terminals/:id` → return metadata; `DELETE /api/terminals/:id` → `ptyManager.kill()` + `wsManager.destroySession()`; `POST /api/terminals/:id/resize` → `ptyManager.resize()`; `POST /api/terminals/:id/ws-ticket` → `ticketStore.createTicket(sessionId)` → return ticket; `WS /ws/terminals/:id?ticket=` → validate ticket → `wsManager.addSubscriber(sessionId, ws, maxSubscribers)` → on message from primary forward to `ptyManager.write()`; close code 4001 on bad ticket, 4002 on session not found, 4003 on subscriber limit
- [x] T027 [US2] Register auth middleware and terminal routes in `RemoteServer` in `src/main/remote/remote-server.ts`
- [x] T028 [P] [US2] Create browser SPA entry: `src/renderer-remote/index.html` (minimal HTML shell with `<div id="root">`), `src/renderer-remote/main.tsx` (React root mount: `ReactDOM.createRoot(document.getElementById('root')!).render(<App />)`)
- [x] T029 [P] [US2] Implement `src/renderer-remote/api/remote-client.ts`: fetch wrapper that reads password from `sessionStorage.getItem('rc_password')` and injects `Authorization: Bearer <password>` header; exports `createTerminal(cwd, type, tabTitle, scrollbackLimit)`, `deleteTerminal(sessionId)`, `resizeTerminal(sessionId, cols, rows)`, `getWsTicket(sessionId)`, `listWorkspaces()`, `listProjects(workspaceId)`
- [x] T030 [US2] Implement `src/renderer-remote/components/Login.tsx`: password `<input type="password">`, submit handler stores password in `sessionStorage('rc_password')` and calls `onSuccess()` prop; shows error message on 401
- [x] T031 [US2] Implement `src/renderer-remote/components/RemoteTerminal.tsx`: mount xterm.js v6 `Terminal` instance; load `FitAddon` (auto-resize on window resize events → call `resizeTerminal()`); load `AttachAddon` with a WebSocket constructed via `getWsTicket()` then `ws://localhost:<port>/ws/terminals/<sessionId>?ticket=<ticket>`; expose `sessionId` prop and `onClose` callback
- [x] T032 [US2] Implement `src/renderer-remote/App.tsx`: render `<Login>` when no password in sessionStorage; on login success render authenticated shell with `<RemoteTerminal>` and a "New Terminal" button that calls `createTerminal()`; handle terminal close via `deleteTerminal()`

**Checkpoint**: Full browser terminal interaction works locally. Quickstart Scenarios 3 and 5 pass.

---

## Phase 5: User Story 3 — Password Protection (Priority: P1)

**Goal**: Unauthorized access is rejected 100% of the time; generating a new password invalidates all active sessions.

**Independent Test**: `curl` without credentials → HTTP 401; with wrong password → HTTP 401; correct password → HTTP 200. "Generate new" disconnects active WS clients (quickstart.md Scenario 2).

### Tests for User Story 3

> **Write these tests FIRST — ensure they FAIL before implementation**

- [x] T033 [P] [US3] Write tests for password generation: `generatePassword()` returns a base64url string of length ≥ 16; successive calls return different values; `hashPassword(plain)` returns a bcrypt hash that `bcrypt.compareSync(plain, hash)` validates; `updatePassword(newPassword, settingsStore, wsManager)` calls `wsManager.destroyAllSessions()` and updates `passwordHash` in settings in `src/main/ipc/__tests__/remote.ipc.spec.ts`

### Implementation for User Story 3

- [x] T034 [US3] Add `generatePassword(): string` (32 bytes → `base64url`) and `hashPassword(plain: string): Promise<string>` (bcryptjs, work factor 10) helpers to `src/main/ipc/remote.ipc.ts`
- [x] T035 [US3] Add `updatePassword(newPassword, settingsStore, wsManager): Promise<void>` to `src/main/ipc/remote.ipc.ts`: hash password → save to `remoteControl.passwordHash` + `remoteControl.password` → call `wsManager.destroyAllSessions()` → emit `remote:status` with updated state
- [x] T036 [US3] Handle `ipcMain.handle('remote:update-password', ...)` in `src/main/ipc/remote.ipc.ts`: if password is empty string, call `generatePassword()` first; always call `updatePassword()`
- [x] T037 [US3] On `remote:start` (first enable with empty password): auto-generate password before starting server — call `generatePassword()` → `hashPassword()` → save both to settings in `src/main/ipc/remote.ipc.ts`

**Checkpoint**: Auth enforcement works end-to-end. Empty password auto-generates. "Generate new" disconnects clients. Quickstart Scenario 2 passes.

---

## Phase 6: User Story 4 — Password Configuration (Priority: P2)

**Goal**: User sets a custom password in Settings; it takes effect immediately; clearing the field auto-generates a new one.

**Independent Test**: Set custom password, verify it authenticates; clear field, verify auto-generated password works and old one doesn't.

### Implementation for User Story 4

- [x] T038 [US4] Add "Generate new password" button to Remote Control settings section in `src/renderer/components/settings/GlobalSettings.tsx`; on click: send `ipcRenderer.invoke('remote:update-password', '')` (empty string triggers auto-generate); display the returned new password in the masked field
- [x] T039 [US4] Add "Save" action to password field in `src/renderer/components/settings/GlobalSettings.tsx`; on save with non-empty value: send `ipcRenderer.invoke('remote:update-password', customPassword)` and confirm success with toast; on save with empty value: same as "Generate new"

**Checkpoint**: Custom password workflow works. Auto-generation on clear works. Quickstart Scenario 2 (step 5–6) passes.

---

## Phase 7: User Story 5 — Workspace & Project Browsing (Priority: P2)

**Goal**: From the browser UI, the user sees workspaces and projects matching the Terminator desktop state and can open a terminal in a specific project directory.

**Independent Test**: Load browser UI, verify workspace + project list matches app state, open terminal in project directory (quickstart.md Scenario 3, step 3).

### Tests for User Story 5

> **Write these tests FIRST — ensure they FAIL before implementation**

- [x] T040 [P] [US5] Write tests for workspace routes via `fastify.inject()`: `GET /api/workspaces` → 200 with mocked workspace array matching `workspaceStore.getAll()`; `GET /api/projects?workspaceId=uuid` → 200 with mocked projects; missing `workspaceId` → 400 `VALIDATION_ERROR`; unknown `workspaceId` → 200 empty array in `src/main/remote/__tests__/routes/workspace.routes.spec.ts`

### Implementation for User Story 5

- [x] T041 [US5] Implement workspace routes in `src/main/remote/routes/workspace.routes.ts`: `GET /api/workspaces` → `workspaceStore.getAll()` → return serialized array; `GET /api/projects?workspaceId=` → validate UUID param → `workspaceStore.getProjects(workspaceId)` → return serialized array
- [x] T042 [US5] Register workspace routes in `RemoteServer` in `src/main/remote/remote-server.ts`
- [x] T043 [US5] Implement `src/renderer-remote/components/WorkspaceNav.tsx`: fetch workspaces on mount via `remote-client.listWorkspaces()`; on workspace select fetch projects via `remote-client.listProjects(workspaceId)`; on project select call `onOpenTerminal(project.worktreePath ?? workspace.folderPath)` prop
- [x] T044 [US5] Integrate `WorkspaceNav` into `src/renderer-remote/App.tsx`: render sidebar with `WorkspaceNav`; `onOpenTerminal(cwd)` calls `createTerminal(cwd, 'human', 'remote', 10000)` then renders `<RemoteTerminal sessionId={...} />`

**Checkpoint**: Workspace/project list matches desktop app. Terminal opens in correct project directory. Quickstart Scenario 3, step 3 passes.

---

## Phase 8: User Story 6 — LAN-Only Access Without Tunnel (Priority: P3)

**Goal**: User on the same network accesses the terminal without any public tunnel; Settings shows the LAN URL; "Copy Caddyfile" generates a ready-to-use HTTPS reverse proxy config.

**Independent Test**: Enable Remote Control with no ngrok. From a second device on same LAN, open the displayed URL and authenticate (quickstart.md Scenario 7).

### Implementation for User Story 6

- [x] T045 [US6] Ensure `getLanUrl(port)` output is included in every `remote:status` emission in `src/main/ipc/remote.ipc.ts`; the LAN URL MUST be present whenever `running: true`, independent of ngrok status
- [x] T046 [US6] Ensure `remote:status` in Settings UI always renders the LAN URL section even when `publicUrl` is null — show it as "Local network access: `http://192.168.x.x:7681`" with a copy button in `src/renderer/components/settings/GlobalSettings.tsx`
- [x] T047 [US6] Implement `generateCaddyfile(port: number): string` in `src/main/remote/ngrok-manager.ts`: returns a Caddyfile template with `reverse_proxy localhost:<port>` and TLS auto-managed by Caddy for LAN hostname
- [x] T048 [US6] Add `ipcMain.handle('remote:caddyfile', ...)` in `src/main/ipc/remote.ipc.ts` that calls `generateCaddyfile(port)` and returns the string
- [x] T049 [US6] Add "Copy Caddyfile" button to Settings UI Remote Control section in `src/renderer/components/settings/GlobalSettings.tsx`; on click: `ipcRenderer.invoke('remote:caddyfile')` → write result to clipboard via `navigator.clipboard.writeText()`; show "Copied!" toast

**Checkpoint**: LAN URL always visible. Caddyfile copies to clipboard. Quickstart Scenario 7 passes.

---

## Phase 9: User Story 7 — ngrok Not Installed (Priority: P3)

**Goal**: When ngrok is absent, the Settings panel shows a clear install hint, the local server still starts, and the LAN URL is shown. Once ngrok is installed and Remote Control is re-enabled, the tunnel appears.

**Independent Test**: Rename ngrok binary, enable Remote Control → server starts, LAN URL shows, ngrok section shows "not installed" hint. Restore binary, re-enable → tunnel appears (quickstart.md Scenario 8).

### Implementation for User Story 7

- [x] T050 [US7] Ensure `NgrokManager.isInstalled()` result is included in every `remote:status` payload as `ngrokInstalled: boolean` in `src/main/ipc/remote.ipc.ts`
- [x] T051 [US7] In Settings UI Remote Control section (`src/renderer/components/settings/GlobalSettings.tsx`): when `ngrokInstalled` is false, hide the "Tunnel URL" field and show an inline notice: `"ngrok is not installed — run brew install ngrok to enable tunnel access."` with a copy button for the install command; server must still start and LAN URL must still display

**Checkpoint**: Graceful degradation when ngrok absent. Quickstart Scenario 8 passes.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, lint gate, coverage gate, and manual end-to-end validation.

- [x] T052 [P] Update `docs/ARCHITECTURE.md`: add "Remote Control Server" section to the process model diagram explaining the Fastify server + ngrok process lifecycle within the Electron main process
- [x] T053 [P] Update `specs/001-extension-first-terminal/contracts/ipc-channels.md`: add all new IPC channels (`remote:start`, `remote:stop`, `remote:status`, `remote:port-change`, `remote:tunnel-reconnect`, `remote:tunnel-disconnected`, `remote:update-password`, `remote:caddyfile`, `log:push`) and note that HTTP endpoints are documented in `specs/009-remote-control-browser/contracts/http-api.md`
- [x] T054 [P] Update `src/renderer/electron.d.ts`: add type declarations for all new `window.electronAPI` channels introduced by remote control IPC
- [x] T055 Run `npm run lint` — fix all errors until output is 0 errors, 0 warnings (Constitution §X)
- [x] T056 Run `npx vitest run --coverage` — verify all thresholds ≥80% for `src/main/remote/**`, `src/main/ipc/remote.ipc.ts`, and `src/renderer-remote/**`; fix any gaps (Constitution §VI)
- [ ] T057 Manual end-to-end validation: run all 8 scenarios in `specs/009-remote-control-browser/quickstart.md` and verify each passes; document any failures as blocking issues before marking the feature complete

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user story phases
- **Phases 3–9 (User Stories)**: All depend on Phase 2; proceed in priority order (P1 → P2 → P3)
- **Phase 10 (Polish)**: Depends on all desired user stories being complete

### User Story Dependencies

| Story                        | Depends On                     | Can Start After  |
| ---------------------------- | ------------------------------ | ---------------- |
| US1 (Enable/Disable)         | Phase 2                        | Phase 2 complete |
| US2 (Terminal Interaction)   | US1 (server + auth)            | US1 complete     |
| US3 (Password Protection)    | US1 (IPC handlers)             | US1 complete     |
| US4 (Password Configuration) | US3 (update-password IPC)      | US3 complete     |
| US5 (Workspace Browsing)     | US2 (server + auth + SPA)      | US2 complete     |
| US6 (LAN-Only)               | US1 (LAN URL in status)        | US1 complete     |
| US7 (ngrok Not Installed)    | US1 (NgrokManager.isInstalled) | US1 complete     |

### Within Each User Story

1. Tests MUST be written and FAIL before implementation starts
2. Implementation tasks run in listed order (later tasks depend on earlier ones)
3. Tasks marked [P] within a phase can run in parallel

### Parallel Opportunities

- T001 + T002 can run in parallel (different files in package.json: split if desired)
- T003 + T004 (directory scaffold + Vite config) run in parallel
- T007 + T008 + T010 (foundational tests) all run in parallel
- T012 + T013 + T014 (US1 tests) all run in parallel
- T023 + T024 (US2 tests) run in parallel
- T028 + T029 (browser SPA entry + client) run in parallel
- T052 + T053 + T054 (docs) run in parallel

---

## Implementation Strategy

### MVP: User Stories 1 + 2 Only

1. Complete Phase 1 (Setup) + Phase 2 (Foundational)
2. Complete Phase 3 (US1: Enable/Disable) → validate with Quickstart Scenario 1
3. Complete Phase 4 (US2: Terminal Interaction) → validate with Quickstart Scenario 3
4. **STOP and VALIDATE**: User can enable Remote Control and interact with a terminal from a browser on localhost
5. Ship MVP; continue with US3+ in subsequent iterations

### Incremental Delivery Order

1. Setup + Foundational → infrastructure ready
2. US1 → server on/off, ngrok, Settings UI → Quickstart Scenarios 1, 4, 6
3. US2 → terminal streaming → Quickstart Scenarios 3, 5
4. US3 → auth enforcement, password generation → Quickstart Scenario 2
5. US4 → password UI refinement
6. US5 → workspace nav in browser → Quickstart Scenario 3 (full)
7. US6 → LAN URL + Caddyfile → Quickstart Scenario 7
8. US7 → ngrok install hint → Quickstart Scenario 8
9. Polish → lint + coverage + docs

---

## Notes

- All new `src/main/remote/*.ts` files must reach ≥80% individual coverage (Constitution §VI)
- `bcryptjs` compare is async — use `await bcrypt.compare()` in middleware; never block the event loop
- `WsSubscriberManager.addSubscriber()` receives `maxSubscribers` from the settings store at call time — not cached at construction time — so a settings change takes effect on the next new connection
- ngrok management port is **4041** (not 4040) — always pass `--web-addr 0.0.0.0:4041` (research Decision 10)
- Port change while running triggers a full restart cycle (stop → start → ngrok restart) — not a partial reconfigure (research Decision 9)
- lucide-react icons MUST be used in `GlobalSettings.tsx` for any new icons (Constitution §XII)
- All IPC channels introduced here must be documented in `ipc-channels.md` before merge (Constitution §VIII)
