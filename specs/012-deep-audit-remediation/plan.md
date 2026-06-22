# Implementation Plan: Deep Audit Remediation

**Branch**: `main` | **Date**: 2026-06-21 | **Spec**: [spec.md](./spec.md)

---

## Summary

Address all 27 findings from the automated deep audit of the `refactor-notes-tasks-db` merge. The highest-severity fixes — removing a dead pre-commit rebuild step, locking down the IPC bridge to an explicit allowlist, upgrading Electron off an EOL release, and correcting stale ARCHITECTURE.md — are P1 and must ship first. Accessibility fixes (focus rings, ARIA labels, light mode including xterm.js theming), CI hardening (dependency audit, format job platform fix), and data-integrity fixes (settings namespace, migration logging, SQL injection guards) follow at P2/P3. Low-backlog items (spacing tokens, release automation, ADR-020, CHANGELOG, loader.ts coverage, diagrams.tags normalization) ship in the same feature.

---

## Technical Context

**Language/Version**: TypeScript 5.5.4 / Node.js 24.13.0  
**Primary Dependencies**: Electron 30.4.0 → latest stable (32.x fallback), Vitest 2.0.5, PGlite, xterm.js, Fastify (remote-control extension), Husky + lint-staged  
**Storage**: PGlite (shared embedded PostgreSQL-compatible DB); schema changes in this feature  
**Testing**: Vitest 2.0.5 with v8 coverage; 80% gate enforced; TDD required  
**Target Platform**: macOS only (macos-14 CI runner)  
**Project Type**: Electron desktop app (main process + renderer process + extension system)  
**Performance Goals**: Pre-commit hook < 5s; no regression in app startup time after Electron upgrade  
**Constraints**: Extension isolation (Constitution II) — no cross-extension imports; all new IPC channels documented before code lands  
**Scale/Scope**: Single developer machine; ~27 FR items across 20+ source files

---

## Constitution Check

_GATE: Must pass before implementation. Re-checked after each phase._

| Principle                          | Status  | Notes                                                                                                |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| I. Source Integrity                | ✅ PASS | All decisions grounded in Electron, xterm.js, PGlite official docs                                   |
| II. Extension Isolation            | ✅ PASS | IPC allowlist change touches extension boundary correctly; no cross-extension imports introduced     |
| IV. Dependency Stewardship         | ✅ PASS | Removing `better-sqlite3` ref; upgrading Electron; pinning `electron-rebuild`                        |
| V. Code Readability & Minimalism   | ✅ PASS | Each fix is minimal; no speculative abstractions                                                     |
| VI. TDD (NON-NEGOTIABLE)           | ✅ PASS | Every changed production file requires a failing test first; `loader.ts` coverage gap must be closed |
| VII. SOLID & YAGNI                 | ✅ PASS | Settings composite PK is the minimal schema change; no over-engineering                              |
| VIII. Documentation as First-Class | ✅ PASS | ARCHITECTURE.md, ipc-channels.md, electron.d.ts, README updated in same PR                           |
| IX. ADRs                           | ✅ PASS | ADR-020 (MCP sidecar removal) created; Electron upgrade may warrant ADR-021                          |
| X. Code Cleanliness                | ✅ PASS | Dead `better-sqlite3` line removed; no new dead exports                                              |
| XI. Functional Purity              | ✅ PASS | `_spCount` reset in `closeAppDb()` restores idempotency                                              |
| XII. UI Icons                      | ✅ PASS | No icon changes in this feature                                                                      |

**Complexity Tracking**: No constitution violations that require justification.

---

## Project Structure

### Documentation (this feature)

```text
specs/012-deep-audit-remediation/
├── plan.md              ← this file
├── spec.md
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── contracts/
│   └── ipc-changes.md   ← Phase 1 output
├── checklists/
│   └── requirements.md
└── tasks.md             ← /speckit-tasks output (not yet created)
```

### Source Files Touched (grouped by FR)

