# git-integration Extension — Development Rules

## Extension Isolation (MANDATORY)

This is a **fully isolated extension**. The core application knows nothing about this extension until it is installed. Violations break the architecture.

### What extensions MAY do

- Import `@terminator/extension-sdk`, `@terminator/extension-ui` and this extension's own dependencies — nothing from the core's `src/` and nothing from another extension (ADR 094; `npm run lint` rejects any other import)
- Call core IPC via `window.electronAPI.{terminal,workspace,project,git,shell,fs,settings,...}` for **core-owned channels only**
- Call own IPC via `window.electronAPI.extensionBridge.invoke('git:...')`, `invoke('github:...')` and the extension's other own channels, through the `src/api/*.ts` bridge modules
- Register IPC handlers in `src/index.ts` via `api.ipc.registerHandler()`, as a `ChannelSpec` (ADR 096): a zod `schema` for the payload, the `invalid` response (`VALIDATION_ERROR` from `src/ipc/register.ts`), `run` on the parsed payload, and `onError` where a thrown error becomes a response. Never parse the payload by hand; `tests/unit/channel-schemas.spec.ts` checks every channel has a schema

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
await gitAPI.prStatus(...)
await gitAPI.push(...)
```

### Extension-owned GitHub channels — use `githubAPI` bridge

Always call via `src/api/github.ts`:

```typescript
import { githubAPI } from '../api/github'
await githubAPI.prFileDiff(...)    // NOT window.electronAPI.github.prFileDiff(...)
```

### Running git and gh

Every command goes through the core (ADR 094). git runs through `runGit` (`src/shell/run-git.ts`) over `api.shell.exec`, which `activate` binds; gh runs through `api.github` (pull request verbs, `repositories`, and `api` for REST and GraphQL), reached in the channel modules under `src/ipc/github/` through a `GithubTarget` from `githubTarget(repoRoot, access)` (`src/ipc/github/context.ts`). Never import `child_process` for git or gh; the only process this extension starts itself is the review agent's `claude`, which `shell.exec` does not run. A view never runs a command: it invokes a channel (PR creation is `github:pr-create`). Specs bind the runner with `tests/unit/support/shell.ts`. The core runs git and gh only inside a workspace folder, a project root, `api.paths.userData` or the review clone folder, which `manifest.json` declares in `contributes.shellRoots` (ADR 102); a gh call that needs no checkout (a `gh:owner/name` root, `gh api user`) runs in `GithubAccess.noCheckoutCwd`, which `activate` sets to `api.paths.userData`. Anything else rejects with `CwdOutOfScopeError`.

### Remote access

A channel is local-only unless it is in `REMOTE_READ_CHANNELS` (`src/remote-access.ts`): only channels that read status or pull request data. Adding one is a decision; `tests/unit/remote-access.spec.ts` lists the set exactly.

The remote browser chooses the checkout a channel runs git or gh in, so a payload's `repoRoot` (and `git:status`'s `path`) is always declared with the `RepoRoot` schema (`src/ipc/repo-root.ts`), never a bare string. It accepts a `gh:owner/name` repository, or a directory that is, or lies inside, a workspace folder, a project root or the review clone folder, compared after `realpath`, so a symlink inside a project cannot lead out of it. `activate` binds those roots with `bindWorkspaceRoots`. Anything else gets the channel's `invalid` response and nothing runs. The rule is the same for local calls: the handler cannot tell a remote caller from the app's own view. A new remote channel that takes a directory adds a row to `PAYLOAD_AT` in `tests/unit/remote-access.spec.ts`, which fails until it does.

### Rendering untrusted text

PR descriptions, templates and comments are rendered only through `src/components/pr-review/RichContent.tsx`, which wraps the design system's `Markdown` (`packages/extension-ui`: react-markdown + rehype-sanitize, ADR 091). Never add a second markdown renderer: this view can run shell commands. The only `dangerouslySetInnerHTML` is RichContent's highlight.js output for fenced code.

### Lint and typecheck

`npx tsc -p extensions/git-integration/tsconfig.json` and `npx eslint extensions/git-integration` must both exit 0; fix a React Compiler finding at its cause, do not silence it. The React Compiler rules apply: derive state during render instead of syncing it in an effect, read and write refs in handlers and effects, never during render.

### What extensions MUST NOT do

- **Never** put extension-specific methods in `src/main/preload.ts` (core file)
- **Never** modify `src/shared/electron-api/manifest.ts` (core file) or re-declare `window.electronAPI` here. The view API is declared once, in `packages/extension-sdk/types/renderer.d.ts`, which `tsconfig.extension.json` loads; if the extension needs something it lacks, extend the SDK declaration. Extension-owned channels are typed in the `src/api/*.ts` bridge modules through `invokeBridge<T>` (`src/api/bridge.ts`)
- **Never** add extension-only npm deps to the **root** `package.json` — add them to `extensions/git-integration/package.json`
- **Never** import from other extensions (`extensions/task-vault/...`, `extensions/foundry/...`)
- **Never** hardcode the extension ID in core app files

## NPM Dependencies

Add deps to `extensions/git-integration/package.json` only. npm workspaces hoist them automatically.
