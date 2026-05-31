# Codebase Audit — Improvement Suggestions

**Branch:** `bug-fixes` | **Commit:** `3c3990600a9ac5000378fcb6cc447b4985581ca2` | **Date:** 2026-05-30 | **Constitution:** v1.4.0

25 findings across 10 categories. Each entry includes an ID, what to change, why (constitution principle or spec), and complexity (S = hours, M = half-day, L = multi-day).

---

## Phase 1 — Quick Wins (S-complexity, high-value, low-risk)

These can be done in any order and should be completed first. Each takes < 2 hours.

---

### S-DC-01 — `run-engine.ts` exported functions are dead code

`extensions/foundry/src/core/run-engine.ts` exports `createSpecToCodeRun`, `gateDecide`, and `abortRun`. Zero references to these functions exist anywhere in the extension. The actual run lifecycle is implemented inline in `index.ts`. The module exists as a parallel, unused implementation.

**Why:** Constitution § X — dead code is a defect.

**Fix:** Either wire `run-engine.ts` into `index.ts` as the canonical implementation (resolving M-OE-01), or delete `run-engine.ts` and its spec file entirely. Do not leave both alive.

**Acceptance criteria:**

- No exported symbol from `run-engine.ts` is unreachable.
- `npm run lint` passes with 0 errors.

---

### S-DC-02 — `@xyflow/react` and `diff` are declared but never imported

`extensions/foundry/package.json` lists `"@xyflow/react": "12.3.6"` and `"diff": "5.2.0"` as runtime dependencies. No file under `extensions/foundry/src/` imports from either package. The interactive DAG editor was never implemented; `DiffViewer.tsx` renders diff text received from the main process without using the `diff` npm package.

**Why:** Constitution § IV — unused runtime dependencies increase bundle size and attack surface.

**Fix:** Remove both packages from `extensions/foundry/package.json`.

**Acceptance criteria:**

- `npm run build:extensions` completes without error.
- No remaining imports from `@xyflow/react` or `diff` in foundry source.

---

### S-DC-03 — Unreachable `return` in `executeOrchestrate`

`extensions/foundry/src/index.ts` contains two consecutive `return` statements in the manual-DAG branch of `executeOrchestrate`. The second is unreachable.

**Why:** Constitution § X — dead code is a defect; also may mask a logic error.

**Fix:** Remove the duplicate `return` statement.

**Acceptance criteria:**

- `npm run lint` passes with 0 errors.

---

### S-DEP-01 — `highlight.js` version is unpinned in two extensions

Both `extensions/foundry/package.json` and `extensions/git-integration/package.json` declare `"highlight.js": "^11.11.1"`. The caret allows any 11.x patch to silently install.

**Why:** Constitution § IV — all dependency versions must be pinned exactly.

**Fix:** Change both to `"11.11.1"` (no caret or tilde).

**Acceptance criteria:**

- Both `package.json` files use an exact version string.
- `npm run build:extensions` succeeds.

---

### S-DEP-02 — Same as S-DC-02

See S-DC-02 above. S-DEP-02 is the dependency hygiene framing of the same `@xyflow/react` / `diff` finding.

---

### S-IPC-02 — `menu:close-tab` is sent but has no listener

`src/main/index.ts` `setupMenu()` sends `menu:close-tab` via `mainWindow.webContents.send` when the user selects Close Tab from the Window menu. No listener for this channel exists in `src/renderer/` or any extension. The channel is also absent from `preload.ts`.

**Why:** Constitution VIII (IPC channels must be documented) + dead behavior.

**Fix:** Either add a listener in `App.tsx` that closes the active tab and document the channel, or remove the menu item from `setupMenu()`.

**Acceptance criteria:**

- The channel has either a functional listener and contract entry, or is removed from the menu entirely.

---

### S-OE-02 — `builtinCommands` `useCallback` suppresses its own ESLint rule

`src/renderer/App.tsx` contains `// eslint-disable-next-line react-hooks/exhaustive-deps` on a `useCallback` whose dependency array is intentionally incomplete. The `builtinCommands` function is only called once per render to build `paletteCommands` and does not need to be memoized.

**Why:** Constitution § X — lint suppressions are a smell; the underlying hook usage is incorrect.

**Fix:** Convert `builtinCommands` from `useCallback` to a plain function computed inside the component body. Remove the `eslint-disable` comment.

