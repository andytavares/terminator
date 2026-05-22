# git-integration Extension — Development Rules

## Extension Isolation (MANDATORY)

This is a **fully isolated extension**. The core application knows nothing about this extension until it is installed. Violations break the architecture.

### What extensions MAY do

- Import from `../../../../src/renderer/extensions/registry` (the extension registry API)
- Import from `../../../../src/renderer/stores/` (shared core stores: session, workspace)
- Call core IPC via `window.electronAPI.{terminal,workspace,project,git,shell,fs,settings,...}` for **core-owned channels only**
- Call own IPC via `window.electronAPI.extensionBridge.invoke('git-integration:...')` or `window.electronAPI.extensionBridge.invoke('git:...')` etc.
- Register IPC handlers in `src/index.ts` via `api.ipc.registerHandler()`

### Core git channels available to ALL extensions (core-owned)

These are in the preload and safe to call via `window.electronAPI.git.*`:

- `isRepo`, `currentBranch`, `listBranches`, `checkout`
- `suggestWorktreePath`, `createWorktree`, `removeWorktree`, `listWorktrees`

### Extension-owned git channels — use `gitAPI` bridge

These IPC handlers are registered by **this extension** (not the core). Always call them via `src/api/git.ts`:

```typescript
import { gitAPI } from '../api/git'
await gitAPI.status(repoRoot)       // NOT window.electronAPI.git.status(...)
await gitAPI.diffFile(...)          // NOT window.electronAPI.git.diffFile(...)
await gitAPI.stage(...) / gitAPI.unstage(...)
await gitAPI.commit(...)
await gitAPI.commitOutputPoll(...)
await gitAPI.prStatus(...) / gitAPI.prCreate(...)
await gitAPI.push(...)
```

### Extension-owned GitHub channels — use `githubAPI` bridge

Always call via `src/api/github.ts`:

```typescript
import { githubAPI } from '../api/github'
await githubAPI.prFileDiff(...)    // NOT window.electronAPI.github.prFileDiff(...)
```

### What extensions MUST NOT do

- **Never** put extension-specific methods in `src/main/preload.ts` (core file)
- **Never** modify `src/renderer/electron.d.ts` (core file) — use declaration merging in `src/types/electron.d.ts` only when unavoidable, prefer bridge modules instead
- **Never** add extension-only npm deps to the **root** `package.json` — add them to `extensions/git-integration/package.json`
- **Never** import from other extensions (`extensions/task-vault/...`, `extensions/speckit-pilot/...`)
- **Never** hardcode the extension ID in core app files

## NPM Dependencies

Add deps to `extensions/git-integration/package.json` only. npm workspaces hoist them automatically.
