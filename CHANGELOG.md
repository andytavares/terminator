# Changelog

All notable changes to Terminator are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- `packages/extension-ui` — the single implementation of the shared extension UI behaviour, published to the bundled extensions, to third parties, and to the core (which now wraps its `ConfirmDialog`). Source-only, with `react`/`react-dom`/`lucide-react` as peer dependencies, so it adds no build step and no second React. Ships `Dialog`, `ConfirmDialog`, `Popover`, `ToastRegion`, `EmptyState`, `IconButton`, `useDismissible`, the focus trap, the per-document modal-depth registry and the layer scale — ADR-038, ADR-039
- A light theme for extension views. `EXTENSION_BASE_CSS` had one dark `:root` block and no `[data-theme='light']` at all, and nothing in main, the preload or any extension ever mentioned the theme — so switching the app to light left every extension panel dark while the core went light. The palette mirrors the core's AA-verified values; `ExtensionViewHost.setTheme` stamps `data-theme` on each extension document, restamps every open view on a change, and remembers the theme for views created later
- `extension.setTheme` on the API manifest (`extension:set-theme`), native-only
- `api.ui` on the Extension API (v1.3.0) — `api.ui.toast(message, { tone, duration })` raises a message in the extension's own view, and `api.ui.layers` publishes the four-step stacking scale
- `docs/EXTENSION-STYLE.md` — the written house rules for extension UI, with the vocabulary rules enforced as `no-restricted-syntax` selectors on `extensions/*/src/**/*.tsx` and a 19-case fixture spec at `tests/unit/lint/extension-vocabulary.spec.ts`
- `tests/e2e/extension-themes.spec.ts` — walks every visible text node in each extension view, in both themes, resolves the composited backdrop through the translucent layers above it, and asserts WCAG AA. Reading the stylesheet cannot answer this: `color-mix` and layered alpha only resolve in a browser
- Remote Control now answers what it is doing — on/starting/on-but-local-only/failed, the address, a QR code that carries the password, and a live list of connected devices with per-device disconnect
- `--tm-accent-text`, `--tm-accent-hover`, `--tm-on-success`, `--tm-on-warning`, `--tm-on-danger`, `--tm-overlay-*` and `--tm-scrim` tokens, all defined in both themes

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

