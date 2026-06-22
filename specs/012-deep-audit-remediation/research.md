# Research: Deep Audit Remediation

**Phase 0 output for** `specs/012-deep-audit-remediation/plan.md`  
**Date**: 2026-06-21

---

## Decision 1 — IPC Remote-Access Allowlist Mechanism

**Decision**: Opt-in `{ remoteAccessible: true }` options object passed as a third argument to the patched `ipcMain.handle` call. The monkey-patch in `src/main/index.ts` stores a `{ handler, remoteAccessible: boolean }` tuple in `ipcInvokeRegistry` instead of the bare handler. The bridge dispatcher in `extensions/remote-control/src/server/routes/bridge.route.ts` reads the flag before executing.

**Rationale**: The existing `ipcInvokeRegistry` is a `Map<string, IpcHandler>`. Changing the value type to `Map<string, { handler: IpcHandler; remoteAccessible: boolean }>` is a single-file schema change with minimal blast radius. All call sites that don't pass the third arg get `remoteAccessible: false` by default — this makes the patch additive and backwards-compatible. The bridge route already receives `invokeChannel` as a dependency-injected function, making it straightforward to add the allowlist check at the call site in `bridge.route.ts` line 77.

**Alternatives considered**:

- Hardcoded array in bridge dispatcher — simpler but requires a second source of truth alongside handler registration. Two places to update for every new channel.
- Separate `registerRemoteChannel(channel)` function — introduces a second registration ceremony with no benefit over the options approach.

**Affected files**:

- `src/main/remote/ipc-registry.ts` — new type `IpcRegistryEntry = { handler: IpcHandler; remoteAccessible: boolean }`
- `src/main/index.ts` — monkey-patch updated to accept optional options arg; stores `remoteAccessible` flag
- `extensions/remote-control/src/server/routes/bridge.route.ts` — check `remoteAccessible` before `invokeChannel` dispatch; return `type: 'error'` for disallowed channels
- IPC handler files that legitimately serve remote clients — add `{ remoteAccessible: true }` (audit required during implementation)

---

## Decision 2 — Settings Table Namespace Isolation

**Decision**: Add `extension_id TEXT NOT NULL` column, change `PRIMARY KEY` from `(key)` to `(extension_id, key)`. A schema migration backfills `extension_id` by parsing the key string prefix (`'terminator.task-vault.*'` → `'task-vault'`). Rows with unresolvable prefixes are logged at `warn` level.

**Rationale**: The composite key is enforced at the DB level — no runtime convention needed. The prefix-based backfill is deterministic for the existing data (both extensions use namespaced keys). Existing `ExtensionDB` settings API call sites pass `extension_id` as a new required argument, surfacing any future forgetting as a type error.

**Affected files**:

- `extensions/notepad/src/db/db.ts` — schema + migration + API
- `extensions/task-vault/src/vault/db.ts` — schema + migration + API
- All call sites of settings read/write in both extensions

---

## Decision 3 — Electron Upgrade Target

**Decision**: Attempt upgrade to latest stable Electron at implementation time. Verify `node-pty` and `@electric-sql/pglite` compatibility. Fall back to 32.x if breaking changes cannot be resolved.

**Rationale**: Latest stable maximizes security patch coverage. The primary compatibility risk is `node-pty`, which publishes pre-built binaries for each Electron/Node.js ABI version. `@electric-sql/pglite` is WASM-based and has no native compilation step, making it Electron-version-agnostic.

**Verification steps**:

1. Check `node-pty` releases for the target Electron's Node.js ABI version.
2. Run `npm run rebuild` after upgrade.
3. Run full test suite + manual PTY smoke test.

---

## Decision 4 — xterm.js Light Theme Integration

**Decision**: Add a `XTERM_THEMES` constant map (`{ dark: ITheme, light: ITheme }`) in `TerminalSession.tsx`. At construction, read the current resolved theme from `document.documentElement.dataset.theme`. Subscribe to `MutationObserver` on `data-theme` attribute changes and call `this.terminal.options.theme = XTERM_THEMES[newTheme]` reactively.