**Acceptance criteria:**

- No `eslint-disable` comment on this line.
- `npm run lint` passes with 0 errors.

---

### S-SM-02 — `updateCommand` / `updateGlobalTab` are on the store but not in `ExtensionRendererAPI`

`src/renderer/extensions/registry.ts` defines `updateCommand` and `updateGlobalTab` on the Zustand store but they are not included in the `ExtensionRendererAPI` Pick type. Extension renderers cannot call them without an unsafe cast.

**Why:** Type safety and API clarity (Constitution § III).

**Fix:** Either add both to the `ExtensionRendererAPI` Pick type (if they are part of the intended extension API), or document them as internal-only with a comment.

**Acceptance criteria:**

- No extension code uses `(registry as any).updateCommand(...)` or similar.
- The type accurately reflects the intended API surface.

---

### S-CONST-04 — Foundry `CLAUDE.md` says Tabler Icons; the codebase uses Lucide

`extensions/foundry/src/components/DiffViewer.tsx` imports from `lucide-react`. The foundry `CLAUDE.md` says "Icons: Tabler Icons only." No Tabler Icons import exists anywhere in the codebase — Lucide is the project-wide library.

**Why:** Misleading project instructions lead to incorrect behavior in future sessions.

**Fix:** Update foundry `CLAUDE.md` icon rule to: "Lucide icons only, flat, inheriting text color. No color CSS or inline style on icons." This matches the project-wide `feedback_flat_icons` memory and Constitution § X.

**Acceptance criteria:**

- Foundry `CLAUDE.md` no longer references Tabler Icons.

---

### S-CONST-05 — `App.tsx` calls `useExtensionRegistry.getState()` inside render

`src/renderer/App.tsx` calls `useExtensionRegistry.getState()` inside a `useCallback` and inside command `action` closures. Calling `.getState()` inside render bypasses React's subscription model — the returned value is not reactive.

**Why:** Constitution § III (correctness), React hook rules.

**Fix:** Replace `.getState()` calls inside callbacks with a captured selector value from a component-level `useExtensionRegistry(selector)` call, or expose a dedicated store action.

**Acceptance criteria:**

- No `.getState()` call inside a `useCallback`, `useEffect`, or command `action` definition.
- The toggle-overview path is covered by an existing or new test.

---

### S-DOC-02 — `ARCHITECTURE.md` documents 3 of 8 Zustand stores

`docs/ARCHITECTURE.md` State Management table lists only `workspace.store.ts`, `session.store.ts`, and `settings.store.ts`. The renderer also has `notification.store.ts`, `toast.store.ts`, `log.store.ts`, `metrics.store.ts`, and the extension `registry.ts` (also Zustand).

**Why:** Constitution § VIII — architecture docs must be accurate.

**Fix:** Add a row to the State Management table for each missing store, describing its purpose and who owns it.

**Acceptance criteria:**

- All 8 stores are listed in `ARCHITECTURE.md`.

---

### S-DOC-03 — `ipc-channels.md` misattributes `shell:open-path` to git-integration

`specs/001-extension-first-terminal/contracts/ipc-channels.md` places `shell:open-path` under "Extension-contributed channels (git-integration)". It is registered in `src/main/ipc/shell.ipc.ts` — a core file. `shell:open-external` is in the same core file but entirely undocumented.

**Why:** Constitution § VIII — IPC channel contracts must be accurate.

**Fix:**

- Move `shell:open-path` to the core channels section.
- Add a full entry for `shell:open-external`.

**Acceptance criteria:**

- Both channels are in the correct section with direction, request shape, and response shape.

---

### S-ARCH-02 — `speckit-pilot` has both `electron.ts` and `electron.d.ts`

`extensions/speckit-pilot/src/types/` contains both a declaration file and a regular module file for the same electron bridge types. One is likely stale.

**Why:** Constitution § X — dead code is a defect.

**Fix:** Determine which file is authoritative; delete the other.

**Acceptance criteria:**

- Only one electron type file exists under speckit-pilot.
- `npm run lint` and `npm run typecheck` pass.

---

### S-SM-01 — Bell events fire a native OS notification but leave no in-app trace

`src/renderer/hooks/useTerminalSession.ts` calls `window.electronAPI.notification.show(title, body)` on a bell event in a backgrounded session. There is no corresponding `addNotification` call to the in-app notification center. If system notifications are muted, the signal is lost entirely.