- **Escape during a dialog closed the extension and discarded the draft.** The double-Escape exit gesture stood down for terminals and text fields but knew nothing about open modals, so typing in a dialog and pressing Escape twice exited the extension with no confirmation and no undo. Modal depth is now mirrored to the host over `electronAPI.ui.setModalDepth` — `contextIsolation: true` gives the page and its preload different `window` objects, so a counter the page sets is not readable by the preload, and the value has to cross the bridge. Reproduced in the real app before the fix and asserted after
- **The behaviour of a dialog depended on which extension you were in.** Four independent overlay implementations across the five extensions disagreed about what Escape does, whether the scrim closes, where focus goes and what happens with two open at once. One implementation now, with Escape answered by the innermost surface only
- **21 `--tm-*` names were referenced that were never published** — `--tm-text`, `--tm-bg-hover`, `--tm-surface` and 18 more, across 121 references. Each resolved to nothing, which makes the declaration invalid and the browser drops it: a hover with no hover, a colour with no colour. All renamed to real tokens
- **`--tm-accent` failed WCAG AA in the dark theme.** #5c6bc0 carries white at 4.86:1 but reads at only 3.48:1 as text on `--tm-bg-card`, and lightening it drops white below AA. Split into a fill and a text value
- **A hover that dimmed a filled button dimmed its label with it** — "New note" measured 4.18:1 at the exact moment of interaction. Ten `opacity` hovers across three extensions shift the surface instead
- **Black text on a success fill.** `color: #000` on `--tm-success` is black on bright green in the dark theme and black on deep green in the light one
- **38 unmanaged `z-index` values** ordered themselves by whoever picked the biggest number. They now come from a four-step named scale, and a raw number in an extension is a lint error
- **Five extension files imported core source directly**, against Constitution II. All five were also inert — they bundled a second copy of a store rather than sharing one
- **The PR queue row's label named an outcome the click does not produce.** The row is a single button whose `onClick` opens the diff; on a low-risk PR it read "Approve". It says "Review". Risk is stated in words rather than `HIGH`/`MED`, the six unlabelled signal dots are gone, and the summary reports the repository's real count instead of the page size
- **Three of the five PR filter chips named a section heading already in the list below**, so pressing one hid four fifths of the page to reach something reachable by scrolling. Chrome above the first row: 150px → 84px
- **`text-transform: capitalize` was re-casing correct labels**, turning "To review" back into "To Review"
- **File status showed git's porcelain codes** — `M`, `A`, `??` — where the reader needed words
- **The git panel offered four commit buttons of equal weight** and gave no reason when the primary was disabled. One primary now, alternates behind a caret, and it says what would enable it
- **SpecKit cards showed ten numbered circles and a `0/10` fraction**, so reading your own board required having memorised that phase 4 is Plan. A progress bar and a next-step line that distinguishes waiting on you from waiting on the machine
- 69 `text-transform: uppercase` rules and their 68 `letter-spacing` declarations removed; 15 caps display strings converted to sentence case
- Implementation vocabulary removed from user-facing strings — "saved to vault", "Artifacts", "Stalls", "Public URL (ngrok)", "LAN URL", "Link to vault item" and 9 more
- Unicode used as visual elements replaced with lucide icons in `CompletionScreen`, `ConflictHub` and `FullFileList`. Every one had been sized with `font-size`, which does nothing to an SVG — lucide would have fallen back to 24px inside a 10px status dot
- 613 `rgba()` and 295 hex literals in extension CSS replaced with tokens, property-aware; 415 dead `var(--tm-x, #fallback)` fallbacks collapsed; 45 dead CSS rules deleted