```text
# P1 — Developer Experience & Security
.husky/pre-commit                                         FR-001
src/main/remote/ipc-registry.ts                          FR-002, FR-003
src/main/index.ts                                         FR-002, FR-003
extensions/remote-control/src/server/routes/bridge.route.ts  FR-002, FR-003
  + audit all src/main/ipc/*.ipc.ts for remoteAccessible  FR-003
package.json                                              FR-004, FR-019
npm run rebuild (native module recompile)                 FR-004
docs/ARCHITECTURE.md                                      FR-005

# P2 — Accessibility & CI
src/renderer/styles.css                                   FR-006, FR-008, FR-021
src/renderer/components/ConfirmDialog.tsx                 FR-007, FR-017
src/renderer/components/ConfirmDialog.css  (or Dialog.css) FR-017
src/renderer/components/ErrorBoundary.tsx                 FR-009
src/renderer/components/terminal/TerminalSession.tsx      FR-008 (xterm theme)
.github/workflows/ci.yml                                  FR-010, FR-011

# P3 — Data Integrity & Code Quality
extensions/notepad/src/db/db.ts                           FR-012, FR-027
extensions/task-vault/src/vault/db.ts                     FR-012
src/main/db/migrate.ts                                    FR-013, FR-016
extensions/task-vault/src/index.ts                        FR-014
src/main/db/index.ts                                      FR-015, FR-020
src/main/remote/bridge-event-bus.ts                       FR-018
extensions/notepad/src/ipc/diagrams.ipc.ts                FR-027

# Backlog
.github/workflows/release.yml                             FR-022 (new)
docs/adr/020-mcp-sidecar-removal.md                       FR-023 (new)
CHANGELOG.md                                              FR-024 (new)
src/renderer/extensions/loader.ts  (+ new spec file)     FR-025
  → src/renderer/extensions/loader.spec.ts               FR-025
vitest.config.ts                                          FR-026

# Documentation (Constitution VIII — required in same PR)
docs/ARCHITECTURE.md                                      FR-005 + Electron upgrade note
specs/001-extension-first-terminal/contracts/ipc-channels.md  FR-020 (db:health)
src/renderer/electron.d.ts                                FR-020 (db:health type)
README.md                                                 light mode feature, Electron version
```

---

## Implementation Phases

### Phase 1 — P1: Unblock Commits & Security (FR-001 to FR-005)

**Goal**: Every commit is fast, the IPC bridge is locked down, Electron is upgraded, and docs are accurate.

#### 1.1 Remove dead pre-commit rebuild (FR-001)

- Delete line 1 (`npm rebuild better-sqlite3 --silent`) from `.husky/pre-commit`.
- **Test**: `git commit --allow-empty` completes in < 5s with no `better-sqlite3` output.

#### 1.2 IPC bridge allowlist (FR-002, FR-003)

- **Step A**: Modify `src/main/remote/ipc-registry.ts` — change `ipcInvokeRegistry` value type from `IpcHandler` to `{ handler: IpcHandler; remoteAccessible: boolean }`.
- **Step B**: Update the monkey-patch in `src/main/index.ts` to accept `opts?: { remoteAccessible?: boolean }` as a third argument; store `opts?.remoteAccessible ?? false` in the registry entry.
- **Step C**: Update `extensions/remote-control/src/server/routes/bridge.route.ts` — before dispatching `invokeChannel` at line 77, check the registry for `remoteAccessible`; return `{ type: 'error', id, error: 'channel not remote-accessible' }` if false.
- **Step D**: Audit all `src/main/ipc/*.ipc.ts` handler files. For each channel the mobile remote-control UI legitimately invokes, add `{ remoteAccessible: true }`. For all others, leave unset (defaults to `false`).
- **Tests**: New spec asserting bridge route rejects non-allowlisted channels; existing bridge tests updated to reflect new registry shape.
- **Note**: `ipcSendRegistry` follows the same pattern if `send`/`subscribe` message types need allowlist enforcement (assess during implementation).

#### 1.3 Electron upgrade (FR-004, FR-019)

