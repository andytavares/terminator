# Changelog

All notable changes to Terminator are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- Light mode CSS token overrides (`[data-theme="light"]` block in `styles.css`)
- `db:health` IPC channel returning `{ ok, message? }` — wired into About dialog
- Spacing token scale (`--space-1` through `--space-12`) in CSS `:root`
- IPC remote-access allowlist: `{ remoteAccessible: true }` opt-in at `ipcMain.handle` call sites; bridge rejects non-allowlisted channels
- `npm audit --audit-level=high` step in CI lint job
- `XTERM_THEMES` constant with dark/light palettes; MutationObserver in `TerminalInstance` for live terminal re-theming
- `(extension_id, key)` composite primary key on `settings` tables in notepad and task-vault extensions (with backfill migration)
- `diagram_tags` relational join table replacing `diagrams.tags` JSON column; migration backfills existing tags and drops the column
- `assertTableAllowed` guard in `migrate.ts` to prevent SQL injection via table names; column and table names now quoted
- Per-row `logger.warn` and summary `logger.info` in `migrate.ts` legacy migration
- `scheduleWeeklyReviewNudge` interval guard in task-vault (prevents double-scheduling)
- `_spCount = 0` reset in `closeAppDb()` so savepoint counter restarts after re-init
- ADR-020: MCP stdio sidecar removal

### Changed

- Electron 30.4.0 → 42.4.1; `node-pty@1.0.0` → `node-pty@1.2.0-beta.13` (NAN → NAPI migration). NAPI is ABI-stable, so `electron-rebuild` and the `npm run rebuild` script were removed — ADR-021 resolved
- Fastify 4 → 5 and `@fastify/websocket` 8 → 11 (websocket handlers now receive the socket directly instead of `connection.socket`)
- Vitest 2 → 4, Vite 5 → 7, electron-vite 2 → 5, electron-builder 24 → 26, Playwright 1.45 → 1.61; `vitest.config.ts` migrated from `environmentMatchGlobs` to `test.projects` (node/jsdom split) — the removed `vitest.workspace.ts` is superseded by it

### Security

- Resolved all high/critical `npm audit` findings (`npm audit --audit-level=high` now passes): Electron, Fastify/`fast-uri`, `ws`, Vitest, esbuild/Vite, `node-ical`, `diff`, and the `electron-rebuild`→`cacache`/`node-gyp`/`tar` chain
- Removed unused `@modelcontextprotocol/sdk` dependency from task-vault (dead since ADR-020), clearing 3 high advisories

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