**Why:** Constitution § VII — user-facing signals must not be silently dropped.

**Fix:** When a bell event fires, also call `addNotification` from `useNotificationStore` so the in-app panel records it. Retain the native OS call as a supplemental signal.

**Acceptance criteria:**

- Bell events appear in the in-app notification panel regardless of OS notification settings.
- Behavior is documented under the notification model section of `ARCHITECTURE.md`.

---

### S-TEST-02 — `metrics.ipc.ts` parsing logic has no unit tests

`src/main/ipc/metrics.ipc.ts` contains platform-specific parsing logic for `/proc/net/dev` (Linux) and `netstat -ib` / `ps` output (macOS). These are pure string-parsing functions that can be tested with fixture strings without live system calls.

**Why:** Constitution § VI — 80% branch coverage is mandatory; parsing branches are not covered.

**Fix:** Add unit tests for `readNetBytes()` and `queryProcessMetrics()` using fixture strings for each platform path.

**Acceptance criteria:**

- ≥ 80% branch coverage on the parsing functions.
- Tests use fixture strings, not live `exec` calls.

---

## Phase 2 — Safe Refactors (M-complexity, clear benefit, moderate risk)

These are straightforward improvements that touch more files or require companion tests.

---

### M-DUP-01 — `RESERVED_SHORTCUTS` is duplicated in two core files

The identical 16-element `RESERVED_SHORTCUTS` Set is defined in both `src/main/preload.ts` (lines 3–20) and `src/main/extensions/api.ts` (lines 203–220). A divergence between the two would create a security hole where an extension could register a shortcut the preload does not guard against.

**Why:** Constitution § V (abstraction when two cases clearly benefit) + security correctness.

**Fix:** Extract to `src/shared/reserved-shortcuts.ts`. Both files import from this shared location.

**Acceptance criteria:**

- Single definition in `src/shared/reserved-shortcuts.ts`.
- Both consuming files import from it.
- `npm run lint` and `npx vitest run --coverage` both pass.

---

### M-DUP-02 — Sensor run-then-track-then-gate-block is triplicated in `foundry/src/index.ts`

The sensor execution + tracking + gate-block check block appears three times inside `index.ts` (in the spec-to-code path, manual-DAG path, and AI-plan path of `executeOrchestrate`). The shape is identical; only the surrounding context differs.

**Why:** Constitution § V — abstraction is required when two or more concrete cases demonstrably benefit.

**Fix:** Extract a `runAndTrackSensors(run, harness, runRoot, workspaceRoot)` helper, call it from all three sites.

**Acceptance criteria:**

- Helper is unit-tested.
- All three original callers produce identical behavior.
- `npm run lint` passes.

---

### M-DUP-03 — `appendHistoryEntry` call object is duplicated five times

The `appendHistoryEntry(workspaceRoot, { ... })` call with a ~20-field object literal appears verbatim in five handlers (auto-approve, gate-reject, gate-approve, abort, dismiss). The `sensorSummary` ternary and token-count inline computations are repeated verbatim each time.

**Why:** Constitution § V — abstraction is required when two or more concrete cases demonstrably benefit.

**Fix:** Extract a `buildHistoryEntry(run, status, gateDecisions, tokenCountIn, tokenCountOut)` helper. All five call sites use it.

**Acceptance criteria:**

- Helper is unit-tested.
- `npm run lint` passes.

---

### M-IPC-01 — Seven core IPC channels are undocumented in `ipc-channels.md`

The following channels are registered in core IPC files but have no contract entry:

| Channel               | File                  |
| --------------------- | --------------------- |
| `workspace:reorder`   | `workspace.ipc.ts`    |
| `project:reorder`     | `workspace.ipc.ts`    |
| `project:rename`      | `workspace.ipc.ts`    |
| `fs:read-file`        | `fs.ipc.ts`           |
| `shell:open-external` | `shell.ipc.ts`        |
| `notification:show`   | `notification.ipc.ts` |

Additionally: `notification:show` (singular, OS notification) vs `notifications:*` (plural, in-app center) is never explained in the contracts. A reader cannot distinguish the two systems.

**Why:** Constitution § VIII — all IPC channels must be documented in `ipc-channels.md` and `electron.d.ts`.