- **Sorting the sidebar did nothing, and a drag-reorder was thrown away.** `buildBranchRows` hard-sorted the repo groups alphabetically, so **Display → Sort** only ever reached the branches inside a repo — with one or two branches each, the whole control read as inert — and the repo order could not be changed by any means. Drag-to-reorder wrote through to `workspace:reorder` and to disk correctly, then the next render re-sorted the list alphabetically over the top of it, so the drag appeared to do nothing. **Manual** was a menu label with no implementation at all: `compareBranches` had no `manual` case and fell through to Recent, and the branch rows had no drag handler, leaving `reorderProjects` in the store, the IPC layer and the storage layer with no caller since its UI was deleted in 030. The sort key now orders the repo headers as well as the branches under them (a repo takes the most recent, oldest or most severe of its branches, with a name tie-break), `manual` is the order the stores hold, and both repo headers and branch rows are drag-reorderable — a drop switches the view to Manual, since any other sort would recompute over it. A repo with no branches is now part of that one ordered list instead of a block pinned below it, and a drag under a filter rewrites only the slots the visible rows occupy so a hidden repo keeps its place. Covered by `tests/e2e/sidebar-sorting.spec.ts`: the unit tests were green throughout, because they asserted the drop handler called the store rather than that the list changed
- **A branch whose folder is gone no longer opens a terminal that instantly dies.** `pty.spawn` accepts a `cwd` that does not exist: the child forks, cannot `chdir`, and exits with status 1 having printed nothing — so a worktree removed outside Terminator, or a repo folder deleted on disk, produced a tab that appeared and died with a blank screen and no reason given. `PtyManager.spawnSession` now refuses such a `cwd` up front (`MissingCwdError`), `terminal:create` reports it as `CWD_MISSING` with the folder's path, and the renderer raises it as an error notification — which the notification system always delivers as a toast, whatever the operator's per-key settings say. No tab is opened. Being the single spawn point, the guard covers `api.pty` too, and the remote server's `POST /api/terminals` now answers `400 CWD_MISSING` instead of handing back a session that was already dead
- Removed `npm rebuild better-sqlite3 --silent` from `.husky/pre-commit` (pre-commit hook is now fast)
- Removed `*:focus { outline: none }` rule — keyboard focus rings are now visible (WCAG 2.1 AA)
- `ConfirmDialog` missing `aria-labelledby` / `id` on title (screen reader accessibility)
- **Pop-out during PR review lost the active PR (TAV-6).** `api.window.openAuxiliary` keyed its reusable auxiliary windows only by view name, so popping out again while an auxiliary window for that view was already open just refocused it without forwarding the new params — the popped-out window kept whatever it was last showing (usually the PR queue) instead of the PR actually being reviewed. It now re-navigates the existing window whenever the caller hands through specific params (e.g. `prNumber`), while a bare re-open with no params (the plain "Code Reviews in New Window" menu item) still just refocuses the window as-is
- **Browser `/app/` full-renderer remote access restored.** The bridge default-deny enforcement had shipped with no channels allowlisted, so every IPC `invoke` from the `/app/` shim was rejected — the documented desktop/tablet remote feature was non-functional. All 59 channels the shim uses (invoke + send + subscribe) are now allowlisted; a guard test prevents recurrence
- **PR search race condition (TAV-7).** `useLoadPrQueue` had no way to discard a stale response, so if an earlier, slower search request (e.g. a broad text search issued mid-paste) resolved after a later, faster one (e.g. the exact PR-number lookup), the stale result silently overwrote the correct one — pasting a PR number like `049` could surface unrelated PRs until the user deleted and retyped a character. Added a monotonic per-hook request id: any response whose id no longer matches the latest issued request is now discarded instead of being applied to the store. Covers search, manual refresh, the closed-PRs toggle, and pagination, since they all funnel through the same hook
- `ErrorBoundary` now uses theme tokens for **every** fallback colour (message text → `var(--text-secondary)`, recovery button → `var(--danger)` with `color-mix` tints) — the message text and button previously kept hardcoded hex that rendered as dark-theme colours under `[data-theme="light"]`
- `ipcInvokeRegistry` map value type updated from bare handler to `IpcRegistryEntry { handler, remoteAccessible }`; `remoteAccessible` now defaults from the central allowlist
- **Low-contrast code/diff windows (TAV-8).** The git-integration extension unconditionally bundled `highlight.js`'s `atom-one-dark` syntax theme, whose colors were tuned for its own dark background and failed WCAG AA under the app's light theme (most tokens ~1.5–2.8:1); the dark-theme comment color also failed (3.23:1) against the app's actual `--bg-base`. Replaced it with a first-party, theme-aware syntax palette (new `--tm-syntax-*` tokens) and consolidated three divergent hardcoded add/remove diff-background palettes (git sidebar, MergeFlow, PR review) into shared `--tm-diff-added-bg` / `--tm-diff-removed-bg` tokens. Also removed `opacity` multipliers on diff/conflict line text (gutter numbers, removed/context lines) that were silently halving effective contrast, and fixed hardcoded `rgba(255,255,255,...)` PR-review gutter colors that were invisible in light theme. All tokens verified ≥4.5:1 against both the plain code background and the diff-tinted backgrounds, in both themes (`tests/unit/renderer/diff-syntax-contrast.spec.ts`)

### Removed

- `ExtensionToastContainer` in task-vault and its 12 CSS rules — superseded by `ToastRegion` in `packages/extension-ui`. The old container printed ℹ ✓ ⚠ ✕ as text and made the whole toast a click target with nothing on screen to say so; the shared toast offers a named action button instead
- "Load more pull requests" in the PR queue — pages arrive on their own, and the summary states the real total
- The four PR-queue stat tiles, two of which routinely read "0", replaced by one summary line

## [0.1.64] — 2026-05-31

### Changed

- Refactored notes and tasks to use shared PGlite database (`ExtensionDB`) instead of per-extension SQLite files
- `wrapDb` utility for PGlite with SQLite-compatible `?`-placeholder API
- Incremental DDL migration functions for notepad and task-vault schemas
