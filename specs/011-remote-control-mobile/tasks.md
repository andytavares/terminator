# Tasks: Remote Control Mobile UI

**Input**: Design documents from `specs/011-remote-control-mobile/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/api-changes.md ✅ quickstart.md ✅

**Tests**: Per the project constitution (Principle VI: TDD is NON-NEGOTIABLE), tests MUST be written before implementation. Write failing tests first — Red → Green → Refactor.

**Organization**: Tasks grouped by user story. Each phase is an independently testable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Build pipeline and file structure — unblocks all user story phases.

- [x] T001 Add `mobile` rollup input entry to `vite.config.remote.ts` (alongside existing `index` and `shim` inputs; output resolves to `out/renderer-remote/mobile.html`)
- [x] T002 [P] Create `src/renderer-remote/mobile.html` (copy `index.html` structure; change `<script>` src to `./mobile.main.tsx`; keep same `<meta name="viewport">` tag)
- [x] T003 [P] Create `tests/unit/renderer-remote/mobile/` directory with a `.gitkeep` placeholder so the test runner recognises the path

**Checkpoint**: Run `npm run build:remote` — must produce `out/renderer-remote/mobile.html` alongside existing `out/renderer-remote/index.html`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Server-side auth/routing and shared client API additions that ALL user stories depend on. No user story work can begin until this phase is complete.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Server additions (extension)

- [x] T004 Write failing test: add `GET /api/terminals` list cases to `tests/unit/extension-remote-control/terminal-routes.spec.ts` (or create the file) — expect `[]` when empty, expect array of `{ sessionId, cwd, createdAt }` when sessions exist
- [x] T005 Implement `GET /api/terminals` in `extensions/remote-control/src/server/routes/terminal.routes.ts` — iterate `sessions` Map and return `Array.from(sessions.values())` (make T004 pass)
- [x] T006 [P] Write failing test: add `/api/mobile-ticket` + `/mobile/` route cases to `tests/unit/extension-remote-control/remote-server.spec.ts` — `POST /api/mobile-ticket` returns `{ ticket }`, `GET /mobile/?t=<valid>` sets `mobile-session` cookie + returns 200, `GET /mobile/?t=<invalid>` redirects to `/`
- [x] T007 Implement `POST /api/mobile-ticket` endpoint in `extensions/remote-control/src/server/remote-server.ts` (mirrors `POST /api/app-ticket` — creates a `WsTicketStore` ticket of type `'mobile'`)
- [x] T008 Implement `GET /mobile/` auth route in `extensions/remote-control/src/server/remote-server.ts` — validate ticket, set `mobile-session=<token>; Path=/mobile; HttpOnly; SameSite=Strict; Max-Age=28800` cookie, serve `out/renderer-remote/mobile.html` (mirrors `/app/` route exactly)
- [x] T009 Add `mobile-session` cookie gate to the `onRequest` hook in `extensions/remote-control/src/server/remote-server.ts` — for paths starting with `/mobile/` (excluding `/mobile/` itself), validate `mobile-session` cookie or redirect to `/` (mirrors existing `app-session` gate)
- [x] T010 [P] Register `@fastify/static` with prefix `/mobile` pointing to `loginStaticDir` in `extensions/remote-control/src/server/remote-server.ts` so mobile JS/CSS assets are served correctly

### Client API addition

- [x] T011 [P] Write failing test: add `listTerminals` cases to `tests/unit/renderer-remote/remote-client.spec.ts` — GET `/api/terminals` with Bearer token, returns array, throws on non-200
- [x] T012 [P] Implement `listTerminals(): Promise<TerminalSession[]>` in `src/renderer-remote/api/remote-client.ts` (export interface `TerminalSession { sessionId, cwd, createdAt }`, call `apiFetch('/api/terminals')`)

### Login redirect update

- [x] T013 Write failing test: add mobile-redirect cases to `tests/unit/renderer-remote/App.spec.tsx` — `window.innerWidth = 300` → calls `/api/mobile-ticket` → redirects to `/mobile/?t=...`; `window.innerWidth = 1024` → calls `/api/app-ticket` → redirects to `/app/?t=...`
- [x] T014 Update `src/renderer-remote/App.tsx` login success handler: check `window.innerWidth < 768`, call `POST /api/mobile-ticket` (mobile) or `POST /api/app-ticket` (desktop), redirect accordingly (make T013 pass)

**Checkpoint**: Foundation ready. All foundational tests pass. User story phases can now begin.

---

## Phase 3: User Story 1 — View and Interact with Terminals on Phone (Priority: P1) 🎯 MVP

**Goal**: Phone user logs in, lands on a mobile terminal list, taps a terminal, types commands, scrolls output, navigates back. No zoom required on 375px viewport.

**Independent Test**: Start Terminator with Remote Control enabled, open Chrome DevTools at 375px width, log in, open the terminal list, select a terminal, type `echo hello`, verify output appears without zooming.

### Tests for User Story 1 (write FIRST — ensure they FAIL before implementation)

- [x] T015 [US1] Write failing test: `tests/unit/renderer-remote/mobile/MobileApp.spec.tsx` — renders `MobileTerminalList` by default; calling `onSelectTerminal({ sessionId, cwd })` switches to `MobileTerminalView`; calling `onBack()` from `MobileTerminalView` returns to list
- [x] T016 [P] [US1] Write failing test: `tests/unit/renderer-remote/mobile/MobileTerminalList.spec.tsx` — renders workspace names and terminal items with `cwd` label; tap on terminal calls `onSelectTerminal` with correct `sessionId` and `cwd`; shows empty list gracefully when `terminals=[]`
- [x] T017 [P] [US1] Write failing test: `tests/unit/renderer-remote/mobile/MobileTerminalView.spec.tsx` — renders a `div` container for xterm, renders a back button, calls `onBack()` when back button tapped; shows "Reconnecting…" banner when `status='reconnecting'`; shows error + retry button when `status='disconnected'`
- [x] T018 [P] [US1] Write failing test: `tests/unit/renderer-remote/mobile/useReconnect.spec.ts` — hook returns `{ status, retry }`; fires reconnect callback on `visibilitychange` to `visible` when WS is closed; increments attempt counter; sets `status='disconnected'` after 3 failures; `retry()` resets counter and starts reconnect

### Implementation for User Story 1

- [x] T019 [US1] Create `src/renderer-remote/mobile.css` — `height: 100dvh` root layout, `font-family: IBM Plex Mono`, min `14px` terminal font size, full-width stacked flex column for terminal view, no horizontal overflow on `.terminal-list`
- [x] T020 [US1] Create `src/renderer-remote/mobile.main.tsx` — boot entry; `createRoot(document.getElementById('root')).render(<MobileApp />)`; import `mobile.css` and `renderer/styles.css` (for CSS vars)
- [x] T021 [US1] Create `src/renderer-remote/hooks/useReconnect.ts` — `useReconnect(openWs: () => void, ws: WebSocket | null): { status: ConnectionStatus, retry: () => void }` hook; Page Visibility API listener; 3 attempts × 2000ms; make T018 pass
- [x] T022 [US1] Create `src/renderer-remote/MobileApp.tsx` — `useState<MobileAppRoute>({ view: 'list' })`; renders `MobileTerminalList` or `MobileTerminalView` based on route; fetches `listWorkspaces()` + `listTerminals()` on mount; make T015 pass
- [x] T023 [US1] Create `src/renderer-remote/components/MobileTerminalList.tsx` — receives `workspaces: Workspace[]`, `terminals: TerminalSession[]`, `onSelectTerminal: (t) => void`; groups terminals by last `cwd` segment; renders scrollable list; make T016 pass
- [x] T024 [US1] Create `src/renderer-remote/components/MobileTerminalView.tsx` — `useEffect` mounts `@xterm/xterm` `Terminal` with `FitAddon` into a `ref` div; `ResizeObserver` calls `fitAddon.fit()` on container resize; `AttachAddon` (from `@xterm/addon-attach`) connects to WS after `getWsTicket(sessionId)`; renders back button + reconnect banner; integrates `useReconnect`; make T017 pass

**Checkpoint**: US1 independently functional. Login on 375px viewport → terminal list → open terminal → type command → see output → navigate back. All US1 tests pass.

---

## Phase 4: User Story 2 — Control Key Toolbar (Priority: P2)

**Goal**: Persistent toolbar above the on-screen keyboard provides Ctrl+C, Ctrl+D, Tab, Escape, ↑, ↓ buttons so the user can interact with running processes.

**Independent Test**: With a long-running process (`sleep 100`) in a mobile terminal, tap Ctrl+C → process cancels and shell prompt returns.

### Tests for User Story 2 (write FIRST — ensure they FAIL before implementation)

- [x] T025 [US2] Write failing test: `tests/unit/renderer-remote/mobile/MobileControlToolbar.spec.tsx` — renders exactly 6 buttons (Ctrl+C, Ctrl+D, Tab, Esc, ↑, ↓); clicking each calls `onKey` with correct byte sequence (`\x03`, `\x04`, `\t`, `\x1b`, `\x1b[A`, `\x1b[B`)
- [x] T026 [P] [US2] Update `MobileTerminalView.spec.tsx` to add: `MobileControlToolbar` is rendered; clicking Ctrl+C sends `\x03` to the WebSocket mock

### Implementation for User Story 2

- [x] T027 [US2] Create `src/renderer-remote/components/MobileControlToolbar.tsx` — renders 6 `<button>` elements using `lucide-react` icons (or text labels if no suitable icon); `onKey(sequence: string)` prop called on click; make T025 pass
- [x] T028 [US2] Integrate `MobileControlToolbar` into `src/renderer-remote/components/MobileTerminalView.tsx` — renders toolbar below output area, above input; `onKey` handler writes byte sequence directly to the terminal WS; make T026 pass

**Checkpoint**: US1 + US2 both functional. Control keys work in mobile terminal.

---

## Phase 5: User Story 3 — Create New Terminal from Mobile (Priority: P2)

**Goal**: Mobile user sees a "New Terminal" button per workspace. Tapping it creates a terminal and navigates directly to it. Empty state (no existing terminals) shows workspaces with only "New Terminal" buttons.

**Independent Test**: With no active terminals, open mobile UI → see workspace list with "New Terminal" buttons → tap one → new terminal opens and accepts input within 3 seconds.

### Tests for User Story 3 (write FIRST — ensure they FAIL before implementation)

- [x] T029 [US3] Update `tests/unit/renderer-remote/mobile/MobileTerminalList.spec.tsx` — when `terminals=[]`, each workspace shows "New Terminal" button; when terminals exist, "New Terminal" button still visible per workspace; clicking "New Terminal" calls `onCreateTerminal(workspaceId, folderPath)`
- [x] T030 [P] [US3] Update `tests/unit/renderer-remote/mobile/MobileApp.spec.tsx` — `onCreateTerminal` calls `createTerminal({ cwd: folderPath })` from `remote-client`, then navigates to `MobileTerminalView` with the new `sessionId`

### Implementation for User Story 3

- [x] T031 [US3] Update `src/renderer-remote/components/MobileTerminalList.tsx` — add "New Terminal" button per workspace row; `onCreateTerminal(workspaceId: string, folderPath: string)` prop; make T029 pass
- [x] T032 [US3] Update `src/renderer-remote/MobileApp.tsx` — implement `onCreateTerminal`: call `createTerminal({ cwd: folderPath, tabTitle: 'Remote' })`, then navigate to `{ view: 'terminal', sessionId, cwd: folderPath }`; make T030 pass

**Checkpoint**: US1 + US2 + US3 all functional. Can create terminals from mobile.

---

## Phase 6: User Story 4 — Switch Between Terminals Without Losing Sessions (Priority: P3)

**Goal**: Multiple active terminals shown with workspace context and last-line preview. Switching preserves running processes. Exited terminals marked as ended.

**Independent Test**: Open 2 terminals from desktop Terminator. On mobile, switch between them — each shows its correct running process and output. Exit one — it appears as "ended" in the list.

### Tests for User Story 4 (write FIRST — ensure they FAIL before implementation)

- [ ] T033 [US4] Update `tests/unit/renderer-remote/mobile/MobileTerminalList.spec.tsx` — when multiple terminals exist, each shows `cwd` basename as label; terminals with `exited: true` show "ended" badge; order is by `createdAt` descending
- [ ] T034 [P] [US4] Update `tests/unit/renderer-remote/mobile/MobileTerminalView.spec.tsx` — on back navigation, WS is closed (PTY remains alive on server); on re-entering same terminal, new WS ticket is fetched and WS reconnects

### Implementation for User Story 4

- [ ] T035 [US4] Update `src/renderer-remote/components/MobileTerminalList.tsx` — show `cwd` last path segment as terminal label + `createdAt` relative time; sort by `createdAt` newest-first; if `GET /api/terminals/:id` returns 404, show "ended" badge (or poll for status); make T033 pass
- [ ] T036 [US4] Update `src/renderer-remote/components/MobileTerminalView.tsx` — on unmount (back navigation), close the WS cleanly (do NOT call `DELETE /api/terminals/:id` — PTY keeps running); on mount for the same `sessionId`, fetch fresh WS ticket and reconnect; make T034 pass

**Checkpoint**: All 4 user stories functional. Full mobile remote terminal experience complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T037 [P] Update `README.md` — add "Mobile browser support" under Remote Control feature description; note 768px breakpoint and iOS 16 / Android 12 requirements
- [ ] T038 [P] Run `npm run lint` from repo root — fix any lint errors introduced by new files (0 errors required)
- [ ] T039 [P] Run `npx vitest run --coverage` — verify all new files ≥ 80% coverage on statements, branches, functions, and lines; fix any threshold failures
- [ ] T040 Run `npm run build:remote` — verify `out/renderer-remote/mobile.html` is emitted alongside `index.html`; verify asset chunks are correct
- [ ] T041 [P] Run `npm run build:extensions` — verify remote-control extension TypeScript compiles cleanly with new server routes
- [ ] T042 Manual smoke test (quickstart.md): Chrome DevTools 375px → login → terminal list → open terminal → Ctrl+C → "New Terminal" → navigate back → switch terminal

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **BLOCKS all user story phases**
- **Phase 3 (US1)**: Depends on Phase 2 — no dependencies on US2/US3/US4
- **Phase 4 (US2)**: Depends on Phase 3 (needs `MobileTerminalView` to integrate into) — no dependency on US3/US4
- **Phase 5 (US3)**: Depends on Phase 3 (extends `MobileTerminalList`) — can run in parallel with Phase 4
- **Phase 6 (US4)**: Depends on Phase 3; benefits from Phase 5 being complete first
- **Phase 7 (Polish)**: Depends on all desired phases

### User Story Dependencies

- **US1 (P1)**: After Foundational — no US dependencies
- **US2 (P2)**: After US1 (extends `MobileTerminalView`) — independent of US3
- **US3 (P2)**: After US1 (extends `MobileTerminalList`) — can parallel with US2
- **US4 (P3)**: After US1 (extends both components) — benefits from US3

### Within Each User Story

1. Write ALL failing tests for the story
2. Confirm tests fail (Red)
3. Implement components/hooks (Green)
4. Lint + coverage check (Refactor)
5. Confirm story independently testable

### Parallel Opportunities

Within Phase 2: T004–T005 (server list endpoint) can parallel with T011–T012 (client API) and T013–T014 (login redirect)

Within Phase 3 implementation: T021 (`useReconnect`) can parallel with T019 (`mobile.css`) and T020 (`mobile.main.tsx`) — all are independent files

Phases 4 and 5 can run in parallel once Phase 3 is complete (different components)

---

## Parallel Example: User Story 1

```bash
# Write these failing tests in parallel (all different files):
Task T015: "MobileApp.spec.tsx — route switching"
Task T016: "MobileTerminalList.spec.tsx — list rendering"
Task T017: "MobileTerminalView.spec.tsx — xterm container + reconnect banner"
Task T018: "useReconnect.spec.ts — Page Visibility API reconnect"

# Then implement in parallel (all different files):
Task T019: "mobile.css"
Task T020: "mobile.main.tsx"
Task T021: "useReconnect.ts"
# T022 (MobileApp), T023 (MobileTerminalList), T024 (MobileTerminalView) are sequential
# because MobileApp imports MobileTerminalList and MobileTerminalView
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: 375px viewport login → list → open terminal → type command → navigate back
5. Ship US1 as MVP if needed

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Mobile terminal view (MVP)
3. US2 + US3 (parallel) → Control keys + terminal creation
4. US4 → Multi-terminal switching
5. Polish → Docs, lint, coverage gate

---

## Notes

- All `[P]` tasks = different files, no blocking dependencies on incomplete sibling tasks
- `[Story]` label maps each task to its user story for traceability
- Each user story is independently testable — validate at each checkpoint before advancing
- TDD is mandatory per Constitution §VI — tests must FAIL before implementation starts
- Icons in `MobileControlToolbar.tsx` MUST use `lucide-react` (Constitution §XII)
- Do NOT edit `extensions/remote-control/src/index.js` directly — it is a compiled artifact
- Run `npm run build:extensions` after modifying any extension TypeScript source