**Fix:** Add a full entry for each undocumented channel. Add a callout box explaining the singular vs plural naming distinction.

**Acceptance criteria:**

- All six channels have contract entries.
- The `notification` vs `notifications` distinction is documented.

---

### M-IPC-03 — `foundry:*` channels are undocumented

The Foundry extension registers 30+ `foundry:*` IPC channels. The spec (`specs/007-foundry-agent-harness/plan.md`) called for a `specs/007-foundry-agent-harness/contracts/ipc-channels.md` file — this file does not exist.

**Why:** Constitution § VIII.

**Fix:** Create `specs/007-foundry-agent-harness/contracts/ipc-channels.md` documenting all `foundry:*` channels currently registered in `extensions/foundry/src/index.ts`, following the same format as `specs/001-extension-first-terminal/contracts/ipc-channels.md`.

**Acceptance criteria:**

- File exists and covers all registered `foundry:*` handlers.

---

### M-DOC-01 — Foundry is absent from `README.md` and `ARCHITECTURE.md`

`README.md` lists three extensions in its directory tree but not `extensions/foundry/`. The features list does not mention Foundry. `docs/ARCHITECTURE.md` has no Foundry section.

**Why:** Constitution § VIII — docs ship in the same PR as implementation. This is outstanding debt.

**Fix:**

- Add Foundry to `README.md` directory tree and features list (run modes, providers, harness concept).
- Add a "Foundry Agent Harness" section to `ARCHITECTURE.md` following the same structure as the Task Vault section.

**Acceptance criteria:**

- `README.md` and `ARCHITECTURE.md` accurately describe the Foundry extension.

---

### M-CONST-01 — Dialog error handling does not surface IPC failures as toasts

Several dialogs set local `setError` state on IPC failure:

- `src/renderer/components/sidebar/CreateProjectDialog.tsx`
- `src/renderer/components/sidebar/EditWorkspaceDialog.tsx`
- `src/renderer/components/sidebar/CreateWorkspaceDialog.tsx`

If the dialog is dismissed before the user sees the inline message, the error is silently lost.

**Why:** Constitution § VII — user-facing errors must surface as toasts via `useToastStore`.

**Fix:** IPC failure paths in `handleSubmit` functions fire `addToast({ type: 'error', message: '...' })` in addition to (not instead of) the inline `setError` for non-validation errors. Validation errors (empty name, duplicate name) remain inline only.

**Acceptance criteria:**

- `useToastStore` is imported in all three dialog components.
- IPC failure fires a toast.
- Validation errors do not fire a toast (they are field-level feedback).

---

### M-CONST-02 — `.then()` without `.catch()` in multiple components

Several `useEffect` bodies use `.then()` without a `.catch()` handler on `window.electronAPI.*` calls:

- `src/renderer/components/sidebar/CreateProjectDialog.tsx` — 4 IPC calls
- `src/renderer/components/settings/SettingsPanel.tsx`
- `src/renderer/components/sidebar/WorkspaceItem.tsx`
- `src/renderer/components/overview/OverviewScreen.tsx`

If any of these reject (e.g., app is shutting down), the rejection is unhandled.

**Why:** Constitution § VII — all async IPC calls must be wrapped in try/catch or have `.catch()` handlers.

**Fix:** Add `.catch(err => logger.error(...))` to all bare `.then()` chains. For errors that affect visible state, also fire a toast.

**Acceptance criteria:**

- No unhandled promise rejection possible from these call sites.
- `npm run lint` passes.

---

### M-TEST-01 — Actual run lifecycle in `foundry/src/index.ts` has 0% measured coverage

`run-engine.spec.ts` tests the functions in `run-engine.ts` — but those functions are never called in production (S-DC-01). The actual `executeRun` / `executeOrchestrate` functions in `index.ts` are excluded from coverage by `vitest.config.ts`. Real run lifecycle logic is untested.

**Why:** Constitution § VI — 80% minimum coverage; 0% on critical business logic is a hard violation.

**Fix:** This is resolved as part of M-OE-01 (the God file split). After the refactor, the extracted modules must have ≥ 80% unit test coverage. The `vitest.config.ts` exclusion of `extensions/*/src/index.ts` is appropriate only if `index.ts` is a thin registration shim after the refactor.

**Acceptance criteria:**

