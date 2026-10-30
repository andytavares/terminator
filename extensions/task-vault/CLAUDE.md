# task-vault Extension — Development Rules

## Extension Isolation (MANDATORY)

`extensions/CLAUDE.md` holds the rules for every extension. This extension's channels are `task-vault:*`.

### Core git channels available (core-owned, safe to call directly)

- `window.electronAPI.git.isRepo`, `currentBranch`, `listBranches`, `checkout`
- `window.electronAPI.git.suggestWorktreePath`, `createWorktree`, `removeWorktree`, `listWorktrees`

### Extension-owned IPC — always use extensionBridge

This extension registers all `task-vault:*` channels. Call them through `extensionBridge`:

```typescript
await window.electronAPI.extensionBridge.invoke('task-vault:vault:list-areas', payload)
```

### What extensions MUST NOT do

- **Never** modify `src/main/preload.ts` (core file).
- **Never** modify `src/shared/electron-api/manifest.ts` (core file).
- **Never** add extension-only npm dependencies to the **root** `package.json`. Add them to `extensions/task-vault/package.json`.
- **Never** import from other extensions (`extensions/git-integration/...`, `extensions/foundry/...`).
- **Never** hardcode the extension ID (`terminator.task-vault`) in core app files.

## NPM Dependencies

Add dependencies to `extensions/task-vault/package.json` only. npm workspaces hoist them automatically.

## Terminal Linking

When you show a terminal selector, list sessions with `window.electronAPI.terminal.listSessions()` in the view or `api.pty.listSessions()` in the backend. Never import the core's stores. Never expose terminal-link logic through the core preload.

## Dates

The backend (what `src/index.ts` imports and the view does not) computes dates with `Temporal`. The view (what `src/renderer/main.tsx` imports) must not use `Temporal`, because it also runs in the phone's browser and iPhone Safari has no `Temporal` (ADR 108). `tsconfig.view.json` fails `npm run typecheck` on a use in any file the view reaches. A module that both sides import stays on `Date` or is split.

- Read the clock through `src/vault/clock.ts` (`zonedNow()`, `today()`). It reads `Date.now()`, which the fake timers in the specs control. They do not control `Temporal.Now` (Vitest 4.1.11).
- Use `Temporal` for sums and comparisons. Format text a person reads with `Intl`. Stored and sent values keep their format: `YYYY-MM-DD` dates, `toISOString()` instants.
- Vitest runs on Node 24 with `--harmony-temporal`, an earlier draft than Electron's. It has no `Temporal.Now.timeZoneId()` and no `timeZoneId` property. Check a method on both before you use it (the ADR lists what was measured).

## End-to-end tests

`tests/e2e/task-vault-*.spec.ts` drive every channel this extension registers in the real app, through its own view (`tests/e2e/task-vault-harness.ts`). Give a new channel a step there that does what a user does and reads back the stored data. The extension's IPC tests (`extensions/task-vault/tests/ipc/`) cover a channel that no view calls.