- `npm install electron@latest --save-dev` (or `@32` if latest has breaking changes).
- `npm install --save-dev electron-rebuild` with pinned version.
- `npm run rebuild` — verify `node-pty` compiles cleanly.
- Launch app manually: open terminal tab, run a command, verify PTY works.
- Run `npx vitest run --coverage` — all 221+ tests pass.
- **If breaking changes block latest**: fall back to `electron@32` and document in ADR-021.

#### 1.4 ARCHITECTURE.md — Task Vault section (FR-005)

- Rewrite the Task Vault section to describe: shared PGlite database, `ExtensionDB` wrapper interface, `applyTaskVaultSchema` + `applyTaskVaultMigrations` initialization flow, removal of `getDb()/initDb()/closeDb()`.
- Remove all references to `better-sqlite3`, `.todo/vault.db`.
- Add a note about the `(extension_id, key)` settings composite PK (to be implemented in Phase 3).

---

### Phase 2 — P2: Accessibility & CI Hardening (FR-006 to FR-011)

**Goal**: Keyboard users have focus indicators, screen readers hear dialog names, light mode works end-to-end including terminals, and CI catches CVEs automatically.

#### 2.1 Remove `*:focus { outline: none }` (FR-006)

- Delete the `*:focus { outline: none }` block from `src/renderer/styles.css` (lines 101–104 per audit).
- Leave `*:focus-visible { outline: 2px solid ... }` intact.
- **Manual verification**: Tab through app, confirm focus rings visible on all interactive elements.
- **Test**: Visual regression is manual-only; add a CSS snapshot test if infrastructure permits.

#### 2.2 `ConfirmDialog` ARIA label (FR-007, FR-017)

- Add `id="confirm-dialog-title"` to the title element.
- Add `aria-labelledby="confirm-dialog-title"` to the `role="dialog"` root.
- Move the description `<p>` inline styles (`color: 'var(--text-secondary)'`, `fontSize: 13`, `marginBottom: 20`) to a `.dialog__description` class in `ConfirmDialog.css` (or `Dialog.css` if that is the canonical file).
- **Test**: Unit test for rendered output asserting `aria-labelledby` attribute.

#### 2.3 `ErrorBoundary` CSS variables (FR-009)

- Replace `background: '#0c0c0f'` with `background: 'var(--bg-base)'`.
- Replace `color: '#f87171'` with `color: 'var(--danger)'`.
- **Test**: Snapshot test or attribute assertion.

#### 2.4 Light theme + xterm.js theming (FR-008)

- **CSS tokens** (`styles.css`): Add `[data-theme="light"]` block overriding all `--bg-*`, `--text-*`, `--border-*`, and semantic color tokens. Design the light palette by inverting the dark values while preserving legibility contrast ratios.
- **xterm.js** (`TerminalSession.tsx`):
  - Define `const XTERM_THEMES: Record<'dark' | 'light', ITheme>` with the existing dark values and a Solarized-Light-derived light palette.
  - In the constructor, read `document.documentElement.dataset.theme ?? 'dark'` to set the initial theme.
  - Attach a `MutationObserver` to `document.documentElement` watching `attributes` (filter: `['data-theme']`). On change: `this.terminal.options.theme = XTERM_THEMES[newTheme]`.
  - Clean up the observer in `dispose()`.
- **Test**: Mock `MutationObserver` in vitest; assert `terminal.options.theme` is updated when `data-theme` changes.

#### 2.5 CI: dependency audit + platform cleanup (FR-010, FR-011)

- In `.github/workflows/ci.yml`, add to the `lint` job:
  ```yaml
  - name: Security audit
    run: npm audit --audit-level=high
  ```
- The `format` job currently runs on `ubuntu-latest` — this is intentional (formatting is platform-agnostic) and should remain. Remove no jobs; the macOS-only constraint means no new Linux jobs are added. All other jobs (`lint`, `typecheck`, `test`, `build`) already run on `macos-14` — no change needed.
- **Note**: `ubuntu-latest` on the `format` job is acceptable because Prettier output is platform-agnostic. This is not a Linux support commitment.

---

### Phase 3 — P3: Data Integrity & Code Quality (FR-012 to FR-019)

**Goal**: Settings namespace collision is impossible at the schema level, migration errors surface visibly, and all minor code-quality findings are resolved.