- After M-OE-01, all run lifecycle functions are in a non-excluded module with ≥ 80% coverage.
- `npx vitest run --coverage` passes all thresholds.

---

### M-CONST-03 — Foundry IPC handlers use unsafe `payload as { ... }` casts instead of Zod

Throughout `extensions/foundry/src/index.ts`, handler payloads are cast:

```typescript
const { workspaceRoot } = payload as { workspaceRoot: string }
if (!workspaceRoot) return { error: 'workspaceRoot required' }
```

A caller sending `{ workspaceRoot: 123 }` passes the falsy check and causes a runtime error downstream.

**Why:** `docs/ARCHITECTURE.md` states: "Every IPC payload is validated with Zod at both ends before use; malformed payloads return `{ error: 'VALIDATION_ERROR' }`." Constitution § VII.

**Fix:** Define Zod schemas for each logical payload group (many handlers share the same shape). Each handler uses `safeParse` and returns `{ error: 'VALIDATION_ERROR', message: ... }` on failure.

**Acceptance criteria:**

- No `payload as { ... }` cast in Foundry handler code.
- All handlers return `{ error: 'VALIDATION_ERROR', message }` on schema failure.
- Existing Foundry tests pass after migration.

---

### M-TEST-03 — Foundry component specs are missing or unconfirmed

The Foundry plan specified component specs for `NewRunWizard`, `GatePanel`, and `DagGraph`. `GatePanel.tsx` was not found as a standalone component (its functionality appears absorbed into `OrchestrationView.tsx`). Coverage for foundry UI components is unverified.

**Why:** Constitution § VI — 80% minimum coverage.

**Fix:** Run `npx vitest run --coverage` and identify any foundry source file at < 80% that is not in the vitest exclusion list. Add companion specs for those files.

**Acceptance criteria:**

- All foundry source files not in the vitest exclusion list are at ≥ 80% coverage.

---

## Phase 3 — Structural Refactors (L-complexity, high-impact, higher risk)

These require careful planning and must be paired with test additions before any code moves.

---

### M-OE-01 — `extensions/foundry/src/index.ts` is a 2,215-line God file

The entire Foundry main-process surface — run lifecycle (`executeRun`, `executeOrchestrate`, `planOrchestration`), sensor execution, co-pilot streaming, session persistence, history management, and all 30+ IPC handler registrations — lives in a single 2,215-line file. The `core/` subdirectory exists with separate modules (`run-engine.ts`, `sensors.ts`, `history.ts`) but the execution logic was never migrated to them.

**Why:** Constitution § V (Single Responsibility), § X (dead code is a defect — the `core/` modules are present but unused).

**Fix:**

1. Move `executeRun`, `executeOrchestrate`, `planOrchestration`, `buildWorktreeListing`, `buildAgentPrompt` to `core/run-engine.ts`.
2. Move `appendHistoryEntry`, `buildHistoryEntry` (from M-DUP-03) to `core/history.ts`.
3. Move sensor helpers to `core/sensors.ts` (may already be there — verify).
4. `index.ts` retains only `activate()`, the `reg()` helper, the `broadcast()` helper, and IPC handler registrations that are thin delegation calls.

**Risks:**

- `activeRuns`, `runLogs`, and `broadcast` are module-level state. They must be passed as parameters or extracted to a shared context object to avoid circular imports.
- The `vitest.config.ts` exclusion of `extensions/*/src/index.ts` must remain valid — `index.ts` must be thin enough after the refactor that excluding it is correct.

**Acceptance criteria:**

- `index.ts` is ≤ 300 lines after the refactor.
- All extracted modules have ≥ 80% unit test coverage.
- `npm run lint` passes; `npx vitest run --coverage` passes all thresholds.
- `npm run build:extensions` succeeds.

---

### M-ARCH-01 — ADR needed for extension-to-core type import

`extensions/foundry/src/index.ts` line 1:

```typescript
import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
```

