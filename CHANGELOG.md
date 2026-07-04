# Changelog

All notable changes to Terminator are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- Light mode CSS token overrides (`[data-theme="light"]` block in `styles.css`)
- `db:health` IPC channel returning `{ ok, message? }` — wired into About dialog
- Spacing token scale (`--space-1` through `--space-12`) in CSS `:root`
- IPC remote-access allowlist centralised in `src/main/remote/remote-accessible-channels.ts` — a single auditable set that is the entire remote attack surface. The bridge is default-deny across `invoke`, `send`, and `subscribe`; `remote-accessible-channels.spec.ts` asserts the set stays in sync with the channels the `/app/` shim uses, so enforcement and allowlist can never half-ship independently
- Per-IP failed-auth rate limiting on the remote-control server (`auth-rate-limiter.ts`): 10 failures / 15 min → `429` lockout
- End-to-end Playwright test (`tests/e2e/remote-app.spec.ts`) that launches the app in an isolated profile, enables remote control, loads `/app/` in a real browser, and asserts the IPC bridge serves a workspace — wired into CI as a new `e2e` job (macos-14). Guards the `/app/` regression class
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
- Remote-control bridge `send` and `subscribe` paths are now allowlist-gated (previously only `invoke` was), closing an event-eavesdropping / fire-and-forget gap on the `0.0.0.0`-bound server
- ADR-017 rewritten to make `0.0.0.0` the explicit decision with a documented threat model and accepted-risk statement (was self-contradictory: body said "MUST bind 127.0.0.1" while an amendment said the opposite)

### Fixed

- Removed `npm rebuild better-sqlite3 --silent` from `.husky/pre-commit` (pre-commit hook is now fast)
- Removed `*:focus { outline: none }` rule — keyboard focus rings are now visible (WCAG 2.1 AA)
- `ConfirmDialog` missing `aria-labelledby` / `id` on title (screen reader accessibility)
- **Pop-out during PR review lost the active PR (TAV-6).** `api.window.openAuxiliary` keyed its reusable auxiliary windows only by view name, so popping out again while an auxiliary window for that view was already open just refocused it without forwarding the new params — the popped-out window kept whatever it was last showing (usually the PR queue) instead of the PR actually being reviewed. It now re-navigates the existing window whenever the caller hands through specific params (e.g. `prNumber`), while a bare re-open with no params (the plain "Code Reviews in New Window" menu item) still just refocuses the window as-is
- **Browser `/app/` full-renderer remote access restored.** The bridge default-deny enforcement had shipped with no channels allowlisted, so every IPC `invoke` from the `/app/` shim was rejected — the documented desktop/tablet remote feature was non-functional. All 59 channels the shim uses (invoke + send + subscribe) are now allowlisted; a guard test prevents recurrence
- **PR search race condition (TAV-7).** `useLoadPrQueue` had no way to discard a stale response, so if an earlier, slower search request (e.g. a broad text search issued mid-paste) resolved after a later, faster one (e.g. the exact PR-number lookup), the stale result silently overwrote the correct one — pasting a PR number like `049` could surface unrelated PRs until the user deleted and retyped a character. Added a monotonic per-hook request id: any response whose id no longer matches the latest issued request is now discarded instead of being applied to the store. Covers search, manual refresh, the closed-PRs toggle, and pagination, since they all funnel through the same hook
- `ErrorBoundary` now uses theme tokens for **every** fallback colour (message text → `var(--text-secondary)`, recovery button → `var(--danger)` with `color-mix` tints) — the message text and button previously kept hardcoded hex that rendered as dark-theme colours under `[data-theme="light"]`
- `ipcInvokeRegistry` map value type updated from bare handler to `IpcRegistryEntry { handler, remoteAccessible }`; `remoteAccessible` now defaults from the central allowlist
- **Low-contrast code/diff windows (TAV-8).** The git-integration extension unconditionally bundled `highlight.js`'s `atom-one-dark` syntax theme, whose colors were tuned for its own dark background and failed WCAG AA under the app's light theme (most tokens ~1.5–2.8:1); the dark-theme comment color also failed (3.23:1) against the app's actual `--bg-base`. Replaced it with a first-party, theme-aware syntax palette (new `--tm-syntax-*` tokens) and consolidated three divergent hardcoded add/remove diff-background palettes (git sidebar, MergeFlow, PR review) into shared `--tm-diff-added-bg` / `--tm-diff-removed-bg` tokens. Also removed `opacity` multipliers on diff/conflict line text (gutter numbers, removed/context lines) that were silently halving effective contrast, and fixed hardcoded `rgba(255,255,255,...)` PR-review gutter colors that were invisible in light theme. All tokens verified ≥4.5:1 against both the plain code background and the diff-tinted backgrounds, in both themes (`tests/unit/renderer/diff-syntax-contrast.spec.ts`)

## [0.1.64] — 2026-05-31

### Changed

- Refactored notes and tasks to use shared PGlite database (`ExtensionDB`) instead of per-extension SQLite files
- `wrapDb` utility for PGlite with SQLite-compatible `?`-placeholder API
- Incremental DDL migration functions for notepad and task-vault schemas
