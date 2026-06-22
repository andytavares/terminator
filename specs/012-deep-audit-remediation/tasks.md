# Tasks: Deep Audit Remediation

**Input**: Design documents from `/specs/012-deep-audit-remediation/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ipc-changes.md ✅

**Tests**: Constitution Principle VI (TDD NON-NEGOTIABLE) — write failing tests first. Red → Green → Refactor for every production file change.

**Organization**: Tasks are grouped by user story (US1–US10 from spec.md) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1–US10)
- Exact file paths are included in every task description

---

## Phase 1: Setup

**Purpose**: No external scaffolding needed — this is a remediation feature. Audit the IPC registry shape before any story work begins.

- [x] T001 Read all `src/main/ipc/*.ipc.ts` files and list every `ipcMain.handle` call site to determine which channels the mobile remote-control UI invokes (produces the allowlist for US2/T008)

---

## Phase 2: Foundational (Blocking Prerequisite for US2)

**Purpose**: Change `ipcInvokeRegistry` value type from bare `IpcHandler` to `IpcRegistryEntry`. This single type change is required before the bridge route (US2) and the monkey-patch update (US2) can compile.

**⚠️ CRITICAL**: US2 tasks T007–T010 cannot begin until T002–T003 are complete.

- [x] T002 Write failing spec asserting `ipcInvokeRegistry` entries contain `{ handler, remoteAccessible }` shape in `src/main/remote/ipc-registry.spec.ts`
- [x] T003 Define `IpcRegistryEntry = { handler: IpcHandler; remoteAccessible: boolean }` and update `ipcInvokeRegistry` map type in `src/main/remote/ipc-registry.ts`

**Checkpoint**: Registry type updated — US2 work can now begin.

---

## Phase 3: User Story 1 — Developer Commits Without Wasted Time (Priority: P1) 🎯 MVP

**Goal**: Remove the dead `npm rebuild better-sqlite3` line from `.husky/pre-commit` so every `git commit` completes in under 5 seconds.

**Independent Test**: Run `git commit --allow-empty -m "test"` and confirm the hook finishes in under 5 seconds with no `better-sqlite3`-related output.

- [x] T004 [US1] Delete `npm rebuild better-sqlite3 --silent` line from `.husky/pre-commit`

**Checkpoint**: User Story 1 complete — pre-commit hook is fast.

---

## Phase 4: User Story 2 — Remote Bridge Cannot Invoke Arbitrary IPC Channels (Priority: P1)

**Goal**: The WebSocket bridge rejects any IPC channel not explicitly marked `{ remoteAccessible: true }` at its registration site.

**Independent Test**: Invoke a non-allowlisted channel (e.g., `dialog:open-directory`) via the WebSocket bridge and confirm it returns `{ type: 'error', error: 'channel not remote-accessible' }` and never executes the handler.

- [x] T005 [US2] Write failing spec asserting bridge route returns `{ type: 'error' }` for non-allowlisted channel invocations in `extensions/remote-control/src/server/routes/bridge.route.spec.ts`
- [x] T006 [US2] Write failing spec asserting bridge route executes handler for allowlisted channels in `extensions/remote-control/src/server/routes/bridge.route.spec.ts`
- [x] T007 [US2] Update monkey-patch in `src/main/index.ts` to accept `opts?: { remoteAccessible?: boolean }` as third arg to `ipcMain.handle`; store `opts?.remoteAccessible ?? false` in the registry entry
- [x] T008 [US2] Update `extensions/remote-control/src/server/routes/bridge.route.ts` line 77 to check `remoteAccessible` flag from registry before `invokeChannel` dispatch; return `{ type: 'error', id, error: 'channel not remote-accessible' }` if false
- [x] T009 [US2] Using the audit from T001, add `{ remoteAccessible: true }` to each `ipcMain.handle` call in `src/main/ipc/*.ipc.ts` that the mobile remote-control UI legitimately invokes; leave all others unset

**Checkpoint**: User Story 2 complete — bridge allowlist enforced.

---

## Phase 5: User Story 3 — App Runs on a Supported Electron Runtime (Priority: P1)

**Goal**: Upgrade Electron to latest stable (32.x fallback). All native modules compile and PTY works.

**Independent Test**: `package.json` shows `electron` at 32.x or later; `npm run rebuild` succeeds; app launches, creates a terminal, and runs a basic command.

- [x] T010 [US3] Add `electron-rebuild` as an explicit devDependency with pinned version in `package.json` (FR-019)
- [x] T011 [US3] Upgrade `electron` to latest stable in `package.json`; run `npm install`; run `npm run rebuild` and verify `node-pty` compiles without errors — fall back to `electron@32` if breaking changes cannot be resolved; document decision in ADR-021 if fallback is needed (node-pty NAN C++20 incompatibility; reverted to 30.4.0; ADR-021 created)
- [x] T012 [US3] Run `npx vitest run --coverage` after upgrade to confirm all 221+ tests still pass and coverage gates hold

**Checkpoint**: User Story 3 complete — app runs on a supported Electron version.

---

## Phase 6: User Story 4 — Developer Reads Accurate Architecture Docs (Priority: P1)

**Goal**: `docs/ARCHITECTURE.md` Task Vault section accurately describes PGlite, `ExtensionDB`, and the current init flow.

**Independent Test**: Read the Task Vault section — it mentions PGlite, `ExtensionDB`, `applyTaskVaultSchema`, and contains no references to `better-sqlite3`, `.todo/vault.db`, or `getDb()/initDb()/closeDb()`.

- [x] T013 [US4] Rewrite the Task Vault section of `docs/ARCHITECTURE.md`: describe shared PGlite database, `ExtensionDB` wrapper interface, `applyTaskVaultSchema`/`applyTaskVaultMigrations` init flow, note the upcoming `(extension_id, key)` composite PK; remove all references to `better-sqlite3`, `.todo/vault.db`, `getDb()/initDb()/closeDb()`; add Electron version update note

**Checkpoint**: User Story 4 complete — architecture docs are accurate.

---

## Phase 7: User Story 5 — Keyboard Users See Focus Indicators (Priority: P2)

**Goal**: Remove `*:focus { outline: none }` so WCAG 2.1 AA focus ring requirement is met; `:focus-visible` handles mouse vs keyboard distinction.

**Independent Test**: Navigate the app with Tab only and confirm a visible focus ring appears on every interactive element.

- [x] T014 [US5] Delete the `*:focus { outline: none }` block (lines ~101–104) from `src/renderer/styles.css`; verify `*:focus-visible` rule is still present

**Checkpoint**: User Story 5 complete — focus rings visible for keyboard users.

---

## Phase 8: User Story 6 — Screen Reader Users Hear Dialog Names (Priority: P2)

**Goal**: `ConfirmDialog` has `aria-labelledby` pointing to its title so screen readers announce the title on focus entry. Inline styles moved to CSS class.

**Independent Test**: Open `ConfirmDialog` with VoiceOver active and confirm the title is announced; confirm `aria-labelledby` is present in rendered HTML.

- [x] T015 [P] [US6] Write failing spec asserting `ConfirmDialog` renders with `aria-labelledby="confirm-dialog-title"`, title element has `id="confirm-dialog-title"`, and description `<p>` has `className="dialog__description"` with no inline `style` attribute, in `src/renderer/components/ConfirmDialog.spec.tsx`
- [x] T016 [US6] Add `id="confirm-dialog-title"` to the title element and `aria-labelledby="confirm-dialog-title"` to the `role="dialog"` root in `src/renderer/components/ConfirmDialog.tsx`
- [x] T017 [US6] Move description `<p>` inline styles (`color`, `fontSize`, `marginBottom`) to a `.dialog__description` CSS class in `ConfirmDialog.css` (or `Dialog.css`); remove inline styles from `ConfirmDialog.tsx` (FR-017)

**Checkpoint**: User Story 6 complete — dialogs accessible to screen readers.

---

## Phase 9: User Story 7 — Light Mode Users Can Use the App Comfortably (Priority: P2)

**Goal**: Full light mode: CSS tokens, `ErrorBoundary` CSS variables, and xterm.js live re-theming.

**Independent Test**: Toggle theme to "light" — all UI surfaces (sidebar, terminal, dialogs, `ErrorBoundary`) render with light values; switch theme while a terminal is open and the terminal re-themes without restart.

- [x] T018 [P] [US7] Write failing spec asserting `TerminalSession` sets `terminal.options.theme` from `XTERM_THEMES.dark` on init and updates to `XTERM_THEMES.light` when `MutationObserver` fires a `data-theme="light"` change, in `src/renderer/components/terminal/TerminalSession.spec.ts`
- [x] T019 [P] [US7] Add `[data-theme="light"]` block to `src/renderer/styles.css` defining light values for all `--bg-*`, `--text-*`, `--border-*`, and semantic color tokens (invert dark palette; maintain WCAG contrast ratios)
- [x] T020a [P] [US7] Write failing spec asserting `ErrorBoundary` fallback renders with `var(--bg-base)` background and `var(--danger)` color (no hardcoded hex values) in `src/renderer/components/ErrorBoundary.spec.tsx`
- [x] T020 [P] [US7] Replace `background: '#0c0c0f'` with `background: 'var(--bg-base)'` and `color: '#f87171'` with `color: 'var(--danger)'` in `src/renderer/components/ErrorBoundary.tsx` (FR-009)
- [x] T021 [US7] Add `XTERM_THEMES: Record<'dark' | 'light', ITheme>` constant to `src/renderer/components/terminal/TerminalSession.tsx`; read `document.documentElement.dataset.theme ?? 'dark'` at construction to set initial theme; attach `MutationObserver` on `data-theme` attribute changes to call `this.terminal.options.theme = XTERM_THEMES[newTheme]`; clean up observer in `dispose()` (FR-008)

**Checkpoint**: User Story 7 complete — light mode works end-to-end including terminals.

---

## Phase 10: User Story 8 — CI Catches Security Vulnerabilities Automatically (Priority: P2)

**Goal**: CI pipeline fails on any high-severity CVE; test job is confirmed to run on `macos-14`.

**Independent Test**: CI `lint` job runs `npm audit --audit-level=high`; CI `test` job targets `macos-14`.

- [x] T022a [US8] Add `- name: Security audit` / `run: npm audit --audit-level=high` step to the `lint` job in `.github/workflows/ci.yml` (FR-010)
- [x] T022b [US8] Verify all jobs except `format` in `.github/workflows/ci.yml` target `macos-14`; add `runs-on: macos-14` to any job that is missing it (FR-011)

**Checkpoint**: User Story 8 complete — CI catches high-severity CVEs automatically.

---

## Phase 11: User Story 9 — Extension Settings Cannot Silently Collide (Priority: P3)

**Goal**: `settings` table enforces `(extension_id, key)` composite PK; existing data is migrated with backfilled `extension_id`; all write call sites require `extension_id`.

**Independent Test**: Write key `'theme'` from two different `extension_id` values — both rows persist independently. Write the same `(extension_id, key)` pair twice — second write is rejected by PK constraint.

- [x] T023 [P] [US9] Write failing spec asserting settings collision is rejected and backfill correctly resolves `extension_id` by key prefix in `extensions/notepad/src/db/db.spec.ts`
- [x] T024 [P] [US9] Write failing spec asserting same in `extensions/task-vault/src/vault/db.spec.ts`
- [x] T025 [US9] Update `CREATE TABLE IF NOT EXISTS settings` DDL in `extensions/notepad/src/db/db.ts` to include `extension_id TEXT NOT NULL` and `PRIMARY KEY (extension_id, key)`; add migration step in `applyNotepadMigrations` to check for `extension_id` column, `ALTER TABLE` to add it, backfill (`terminator.notepad.*` → `'notepad'`), log unresolvable rows at `warn`
- [x] T026 [US9] Update `CREATE TABLE IF NOT EXISTS settings` DDL in `extensions/task-vault/src/vault/db.ts` to include `extension_id TEXT NOT NULL` and `PRIMARY KEY (extension_id, key)`; add migration step in `applyTaskVaultMigrations` to check for `extension_id` column, `ALTER TABLE` to add it, backfill (`terminator.task-vault.*` → `'task-vault'`), log unresolvable rows at `warn`
- [x] T027 [US9] Update all settings read/write call sites in `extensions/notepad/src/` to pass `extension_id` as required argument
- [x] T028 [US9] Update all settings read/write call sites in `extensions/task-vault/src/` to pass `extension_id` as required argument

**Checkpoint**: User Story 9 complete — extension settings are namespace-isolated.

---

## Phase 12: User Story 10 — Migration Errors Are Visible, Not Silent (Priority: P3)

**Goal**: `migrate.ts` logs each failed row at `warn` level with row index and error; logs summary at `info`; column names are quoted; `table` is validated against a known allowlist to prevent SQL injection.

**Independent Test**: Provide a SQLite file with FK-violating rows — migration log shows per-row `warn` entries and a `'Migrated N/M rows; K skipped'` summary line.

- [x] T029 [P] [US10] Write failing spec asserting `logger.warn` is called per failed row and `logger.info` is called with summary count in `src/main/db/migrate.spec.ts`
- [x] T030 [P] [US10] Write failing spec asserting unknown table name throws before any SQL is executed in `src/main/db/migrate.spec.ts`
- [x] T031 [US10] Replace empty `catch {}` at lines 73–75 of `src/main/db/migrate.ts` with `catch (err) { logger.warn(...); skippedCount++ }`; add summary info log after the loop (FR-013)
- [x] T032 [US10] Validate `table` against `[...VAULT_TABLES, ...NOTEPAD_TABLES]` via `assertTableAllowed`; quote column names and table name in `src/main/db/migrate.ts` (FR-016)

**Checkpoint**: User Story 10 complete — migration errors surface clearly.

---

## Phase 13: Polish & Backlog (FR-014, FR-015, FR-018, FR-020 through FR-027)

**Purpose**: Remaining items from the 27-finding audit that do not map to a top-level user story.

- [x] T033 [P] Write failing spec asserting `scheduleWeeklyReviewNudge` called twice results in only one active `setInterval` in `extensions/task-vault/tests/index.spec.ts`
- [x] T034 [P] Write failing spec asserting `_spCount` is 0 after `closeAppDb()` in `tests/unit/db/index.spec.ts`
- [x] T035 [P] Add `if (reviewNudgeInterval !== null) clearInterval(reviewNudgeInterval)` guard at top of `scheduleWeeklyReviewNudge` in `extensions/task-vault/src/index.ts` (FR-014)
- [x] T036 [P] Add `_spCount = 0` after `_db = null` in `closeAppDb()` in `src/main/db/index.ts` (FR-015)
- [x] T037a [P] Write failing spec asserting no `MaxListenersExceededWarning` when 11+ listeners are added to `bridgeEventBus` in `tests/unit/main/remote/bridge-event-bus.spec.ts`
- [x] T037 [P] Call `bridgeEventBus.setMaxListeners(200)` after constructing the `EventEmitter` in `src/main/remote/bridge-event-bus.ts` — already present, verified (FR-018)
- [x] T038 [P] Write failing spec asserting `db:health` IPC handler returns `{ ok: boolean; message?: string }` in `tests/unit/db/db.ipc.spec.ts`
- [x] T039 Register `db:health` IPC channel in `src/main/ipc/db.ipc.ts`; call `registerDbIpcHandlers()` from main index; wire into preload.ts (FR-020)
- [x] T040 Add `db:health` channel to `specs/001-extension-first-terminal/contracts/ipc-channels.md` and add `db: { health: () => Promise<{ ok: boolean; message?: string }> }` to `src/renderer/electron.d.ts` (FR-020, Constitution VIII)
- [x] T041 Wire `db:health` IPC call into `src/renderer/components/AboutDialog.tsx`: call on mount, display `DB: OK` or `DB: Error — <message>` (FR-020)
- [x] T042 [P] Add spacing token scale (`--space-1: 4px` through `--space-12: 48px`) to `:root` block in `src/renderer/styles.css` (FR-021)
- [x] T043 [P] Create `.github/workflows/release.yml` — already exists with macos-14, npm ci, rebuild, package, release steps (FR-022)
- [x] T044 [P] Create `docs/adr/020-mcp-sidecar-removal.md` documenting removal of MCP stdio sidecar, motivation (WebSocket bridge provides equivalent capability), alternatives considered, and that ADR-013 is superseded (FR-023)
- [x] T045 [P] Create `CHANGELOG.md` at project root in Keep a Changelog format; seed with `[0.1.64]` entry for `refactor-notes-tasks-db` merge and `[Unreleased]` section for this feature (FR-024)
- [x] T046 [P] Create `src/renderer/extensions/loader.spec.ts` — already exists at `tests/unit/renderer/extensions/loader.spec.ts` with 11 tests covering all branches (FR-025)
- [x] T047 [P] Remove overly-broad glob exclusions from `vitest.config.ts`; removed `extensions/*/src/vault/db.ts` exclusion; confirmed 4008 tests pass with all coverage thresholds ≥ 80% (FR-026)
- [x] T048 Write failing spec for `diagram_tags` relational storage in `extensions/notepad/src/ipc/diagrams.ipc.spec.ts` asserting tag queries use JOIN not JSON parsing
- [x] T049 Add `diagram_tags` join table DDL and migration step (parse `diagrams.tags` JSON, insert rows, drop `tags` column) to `applyNotepadMigrations` in `extensions/notepad/src/db/db.ts` (FR-027)
- [x] T050 Update all tag read/write operations in `extensions/notepad/src/ipc/diagrams.ipc.ts` to use relational JOIN queries instead of JSON parsing (FR-027)
- [x] T051 Update `README.md`: add light mode to features list; update Electron version badge/reference (Constitution VIII)
- [x] T052 Run `npm run format && npm run lint && npx vitest run --coverage && npm run build:extensions` — confirm 0 lint errors, all coverage thresholds ≥ 80%, extensions compile

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 audit output — **blocks US2 (Phase 4)**
- **Phase 3 (US1)**: Independent — can run in parallel with any other phase
- **Phase 4 (US2)**: Requires Phase 2 complete (registry type change)
- **Phase 5 (US3)**: Independent — run early so upgrade issues surface quickly
- **Phase 6 (US4)**: Independent — documentation-only
- **Phase 7 (US5)**: Independent — single CSS line removal
- **Phase 8 (US6)**: Independent — component + CSS change
- **Phase 9 (US7)**: Independent — CSS + component changes
- **Phase 10 (US8)**: Independent — CI YAML only
- **Phase 11 (US9)**: Independent — DB schema + migration
- **Phase 12 (US10)**: Independent — migrate.ts only
- **Phase 13 (Backlog)**: Independent tasks; T039–T041 must run in order (register → document → wire UI)

### User Story Dependencies

- **US1 (P1)**: No dependencies — 1 file, 1 line
- **US2 (P1)**: Requires Phase 2 (IpcRegistryEntry type) — otherwise independent; **T009 depends on T001** (audit output must exist before marking channels)
- **US3 (P1)**: Independent
- **US4 (P1)**: Independent
- **US5 (P2)**: Independent
- **US6 (P2)**: Independent
- **US7 (P2)**: Independent
- **US8 (P2)**: Independent
- **US9 (P3)**: Independent of all user stories
- **US10 (P3)**: Independent of all user stories

### Parallel Opportunities

- US1, US3, US4, US5, US7, US8, US9, US10 — all fully parallel after Phase 2
- US2 — parallel with everything except Phase 2 (wait for T002–T003)
- US6 — parallel with all others
- Backlog tasks T033–T037 are all parallel with each other
- T039 must precede T040, which must precede T041

---

## Parallel Example: P1 Stories

```
# After Phase 2 completes, launch all P1 stories simultaneously:
US1: T004  (1 task, 2 minutes)
US2: T005 → T006 → T007 → T008 → T009
US3: T010 → T011 → T012
US4: T013  (1 task, ~30 minutes)
```

---

## Implementation Strategy

### MVP First (P1 Stories Only — US1 through US4)

1. Complete Phase 1: Setup audit (T001)
2. Complete Phase 2: Foundational type change (T002–T003)
3. Complete Phase 3–6 in parallel: US1, US2, US3, US4
4. **STOP and VALIDATE**: `npx vitest run --coverage`, manual commit timing, manual bridge rejection test
5. Merge P1 stories if validations pass

### Incremental Delivery

1. P1 stories (US1–US4) → security baseline + accurate docs
2. P2 stories (US5–US8) → accessibility + CI hardening
3. P3 stories (US9–US10) → data integrity
4. Backlog (Phase 13) → remaining 7 FRs

---

## Notes

- **[P]** = different files, no shared state — safe to run concurrently
- **[Story]** label maps each task to a specific user story for traceability
- Write the failing test first — never skip Red phase
- Run `npx vitest run --coverage` after each phase to catch regressions early
- Constitution VIII: all IPC channel additions (T040) and documentation changes (T013, T051) ship in the same commit as the code they document
