# Feature Specification: Deep Audit Remediation

**Feature Branch**: `012-deep-audit-remediation`  
**Created**: 2026-06-21  
**Status**: Draft  
**Source**: `~/Desktop/deep-audit.md` — automated audit of `refactor-notes-tasks-db` merge

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Developer Commits Without Wasted Time (Priority: P1)

A developer runs `git commit` and the pre-commit hook completes in under 3 seconds, with no wasted time rebuilding packages that no longer exist in the project.

**Why this priority**: Every developer commit is currently paying 3–10 seconds for a dead `npm rebuild better-sqlite3` line. This is the highest-friction, lowest-effort fix in the audit.

**Independent Test**: After the fix, run `git commit --allow-empty -m "test"` and confirm the hook finishes in under 5 seconds with no `better-sqlite3`-related output.

**Acceptance Scenarios**:

1. **Given** a developer stages changes, **When** they run `git commit`, **Then** the pre-commit hook completes without any `better-sqlite3` rebuild step.
2. **Given** the pre-commit hook runs, **When** lint-staged and patch coverage check execute, **Then** total hook time is under 5 seconds on a warmed machine.

---

### User Story 2 — Security: Remote Bridge Cannot Invoke Arbitrary IPC Channels (Priority: P1)

An authenticated browser client connected via the remote-control WebSocket bridge can only invoke channels that are explicitly declared as remote-accessible. Internal channels like `shell:exec`, `dialog:open-directory`, and all workspace CRUD channels are not reachable remotely.

**Why this priority**: The current architecture registers every `ipcMain.handle` call in the bridge registry, meaning any authenticated WebSocket client can invoke `shell:exec` or any other channel. This is a critical security boundary violation.

**Independent Test**: With the fix applied, attempt to invoke a non-allowlisted channel (e.g., `dialog:open-directory`) via the WebSocket bridge and confirm it is rejected with an authorization error.

**Acceptance Scenarios**:

1. **Given** a browser client is authenticated to the WebSocket bridge, **When** it invokes a channel not on the remote-access allowlist, **Then** the bridge returns an error and does not execute the handler.
2. **Given** a browser client is authenticated, **When** it invokes a channel on the allowlist (e.g., an explicitly marked remote-control channel), **Then** the bridge executes it normally.
3. **Given** a new `ipcMain.handle` is registered for an internal feature, **When** the bridge dispatcher processes a request for that channel, **Then** it is rejected unless the channel is explicitly opted in.

---

### User Story 3 — Electron Upgrade: App Runs on a Supported Runtime (Priority: P1)

The app runs on Electron 32+ (a supported, actively patched release). All native modules (`node-pty`, `@electric-sql/pglite`) work correctly after the upgrade.

**Why this priority**: Electron 30 is end-of-life. Known CVEs in the embedded Chromium and Node.js layers are unpatched. This is the highest-severity security concern in the codebase.

**Independent Test**: `package.json` shows `electron` at 32.x or later; `npm run rebuild` succeeds; the app launches, creates a terminal, and runs a basic command.

**Acceptance Scenarios**:

1. **Given** the Electron dependency is upgraded, **When** `npm install` and `npm run rebuild` are run, **Then** no native module compilation errors occur.
2. **Given** the upgraded app is launched, **When** a user opens a terminal tab, **Then** PTY spawning works correctly.
3. **Given** the upgraded app is launched, **When** the notepad and task-vault extensions activate, **Then** PGlite initializes without errors.

---

### User Story 4 — Developer Reads Accurate Architecture Documentation (Priority: P1)

A developer reading `docs/ARCHITECTURE.md` to understand the task-vault data layer finds an accurate description of the shared PGlite database, the `ExtensionDB` interface, and the current initialization flow — not the removed `better-sqlite3` setup.

**Why this priority**: The current ARCHITECTURE.md actively misleads contributors about how the database works. This is a constitution violation (Principle VIII).

**Independent Test**: Read the Task Vault section of ARCHITECTURE.md and confirm it mentions PGlite, `ExtensionDB`, `applyTaskVaultSchema`, and does not mention `better-sqlite3`, `.todo/vault.db`, or `getDb()/initDb()/closeDb()`.