#### 3.1 Settings table composite PK (FR-012)

- In both `extensions/notepad/src/db/db.ts` and `extensions/task-vault/src/vault/db.ts`:
  - Update `CREATE TABLE IF NOT EXISTS settings` DDL to include `extension_id TEXT NOT NULL` and composite PK.
  - Add a migration step in `applyNotepadMigrations` / `applyTaskVaultMigrations` that:
    1. Checks if `extension_id` column exists (`PRAGMA table_info(settings)`).
    2. If not: `ALTER TABLE settings ADD COLUMN extension_id TEXT NOT NULL DEFAULT '__unknown__'`.
    3. Backfill: `UPDATE settings SET extension_id = 'notepad' WHERE key LIKE 'terminator.notepad.%'` (and equivalent for task-vault).
    4. Log any rows still with `'__unknown__'` at `warn` level.
    5. Recreate the primary key constraint (PGlite supports `ADD CONSTRAINT` or table recreation).
  - Update all settings read/write call sites to pass `extension_id` as a required argument.
- **Tests**: New tests asserting collision rejection; migration backfill correctness.

#### 3.2 Migration error logging (FR-013)

- In `src/main/db/migrate.ts` lines 73–75: replace empty `catch {}` with:
  ```typescript
  catch (err) {
    logger.warn(`Migration: skipped row ${rowIndex} of ${table}: ${String(err)}`)
    skippedCount++
  }
  ```
- After the loop: `logger.info(`Migration: imported ${importedCount}/${total} rows from ${table}; ${skippedCount} skipped (see warnings)`)`.
- **Test**: Mock `logger.warn` and assert it's called with the row index and error string on FK violation.

#### 3.3 SQL injection hardening in migrate.ts (FR-016)

- Lines 55–56: replace `PRAGMA table_info(${table})` with `PRAGMA table_info("${table}")` and validate `table` against `[...VAULT_TABLES, ...NOTEPAD_TABLES]` before use.
- Line 70: quote column names — `colList` assembled as `columnNames.map(c => `"${c}"`).join(', ')`.
- **Test**: Assert that an unknown table name throws before any SQL is executed.

#### 3.4 `scheduleWeeklyReviewNudge` interval guard (FR-014)

- At the top of `scheduleWeeklyReviewNudge` in `extensions/task-vault/src/index.ts`:
  ```typescript
  if (reviewNudgeInterval !== null) clearInterval(reviewNudgeInterval)
  ```
- **Test**: Call `scheduleWeeklyReviewNudge` twice; assert only one `setInterval` is active (mock `setInterval`/`clearInterval`).

#### 3.5 `closeAppDb()` resets `_spCount` (FR-015)

- In `src/main/db/index.ts` `closeAppDb()`: add `_spCount = 0` after `_db = null`.
- **Test**: Assert `_spCount` is 0 after `closeAppDb()` in an existing or new DB lifecycle test.

#### 3.6 `bridge-event-bus.ts` max listeners (FR-018)

- After constructing the `EventEmitter` in `src/main/remote/bridge-event-bus.ts`:
  ```typescript
  bridgeEventBus.setMaxListeners(0) // unlimited — one listener per subscriber
  ```
  Or: use the configured `maxSubscribers` value if that constant is accessible.
- **Test**: Assert no `MaxListenersExceededWarning` when 11+ listeners are added.

#### 3.7 `ConfirmDialog` inline styles → CSS class (FR-017)

Covered in Phase 2.2 above.

#### 3.8 `electron-rebuild` devDependency (FR-019)

Covered in Phase 1.3 above (pinned version added alongside Electron upgrade).

#### 3.9 `healthCheck()` IPC channel (FR-020)

- Create (or add to existing settings IPC file) a handler for `db:health`:
  ```typescript
  ipcMain.handle('db:health', async () => healthCheck())
  ```
- Add `db:health` to `specs/001-extension-first-terminal/contracts/ipc-channels.md`.
- Add `db: { health: () => Promise<{ ok: boolean; message?: string }> }` to `src/renderer/electron.d.ts`.
- Wire into Settings → About panel: call on mount, display `DB: OK` or `DB: Error — <message>`.
- **Test**: Mock `healthCheck()` and assert the IPC handler returns the expected shape.