Constitution § II states extensions must not import from `src/main/*`. This import is a known architectural compromise (documented in foundry's own `CLAUDE.md`), but no ADR records the decision or its resolution path.

**Why:** Constitution § IX — architectural decisions must be recorded. The compromise is accepted, but must be documented so future contributors understand the constraint.

**Fix:** Create `docs/adr/001-extension-api-type-import.md` documenting the compromise, the constraint that motivates it (electron-vite co-compilation, no separate package publish), and the future resolution path (publish `@terminator/extension-api` as an npm workspace package).

**Acceptance criteria:**

- ADR file exists in `docs/adr/`.
- The import in `index.ts` has a single-line comment citing the ADR number.

---

## Prioritized Execution Order

| Priority | ID                 | Effort   | Description                                                       |
| -------- | ------------------ | -------- | ----------------------------------------------------------------- |
| 1        | S-CONST-04         | 5 min    | Fix foundry `CLAUDE.md` icon rule                                 |
| 2        | S-DC-03            | 5 min    | Remove unreachable `return`                                       |
| 3        | S-OE-02            | 15 min   | Remove `builtinCommands` `useCallback` + lint suppression         |
| 4        | S-DEP-01           | 10 min   | Pin `highlight.js` to exact version                               |
| 5        | S-DC-02 / S-DEP-02 | 15 min   | Remove `@xyflow/react` and `diff` from foundry                    |
| 6        | S-SM-02            | 20 min   | Fix `ExtensionRendererAPI` Pick type                              |
| 7        | S-ARCH-02          | 20 min   | Clean up speckit-pilot dual electron type files                   |
| 8        | S-CONST-05         | 30 min   | Fix `.getState()` inside render in `App.tsx`                      |
| 9        | S-DOC-03           | 30 min   | Fix `shell:open-path` misattribution in contracts                 |
| 10       | S-DOC-02           | 30 min   | Add missing stores to `ARCHITECTURE.md`                           |
| 11       | S-IPC-02           | 45 min   | Fix or remove `menu:close-tab` (add listener or remove from menu) |
| 12       | S-SM-01            | 45 min   | Add in-app trace for bell-event OS notifications                  |
| 13       | S-TEST-02          | 1 hr     | Add unit tests for `metrics.ipc.ts` parsing logic                 |
| 14       | M-DUP-01           | 1 hr     | Extract `RESERVED_SHORTCUTS` to shared module                     |
| 15       | M-DOC-01           | 1 hr     | Add Foundry to `README.md` and `ARCHITECTURE.md`                  |
| 16       | M-IPC-01           | 1.5 hr   | Document 7 undocumented core IPC channels                         |
| 17       | M-IPC-03           | 2 hr     | Create `foundry:*` IPC channel contracts file                     |
| 18       | M-CONST-02         | 2 hr     | Add `.catch()` to all bare `.then()` chains                       |
| 19       | M-CONST-01         | 2 hr     | Add toasts to dialog IPC error paths                              |
| 20       | M-DUP-02           | 2 hr     | Extract sensor run-track-gate helper                              |
| 21       | M-DUP-03           | 2 hr     | Extract `buildHistoryEntry` helper                                |
| 22       | M-ARCH-01          | 30 min   | Write ADR for extension-to-core type import                       |
| 23       | M-TEST-03          | 3 hr     | Verify and fill Foundry component test coverage                   |
| 24       | M-CONST-03         | 1 day    | Add Zod validation to all Foundry IPC handlers                    |
| 25       | S-DC-01 + M-OE-01  | 2–3 days | Split `index.ts` God file + wire `run-engine.ts` into production  |

---

## Risk Notes

1. **M-OE-01 (God file split)** — `activeRuns`, `runLogs`, and `broadcast` are module-level state in `index.ts`. Moving execution logic out requires passing these as parameters or extracting to a context object. Test coverage must be added _before_ moving code.

2. **M-CONST-03 (Zod validation)** — Adding Zod to 30+ handlers risks breaking existing tests if schemas reject payloads the specs send. Migrate handlers incrementally; run `npx vitest run` after each.

3. **M-DUP-01 (RESERVED_SHORTCUTS)** — A mismatch between the preload guard and the extension API throw is a security gap. The shared constant must be imported identically in both files — not re-exported through different paths.

4. **S-IPC-02 (`menu:close-tab`)** — If a listener is added, it must close only the active tab for the current project. `session.store.ts` `closeSession` triggers auto-delete if the last session is closed; verify this is the intended behavior before wiring it up.

5. **Coverage gate** — `npx vitest run --coverage` must pass all 80% thresholds before any session is reported done. The M-OE-01 refactor must be paired with test additions or it will block CI on the newly-covered modules.