**Acceptance Scenarios**:

1. **Given** a developer reads the Task Vault section, **When** they look for the database technology in use, **Then** they see PGlite described as the shared datastore.
2. **Given** a developer reads the initialization flow, **When** they look for exported functions, **Then** they see `applyTaskVaultSchema`/`applyTaskVaultMigrations`, not `getDb()/initDb()/closeDb()`.

---

### User Story 5 — Keyboard Users See Focus Indicators (Priority: P2)

A keyboard-only user navigating the app via Tab sees a visible focus ring on every interactive element. No edge case exists where focus is silently lost.

**Why this priority**: `*:focus { outline: none }` globally removes focus indicators. WCAG 2.1 AA requires visible focus for keyboard navigation. This affects all keyboard and assistive-technology users.

**Independent Test**: Open the app, disable mouse input, navigate with Tab through all interactive elements, and confirm a visible focus ring appears on every focused element.

**Acceptance Scenarios**:

1. **Given** a user navigates with Tab, **When** focus reaches a button or input, **Then** a visible focus ring is rendered.
2. **Given** a user clicks a button with a mouse, **When** focus is programmatically set via script, **Then** no focus ring appears (`:focus-visible` heuristic handles this).
3. **Given** the CSS rule `*:focus { outline: none }` is removed, **When** the full app is loaded, **Then** no visual regression occurs for mouse users.

---

### User Story 6 — Screen Reader Users Hear Dialog Names (Priority: P2)

A screen reader user who opens the `ConfirmDialog` hears the dialog's title announced when focus enters it, rather than the generic "dialog" announcement.

**Why this priority**: Missing `aria-labelledby` on `role="dialog"` makes confirmation dialogs unusable for screen reader users. Two-line fix with real accessibility impact.

**Independent Test**: Open `ConfirmDialog` with a screen reader active (VoiceOver on macOS) and confirm the title is announced on focus entry.

**Acceptance Scenarios**:

1. **Given** a user triggers a confirmation dialog, **When** focus enters the dialog, **Then** the screen reader announces the dialog title.
2. **Given** the dialog title element has `id="dialog-title"`, **When** the dialog root has `aria-labelledby="dialog-title"`, **Then** accessibility tools report the dialog as properly labelled.

---

### User Story 7 — Light Mode Users Can Use the App Comfortably (Priority: P2)

A user who prefers a light background (accessibility need, bright environment, personal preference) can switch the app to a light theme that is visually comfortable and consistent with the design system.

**Why this priority**: The app is dark-only. The CSS infrastructure for `data-theme` switching already exists. The missing piece is the light token definitions.

**Independent Test**: Toggle the theme to "light" in settings and confirm all UI surfaces (sidebar, terminal header, dialogs, extensions) render with light background colors and readable text.

**Acceptance Scenarios**:

1. **Given** a user selects light theme in settings, **When** the theme is applied, **Then** all `--bg-*`, `--text-*`, and `--border-*` tokens resolve to light values.
2. **Given** light theme is active, **When** a user opens a dialog, **Then** the dialog renders with the light theme tokens, not hardcoded dark values.
3. **Given** the `ErrorBoundary` fallback renders in light mode, **When** an error occurs, **Then** the fallback UI uses CSS variables and displays correctly.
4. **Given** light theme is active, **When** a terminal tab is open, **Then** the xterm.js instance renders with a light-compatible background, foreground, and ANSI colors.
5. **Given** the user switches theme while a terminal is open, **When** the toggle completes, **Then** the terminal re-themes without requiring a restart.

---

### User Story 8 — CI Catches Security Vulnerabilities Automatically (Priority: P2)

The CI pipeline automatically fails when any high-severity dependency vulnerability is detected.

**Why this priority**: No `npm audit` in CI means vulnerabilities are only caught manually. This is a macOS-only app so no cross-platform matrix is needed.

**Independent Test**: Introduce a mock high-severity vulnerability and confirm CI fails at the audit step.

**Acceptance Scenarios**:

1. **Given** a PR is opened, **When** CI runs, **Then** `npm audit --audit-level=high` is executed and fails if any high-severity CVEs are found.
2. **Given** CI runs, **When** the test job executes, **Then** it runs on `macos-14` (the only supported platform).

---

### User Story 9 — Extension Settings Cannot Silently Collide (Priority: P3)

Two extensions that write to the shared `settings` table cannot silently overwrite each other's data, even if they use the same key string.

**Why this priority**: The shared `settings` table uses a single `key TEXT PRIMARY KEY` with no namespace enforcement. Collision is silent and data-destructive.

**Independent Test**: Write the same key from two different extensions and confirm the second write is rejected or stored under a distinct namespace.

**Acceptance Scenarios**:

1. **Given** two extensions both write `settings` key `'theme'`, **When** the second write occurs, **Then** it does not overwrite the first extension's value.
2. **Given** the schema has a `(extension_id, key)` composite primary key, **When** an extension writes a key, **Then** the extension_id is required and validated.

---

### User Story 10 — Migration Errors Are Visible, Not Silent (Priority: P3)

When a user upgrades from `better-sqlite3` to PGlite and some rows fail to migrate (FK violations, schema mismatch), the app logs which rows failed and why, and displays a summary rather than silently skipping them.

**Why this priority**: Silent data loss during migration is the worst kind of failure — users may never know their data was partially migrated.

**Independent Test**: Provide a SQLite file with known FK-violating rows and confirm the migration log shows "Migrated N/M rows; K skipped" with specific row details at warn level.

**Acceptance Scenarios**:

1. **Given** a legacy SQLite file with FK-violating rows, **When** migration runs, **Then** each failed row is logged at `warn` level with the row index and error message.
2. **Given** migration completes, **When** the log is inspected, **Then** a summary line shows `'Migrated N/M rows; K skipped (see warnings)'`.

---

### Edge Cases

- What happens when Electron upgrade breaks `node-pty` compilation? (Pin compatible `node-pty` version, run `npm run rebuild` explicitly.)
- What happens when an extension double-activates and `scheduleWeeklyReviewNudge` is called twice? (Existing interval must be cleared before creating a new one.)
- What happens when a WebSocket bridge request arrives for a channel that was registered before the allowlist was implemented? (Must be denied by default — allowlist is opt-in, not opt-out.)
- What happens if `_spCount` is non-zero when a new DB connection is created after `closeAppDb()`? (Counter must reset to 0 in `closeAppDb()`.)
- What if the light theme token block is added but `ErrorBoundary` still uses hardcoded hex colors? (All inline hardcoded color values must be migrated to CSS variables before light mode is considered complete.)

---

## Requirements _(mandatory)_

### Functional Requirements

**Immediate (P1) — Developer Experience & Security:**

- **FR-001**: The pre-commit hook MUST NOT include `npm rebuild better-sqlite3` or any reference to removed packages.
- **FR-002**: The WebSocket bridge dispatcher MUST reject any IPC channel invocation that is not on an explicit remote-access allowlist; rejected calls MUST return an error to the client.
- **FR-003**: The remote-access allowlist MUST be opt-in via a `{ remoteAccessible: true }` flag passed at `ipcMain.handle` call sites; the bridge dispatcher reads this flag from the registry and rejects any channel not explicitly marked. This is the canonical definition — no separate config file or hardcoded array.
- **FR-004**: The app MUST run on the latest stable Electron release at time of implementation. If the latest stable introduces breaking changes that cannot be resolved within this feature's scope, the target falls back to Electron 32.x (latest patch). All native modules (`node-pty`, `@electric-sql/pglite`) MUST compile and function correctly on the chosen version.
- **FR-005**: `docs/ARCHITECTURE.md` Task Vault section MUST describe PGlite as the datastore, the `ExtensionDB` interface, and the `applyTaskVaultSchema`/`applyTaskVaultMigrations` initialization flow; it MUST NOT mention `better-sqlite3`, `.todo/vault.db`, or `getDb()/initDb()/closeDb()`.

**High (P2) — Accessibility & CI:**