---

### Phase 4 — Backlog (FR-021 to FR-027)

**Goal**: Spacing tokens, release automation, ADR-020, CHANGELOG, loader.ts coverage, coverage exclusion reduction, diagrams.tags normalization.

#### 4.1 Spacing token scale (FR-021)

- Add to `:root` in `styles.css`:
  ```css
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  ```
- Do **not** replace existing raw `px` values in component CSS files — that is a separate refactor outside this feature's scope (Constitution V: no speculative cleanup).

#### 4.2 Release automation (FR-022)

Create `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run rebuild
      - run: npm run package
      - name: Create GitHub Release
        run: gh release create "${{ github.ref_name }}" dist/*.dmg --title "${{ github.ref_name }}" --generate-notes
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

#### 4.3 ADR-020: MCP sidecar removal (FR-023)

Create `docs/adr/020-mcp-sidecar-removal.md` documenting: decision to remove the MCP stdio sidecar, motivation (WebSocket bridge made it redundant, maintenance cost), alternatives (keep sidecar alongside bridge), and that ADR-013 is superseded by both ADR-015 (storage) and this ADR (sidecar removal).

#### 4.4 CHANGELOG.md (FR-024)

Create `CHANGELOG.md` at project root using Keep a Changelog format. Seed with a `[0.1.64]` entry summarizing the `refactor-notes-tasks-db` merge, and a `[Unreleased]` section for this feature's changes.

#### 4.5 `loader.ts` coverage (FR-025)

- Create `src/renderer/extensions/loader.spec.ts`.
- Mock `import.meta.glob` via vitest's `vi.mock` / module factory.
- Mock `window.electronAPI.extension.list` via the existing `electronAPI` mock pattern.
- Write tests covering: active extension loaded, inactive extension skipped, no extensions case.
- **Gate**: `loader.ts` function coverage must reach ≥ 80%.

#### 4.6 Coverage exclusion reduction (FR-026)

- Remove overly-broad glob exclusions from `vitest.config.ts` for files that can be unit-tested.
- Retain specific exclusions for true entry points (`src/main/index.ts`, `src/main/preload.ts`, `src/renderer/index.tsx`).
- Add `/* v8 ignore next */` comments on specific untestable lines (Electron bootstrap side effects) in files that were previously glob-excluded.
- Run `npx vitest run --coverage` after each removal to confirm the 80% gate still passes.

#### 4.7 `diagrams.tags` normalization (FR-027)

- **Schema**: Add `diagram_tags` join table (see data-model.md).
- **Migration** in `applyNotepadMigrations`:
  1. Create `diagram_tags` table if not exists.
  2. For each row in `diagrams`, parse `tags` JSON array and insert into `diagram_tags`.
  3. Drop `diagrams.tags` column.
- **IPC handlers** (`extensions/notepad/src/ipc/diagrams.ipc.ts`): update all tag read/write to use JOIN queries instead of JSON parsing.
- **Tests**: Update existing diagram IPC tests to assert relational tag storage; add tests for tag filtering, rename, and delete cascade.

---

## Documentation Updates Required (Constitution VIII)

| Document                                                       | Change                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| `docs/ARCHITECTURE.md`                                         | Task Vault section rewrite (Phase 1.4); Electron version update |
| `specs/001-extension-first-terminal/contracts/ipc-channels.md` | Add `db:health` channel                                         |
| `src/renderer/electron.d.ts`                                   | Add `db:health` IPC type                                        |
| `README.md`                                                    | Light mode feature; Electron version badge if present           |
| `docs/adr/020-mcp-sidecar-removal.md`                          | New (Phase 4.3)                                                 |
| `CHANGELOG.md`                                                 | New (Phase 4.4)                                                 |

---

## Complexity Tracking

No constitution violations requiring justification. The `ipcMain.handle` monkey-patch extension (third argument) is a minimal additive change; the real Electron API is unaffected.
