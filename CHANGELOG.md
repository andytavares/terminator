# Changelog

All notable changes to Terminator are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- Light mode CSS token overrides (`[data-theme="light"]` block in `styles.css`)
- `db:health` IPC channel returning `{ ok, message? }` — wired into About dialog
- Spacing token scale (`--space-1` through `--space-12`) in CSS `:root`
- IPC remote-access allowlist: `{ remoteAccessible: true }` opt-in at `ipcMain.handle` call sites; bridge rejects non-allowlisted channels
- `electron-rebuild@3.2.9` as explicit devDependency
- `npm audit --audit-level=high` step in CI lint job
- `XTERM_THEMES` constant with dark/light palettes; MutationObserver in `TerminalInstance` for live terminal re-theming
- `(extension_id, key)` composite primary key on `settings` tables in notepad and task-vault extensions (with backfill migration)
- `diagram_tags` relational join table replacing `diagrams.tags` JSON column; migration backfills existing tags and drops the column
- `assertTableAllowed` guard in `migrate.ts` to prevent SQL injection via table names; column and table names now quoted
- Per-row `logger.warn` and summary `logger.info` in `migrate.ts` legacy migration
- `scheduleWeeklyReviewNudge` interval guard in task-vault (prevents double-scheduling)
- `_spCount = 0` reset in `closeAppDb()` so savepoint counter restarts after re-init
- ADR-020: MCP stdio sidecar removal
- Electron 34.5.8 (upgraded from 30.4.0); `node-pty@1.2.0-beta.13` migrated from NAN to NAPI, resolving C++20 blocker — ADR-021 resolved

### Fixed

- Removed `npm rebuild better-sqlite3 --silent` from `.husky/pre-commit` (pre-commit hook is now fast)
- Removed `*:focus { outline: none }` rule — keyboard focus rings are now visible (WCAG 2.1 AA)
- `ConfirmDialog` missing `aria-labelledby` / `id` on title (screen reader accessibility)
- `ErrorBoundary` hardcoded hex colours replaced with CSS variables (`var(--bg-base)`, `var(--danger)`)
- `ipcInvokeRegistry` map value type updated from bare handler to `IpcRegistryEntry { handler, remoteAccessible }`

## [0.1.64] — 2026-05-31

### Changed

- Refactored notes and tasks to use shared PGlite database (`ExtensionDB`) instead of per-extension SQLite files
- `wrapDb` utility for PGlite with SQLite-compatible `?`-placeholder API
- Incremental DDL migration functions for notepad and task-vault schemas
