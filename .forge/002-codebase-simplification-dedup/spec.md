# Spec: Codebase Simplification — Deduplication & Cleanup

Remove copy-paste duplication, dead code, and ad-hoc workarounds across the renderer and main-process code. No new user-facing behavior. All changes are internal refactors.

## Issues to fix

### 1. `git-service.ts` — repeated env object

`{ ...process.env, GIT_TERMINAL_PROMPT: '0' }` inlined at three sites in `src/main/git/git-service.ts` (lines 17, 27, 48). Extract to a shared `GIT_ENV` constant.

### 2. `RESERVED_SHORTCUTS` defined in two files

Same 16-element Set declared in both `src/main/preload.ts:3-20` and `src/main/extensions/api.ts:203-221`. Move to `src/main/shared/reserved-shortcuts.ts` and import in both.

### 3. CWD resolution logic duplicated 5 times

The pattern `activeProject?.worktreePath ?? activeWorkspace?.folderPath ?? '~'` (with a projectsByWorkspaceId walk) copy-pasted at:

- `src/renderer/hooks/useKeyboardShortcuts.ts:153-158`, `:173-180`, `:191-198`
- `src/renderer/App.tsx:87-89`, `:219-222`
  Add `resolveActiveCwd()` selector to `useWorkspaceStore`.

### 4. Bell handler duplicated in `useTerminalSession.ts`

Same bell callback block at lines 28-48 (createSession) and 69-80 (splitSession). The splitSession copy also silently omits the active-session guard present in createSession — a latent bug. Extract `makeBellHandler`.

### 5. Dead DOM event listener in `App.tsx`

`window.addEventListener('open-settings', ...)` at `src/renderer/App.tsx:234-238` has no dispatch site in the codebase. The live path is `extensionEvents.onMenuOpenSettings` at `:241-243`. Delete the dead listener.

### 6. `metrics.store.ts` — two boolean flags for one state machine

`pollingActive` and `globalMetricsEnabled` interact ad-hoc: `stopPolling` calls `startPolling([])` internally. Fix: inline the system-only polling branch in `stopPolling` to eliminate the self-call. Keep public interface unchanged.

### 7. `session.store.ts` — `Map<string, unknown>` type

`terminalInstances` typed as `Map<string, unknown>` causes cast noise at `TerminalPane.tsx:47`, `LeafPane.tsx:20`, `SessionTile.tsx:45`. Change to `Map<string, TerminalInstance>` with `import type`.

### 8. `TerminalSession.tsx` — canvas font measurement duplicated

`measureText('M')` block duplicated in `mountPreview` (lines 143-150) and `captureToDataUrl` (lines 183-188). Extract `measureCharWidth(fontSize)` helper.

### 9. `TerminalSession.tsx` — `reusableCell` null cast

`?? (null as unknown as IBufferCell)` at line 207-208. Change to `IBufferCell | null` and use `reusableCell ?? undefined` at the call site.