- **FR-006**: The `*:focus { outline: none }` CSS rule MUST be removed; focus ring rendering MUST be handled exclusively by `*:focus-visible`.
- **FR-007**: `ConfirmDialog` MUST have `aria-labelledby` pointing to its title element; the title element MUST have a matching `id`.
- **FR-008**: `styles.css` MUST include a `[data-theme="light"]` block defining light values for all `--bg-*`, `--text-*`, `--border-*`, and semantic color tokens. When light theme is active, the xterm.js terminal instance(s) MUST also be updated with a light-compatible theme object (background, foreground, cursor, and ANSI color values); this update MUST be applied reactively whenever the theme changes without requiring a restart.
- **FR-009**: `ErrorBoundary.tsx` fallback UI MUST use CSS variables (`var(--bg-base)`, `var(--danger)`) instead of hardcoded hex colors.
- **FR-010**: The CI pipeline MUST include an `npm audit --audit-level=high` step that fails on high-severity CVEs.
- **FR-011**: The CI `test` job MUST run on `macos-14`. Linux is explicitly out of scope — this is a macOS-only app.

**Medium (P3) — Data Integrity & Code Quality:**

- **FR-012**: The `settings` table MUST enforce namespace isolation between extensions via a `(extension_id, key)` composite primary key. The schema migration MUST backfill `extension_id` for existing rows by parsing the key string prefix (e.g., `terminator.task-vault.*` → `'task-vault'`); rows whose prefix cannot be resolved MUST be logged at `warn` level.
- **FR-013**: The legacy migration (`migrate.ts`) MUST log each failed row at `warn` level with the row index and error message; it MUST log a summary of `N/M rows migrated, K skipped` at `info` level.
- **FR-014**: `scheduleWeeklyReviewNudge` MUST clear any existing interval before creating a new one.
- **FR-015**: `closeAppDb()` MUST reset `_spCount` to 0.
- **FR-016**: Column names interpolated into SQL in `migrate.ts` MUST be double-quoted to prevent injection from malicious SQLite column names; `table` values MUST be validated against the known constants array at runtime.
- **FR-017**: `ConfirmDialog.tsx` description paragraph MUST use a CSS class from `Dialog.css` instead of inline styles.
- **FR-018**: `bridge-event-bus.ts` MUST call `setMaxListeners` with a value matching the configured `maxSubscribers` to prevent Node.js EventEmitter warnings.
- **FR-019**: `electron-rebuild` MUST be listed as an explicit devDependency in `package.json` with a pinned version.

**Low (Backlog):**

- **FR-020**: `healthCheck()` MUST be wired to an accessible IPC channel (e.g., `db:health`) so DB status can be surfaced in the About panel.
- **FR-021**: A spacing token scale (`--space-1` through `--space-12`) SHOULD be defined in `styles.css`.
- **FR-022**: A release automation workflow (`release.yml`) SHOULD build and publish the `.dmg` on `v*` tag push.
- **FR-023**: ADR-020 documenting MCP sidecar removal SHOULD be created.
- **FR-024**: A CHANGELOG.md SHOULD be created using Keep a Changelog format.
- **FR-025**: `loader.ts` function coverage MUST reach ≥ 80% (currently 16.67%).
- **FR-026**: Coverage exclusions in `vitest.config.ts` SHOULD be reduced; files should use per-file `/* v8 ignore */` annotations instead of broad glob exclusions.
- **FR-027**: `diagrams.tags` SHOULD be migrated from JSON text blob to a relational join table matching the `note_tags` model.

### Key Entities

