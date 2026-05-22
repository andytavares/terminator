# speckit-pilot Extension — Development Rules

## Extension Isolation (MANDATORY)

This is a **fully isolated extension**. The core application knows nothing about this extension until it is installed. Violations break the architecture.

### What extensions MAY do

- Import from `../../../../src/renderer/extensions/registry` (the extension registry API)
- Import from `../../../../src/renderer/stores/` (shared core stores: session, workspace)
- Call core IPC via `window.electronAPI.{terminal,workspace,project,git,shell,fs,settings,...}` for **core-owned channels only**
- Call own IPC via `window.electronAPI.extensionBridge.invoke('speckit-pilot:...')`
- Register IPC handlers in `src/index.ts` via `api.ipc.registerHandler()`

### Core git channels available (core-owned, safe to call directly)

- `window.electronAPI.git.isRepo`, `currentBranch`, `listBranches`, `checkout`
- `window.electronAPI.git.suggestWorktreePath`, `createWorktree`, `removeWorktree`, `listWorktrees`

### Extension-owned IPC — always use extensionBridge

All `speckit-pilot:*` channels are registered by this extension. Call them via:

```typescript
await window.electronAPI.extensionBridge.invoke('speckit-pilot:my-action', payload)
```

### What extensions MUST NOT do

- **Never** modify `src/main/preload.ts` (core file)
- **Never** modify `src/renderer/electron.d.ts` (core file)
- **Never** add extension-only npm deps to the **root** `package.json` — add to `extensions/speckit-pilot/package.json`
- **Never** import from other extensions (`extensions/git-integration/...`, `extensions/task-vault/...`)
- **Never** hardcode the extension ID (`terminator.speckit-pilot`) in core app files

## NPM Dependencies

Add deps to `extensions/speckit-pilot/package.json` only. npm workspaces hoist them automatically.
