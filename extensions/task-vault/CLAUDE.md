# task-vault Extension — Development Rules

## Extension Isolation (MANDATORY)

The rules every extension follows are in `extensions/CLAUDE.md`; this extension's channels are `task-vault:*`.

### Core git channels available (core-owned, safe to call directly)

- `window.electronAPI.git.isRepo`, `currentBranch`, `listBranches`, `checkout`
- `window.electronAPI.git.suggestWorktreePath`, `createWorktree`, `removeWorktree`, `listWorktrees`

### Extension-owned IPC — always use extensionBridge

All `task-vault:*` channels are registered by this extension. Call them via:

```typescript
await window.electronAPI.extensionBridge.invoke('task-vault:vault:list-areas', payload)
```

### What extensions MUST NOT do

- **Never** modify `src/main/preload.ts` (core file)
- **Never** modify `src/shared/electron-api/manifest.ts` (core file)
- **Never** add extension-only npm deps to the **root** `package.json` — add to `extensions/task-vault/package.json`
- **Never** import from other extensions (`extensions/git-integration/...`, `extensions/foundry/...`)
- **Never** hardcode the extension ID (`terminator.task-vault`) in core app files

## NPM Dependencies

Add deps to `extensions/task-vault/package.json` only. npm workspaces hoist them automatically.

## Terminal Linking

When showing a terminal selector, list sessions with `window.electronAPI.terminal.listSessions()` in the view or `api.pty.listSessions()` in the backend. Never import the core's stores, and never expose terminal-link logic through the core preload.

## Dates

The backend (what `src/index.ts` imports and the view does not) computes dates with `Temporal`; the view (what `src/renderer/main.tsx` imports) must not use it, because it also runs in the phone's browser and iPhone Safari has no `Temporal` (ADR 108). `tsconfig.view.json` fails `npm run typecheck` on a use in any file the view reaches, so a module both sides import stays on `Date` or is split.

- Read the clock through `src/vault/clock.ts` (`zonedNow()`, `today()`, `daysAgo()`): it reads `Date.now()`, which the specs' fake timers control; `Temporal.Now` they do not (Vitest 4.1.11).
- `Temporal` is for sums and comparisons. Format what a person reads with `Intl`. Stored and sent values keep their format: `YYYY-MM-DD` dates, `toISOString()` instants.
- Vitest runs on Node 24 with `--harmony-temporal`, an earlier draft than Electron's: no `Temporal.Now.timeZoneId()` and no `timeZoneId` property. Check a method on both before using it (the ADR lists what was measured).

## End-to-end tests

`tests/e2e/task-vault-*.spec.ts` drive every channel this extension registers in the real app, through its own view (`tests/e2e/task-vault-harness.ts`). A new channel gets a step there that does what a user does and reads back what was stored; a channel no view calls is covered by the extension's IPC tests (`extensions/task-vault/tests/ipc/`).