- **IPC Remote-Access Allowlist**: The set of IPC channels permitted for invocation via the WebSocket bridge. Membership is declared at the `ipcMain.handle` call site via `{ remoteAccessible: true }`; the bridge dispatcher checks this flag in the registry. Channels without the flag are rejected by default.
- **Light Theme Token Block**: A `[data-theme="light"]` CSS rule block in `styles.css` defining inverted values for every token currently defined in the `:root` dark block.
- **Settings Namespace**: A `(extension_id, key)` composite primary key on the shared `settings` table. `extension_id` is derived from the key string prefix (e.g., `terminator.task-vault.*` → `'task-vault'`) during the backfill migration, and required at write time going forward.

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Pre-commit hook completes in under 5 seconds on a warmed developer machine (down from 8–13 seconds).
- **SC-002**: Zero IPC channels not on the remote-access allowlist can be invoked via the WebSocket bridge by an authenticated client.
- **SC-003**: The app launches, creates a terminal, and executes a command without errors on the target Electron version (latest stable, or 32.x if breaking changes block the upgrade).
- **SC-004**: All keyboard-navigable interactive elements display a visible focus ring when navigated via Tab (verified by manual keyboard walkthrough).
- **SC-005**: Screen readers announce the `ConfirmDialog` title when focus enters the dialog (verified with VoiceOver on macOS).
- **SC-006**: Light theme renders without hardcoded dark values on any UI surface — including app chrome and xterm.js terminal content — verified by visual inspection with `data-theme="light"` applied. Theme switches apply to open terminals without a restart.
- **SC-007**: CI fails automatically on any PR that introduces a high-severity dependency CVE.
- **SC-008**: CI test suite passes on macOS (`macos-14`). Linux is not a supported platform.
- **SC-009**: Two extensions writing the same settings key produce an error or isolated storage — no silent data overwrite.
- **SC-010**: A migration run with known-bad rows produces a log entry per failed row and a summary count; no data loss occurs silently.
- **SC-011**: `npm test` passes with all existing 221+ tests passing and all coverage thresholds ≥ 80%.
- **SC-012**: `npm run lint` passes with 0 errors after all changes.

---

## Clarifications

### Session 2026-06-21

- Q: How is the remote-access allowlist defined (constant array, annotation/flag, or config file)? → A: Opt-in annotation — a `{ remoteAccessible: true }` flag at `ipcMain.handle` call sites; the bridge dispatcher reads the flag from the registry.
- Q: What `extension_id` is backfilled for existing settings rows that pre-date namespacing? → A: Parse the key string prefix (e.g., `terminator.task-vault.*` → `'task-vault'`); log unresolvable rows at `warn` level.
- Q: Pin Electron to 32.x or upgrade to latest stable? → A: Latest stable at implementation time; fall back to 32.x if breaking changes cannot be resolved within this feature's scope.
- Q: Does light mode apply to xterm.js terminal content or only app chrome? → A: Both — xterm.js instances must be re-themed reactively when the theme toggles, without a restart.
- Q: Are low-backlog items (FR-020–027) in scope for this feature or a separate follow-up? → A: In scope — all 27 FRs are implemented in one feature.

### Session 2026-06-21 (addendum)

- Q: Does the CI matrix need to cover Linux or other operating systems? → A: No. macOS only — Linux and Windows are explicitly out of scope for this app.

---

## Assumptions

- The remote-control extension's existing channel surface (the channels it intentionally exposes remotely) is small and well-known; an explicit allowlist will not require large-scale refactoring of extension IPC handlers.
- `node-pty` has a compatible release for Electron 32; if not, a patch version bump or fork is acceptable as a blocking sub-task.
- The light theme CSS token values can be derived by inverting the dark palette. xterm.js light theming requires defining a separate theme object with light-compatible ANSI color values (background, foreground, cursor, and 16 ANSI colors); these values need to be chosen alongside the CSS tokens.
- Coverage exclusions for `src/main/index.ts` and `src/main/preload.ts` may remain as `/* v8 ignore */` since these are genuine Electron entry points not exercisable in vitest.
- The `settings` table namespace fix requires a schema migration; existing data in the shared PGlite database must be migrated to add the `extension_id` column with backfilled values.
- E2E tests (Playwright) are out of scope for this remediation spec — adding CI E2E coverage is captured as a future recommendation, not a requirement here.
- **Platform scope**: macOS only. Linux and Windows are not supported platforms. No cross-platform CI matrix, no Linux-specific native module testing.
- The `ngrokManager` version-pinning issue and `bridge-event-bus.ts` `setMaxListeners` fix are low-risk, low-effort changes that can be bundled with the other fixes without dedicated user stories.