**Rationale**: xterm.js v5 supports live theme updates via `terminal.options.theme`. `MutationObserver` on `document.documentElement` is the standard pattern for reacting to `data-theme` attribute changes without coupling to the Zustand settings store. This approach is self-contained within `TerminalSession` and does not require new IPC or store subscriptions.

**Light theme ANSI color palette**: A Solarized-Light-inspired palette is the industry standard for readable terminals on light backgrounds. Implementation should use: background `#fdf6e3`, foreground `#657b83`, with standard 16-color ANSI values tuned for legibility on light.

**Affected files**:

- `src/renderer/components/terminal/TerminalSession.tsx` — XTERM_THEMES constant, MutationObserver subscription in constructor, cleanup in dispose()

---

## Decision 5 — Coverage Exclusion Strategy

**Decision**: Remove broad glob exclusions from `vitest.config.ts` for files that can be unit-tested. Retain `/* v8 ignore next */` comments on genuinely untestable lines (Electron entry point side effects, WASM init). Write tests for `loader.ts` (currently 16.67% function coverage) as the first concrete step.

**`loader.ts` location**: `src/renderer/extensions/loader.ts` — uses `import.meta.glob` and `window.electronAPI`. Tests should mock both using vitest's `vi.importMeta` and `jsdom` + `electronAPI` mock patterns already established in the test suite.

**Affected files**:

- `vitest.config.ts` — remove overly-broad globs; retain specific entry-point exclusions
- New: `src/renderer/extensions/loader.spec.ts`

---

## Decision 6 — diagrams.tags Normalization Schema

**Decision**: Add `diagram_tags` join table mirroring `note_tags`: `(diagram_id TEXT REFERENCES diagrams(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (diagram_id, tag))`. Migrate existing JSON blobs during `applyNotepadMigrations`. All diagram tag queries use relational joins instead of JSON parsing.

**Rationale**: Consistent data model across notes and diagrams enables shared tag management (rename, delete, filter) without dual code paths. The migration from JSON blob to join table is a one-time operation in the existing migration flow.

**Affected files**:

- `extensions/notepad/src/db/db.ts` — schema + migration
- `extensions/notepad/src/ipc/diagrams.ipc.ts` — update all tag read/write operations

---

## Decision 7 — healthCheck IPC Channel

**Decision**: Register a new `db:health` IPC channel in `src/main/db/index.ts` (or the appropriate IPC handler file). The channel calls `healthCheck()` and returns `{ ok: boolean; message?: string }`. Wire into the Settings → About panel.

**Channel name**: `db:health` — consistent with existing naming convention (`app:get-info`, `shell:exec`).

**Documentation impact**: New channel must be added to `specs/001-extension-first-terminal/contracts/ipc-channels.md` and `src/renderer/electron.d.ts` per Constitution Principle VIII.

---

## Decision 8 — Release Workflow

**Decision**: `.github/workflows/release.yml` triggers on `v*` tags, runs on `macos-14`, runs `npm run package`, uploads the `.dmg` as a GitHub Release asset using `gh release create`.

**Steps**: checkout → setup-node → npm ci → npm run rebuild → npm run package → gh release create with artifact upload.

---

## Decision 9 — ADR-020: MCP Sidecar Removal

**Decision**: Create `docs/adr/020-mcp-sidecar-removal.md` documenting: the MCP stdio sidecar was removed because the remote-control extension's WebSocket bridge provides equivalent IPC forwarding to browser clients; the sidecar added maintenance cost with no unique capability. ADR-013 is superseded by both ADR-015 and ADR-020.

---

## NEEDS CLARIFICATION — Resolved

All NEEDS CLARIFICATION items resolved in `/speckit-clarify` sessions. No open unknowns.
