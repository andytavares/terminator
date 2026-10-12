# task-vault Extension — Development Rules

## Extension Isolation (MANDATORY)

This is a **fully isolated extension**. The core application knows nothing about this extension until it is installed. Violations break the architecture.

### What extensions MAY do

- Import `@terminator/extension-sdk`, `@terminator/extension-ui` and this extension's own dependencies — nothing from the core's `src/` and nothing from another extension (ADR 094; `npm run lint` rejects any other import)
- Call core IPC via `window.electronAPI.{terminal,workspace,project,git,shell,fs,settings,...}` for **core-owned channels only**
- Call own IPC via `window.electronAPI.extensionBridge.invoke('task-vault:...')`
- Register IPC handlers in `src/index.ts` via `api.ipc.registerHandler()`

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

## The API task-vault offers other extensions

`activate` returns a `TaskVaultAPI` (`open(destination?)`, `openCapture()`), declared in the SDK (`packages/extension-sdk/types/extensions.d.ts`) so a consumer types it without importing this extension (ADR 094). A consumer lists `terminator.task-vault` in its manifest's `extensionDependencies` and calls `api.extensions.get('terminator.task-vault')`. Change the SDK declaration and the return value together; keep it small: it is a public API.

## NPM Dependencies

Add deps to `extensions/task-vault/package.json` only. npm workspaces hoist them automatically.

## Terminal Linking

When showing a terminal selector, list sessions with `window.electronAPI.terminal.listSessions()` in the view or `api.pty.listSessions()` in the backend. Never import the core's stores, and never expose terminal-link logic through the core preload.

## End-to-end tests

`tests/e2e/task-vault-*.spec.ts` drive every channel this extension registers in the real app, through its own view (`tests/e2e/task-vault-harness.ts`). A new channel gets a step there that does what a user does and reads back what was stored; a channel no view calls is driven as a remote client calls it (`task-vault-remote-api.spec.ts`).
