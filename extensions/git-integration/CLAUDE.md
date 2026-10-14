# git-integration Extension — Development Rules

## Extension Isolation (MANDATORY)

The rules every extension follows are in `extensions/CLAUDE.md`. In this extension:

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
await gitAPI.watchRoots(repoRoot)   // the folders useGitStatus watches (ADR 109)
await gitAPI.diffFile(...)          // NOT window.electronAPI.git.diffFile(...)
await gitAPI.stage(...) / gitAPI.unstage(...)
await gitAPI.commit(...)
await gitAPI.commitOutputPoll(...)
await gitAPI.prStatus(...)
await gitAPI.push(...)
```

### Status refresh

`useGitStatus` (`src/hooks/useGitStatus.ts`) starts the core's file watch on the folders `git:watch-roots` names, then reads status, and reads it again when the watch reports a change (ADR 109). It has no timer, except in the remote browser client, which has no watch. Do not add a poll to the Git tab: a change the watch misses is a defect in the watch. `tests/e2e/git-status-watch.spec.ts` drives it with changes made outside the app, in a checkout and in a linked worktree.

### Extension-owned GitHub channels — use `githubAPI` bridge

Always call via `src/api/github.ts`:

```typescript
import { githubAPI } from '../api/github'
await githubAPI.prFileDiff(...)    // NOT window.electronAPI.github.prFileDiff(...)
```

### Running git and gh

Every command goes through the core (ADR 094). git runs through `runGit` (`src/shell/run-git.ts`) over `api.shell.exec`, which `activate` binds; gh runs through `api.github` (pull request verbs, `repositories`, and `api` for REST and GraphQL), reached in the channel modules under `src/ipc/github/` through a `GithubTarget` from `githubTarget(repoRoot, access)` (`src/ipc/github/context.ts`). Never import `child_process` for git or gh; the only process this extension starts itself is the review agent's `claude`, which `shell.exec` does not run. Its children are not ended by the extension host's exit, so `deactivate` cancels every run still going (the disposer `registerReviewAgentHandlers` returns), and `claude` runs in a process group of its own, which a cancel kills whole, so what `claude` started ends too; a new child process needs the same. A view never runs a command: it invokes a channel (PR creation is `github:pr-create`). Specs bind the runner with `tests/unit/support/shell.ts`. The core runs git and gh only inside a workspace folder, a project root, this extension's own `api.paths.globalStorage` or the review clone folder, which `manifest.json` declares in `contributes.shellRoots` (ADR 102, ADR 103); a gh call that needs no checkout (a `gh:owner/name` root, `gh api user`) runs in `GithubAccess.noCheckoutCwd`, which `activate` sets to that folder. Anything else rejects with `CwdOutOfScopeError`.

### End-to-end specs

The Git, Code Reviews, Reviews and review-agent flows have e2e specs (`tests/e2e/git-commit-flow`, `merge-flow-resolve`, `pr-review-diff`, `pr-review-queue`, `review-agent`, `review-dashboard`). They run against a local bare `origin` and the stub GitHub (`tests/e2e/github-stub.ts`, reached through `tests/e2e/fixtures/bin/gh`); a gh call it has no route for fails (REST answers 404, GraphQL "stub GitHub cannot answer this query"), so a new gh call needs a route in `tests/e2e/github-stub-gh.ts`. The review agent's `claude -p` answers with the file `E2E_CLAUDE_REVIEW_REPLY` names.

### Stores

The electron-store files (`config.json` for merge flow, `pr-review-sessions.json`, `pr-active-reviews.json`, `pr-agent-reviews.json`) live in `api.paths.globalStorage`. `openStorageDirectory` (`src/storage-directory.ts`) creates the folder at activation and first moves the files earlier builds kept in the shared userData folder, unless the new one exists (ADR 103). A store is opened with `namedStore`, whose name must be one of `STORE_NAMES`, the list activation moves.

### Remote access

A channel is local-only unless it is in `REMOTE_READ_CHANNELS` (`src/remote-access.ts`): only channels that read status or pull request data. Adding one is a decision; `tests/unit/remote-access.spec.ts` lists the set exactly.

The remote browser chooses the checkout a channel runs git or gh in, so a payload's `repoRoot` (and `git:status`'s `path`) is always declared with the `RepoRoot` schema (`src/ipc/repo-root.ts`), never a bare string. It accepts a `gh:owner/name` repository, or a directory that is, or lies inside, a workspace folder, a project root or the review clone folder, compared after `realpath`, so a symlink inside a project cannot lead out of it. `activate` binds those roots with `bindWorkspaceRoots`. Anything else gets the channel's `invalid` response and nothing runs. The rule is the same for local calls: the handler cannot tell a remote caller from the app's own view. A new remote channel that takes a directory adds a row to `PAYLOAD_AT` in `tests/unit/remote-access.spec.ts`, which fails until it does.

### Rendering untrusted text

PR descriptions, templates and comments are rendered only through `src/components/pr-review/RichContent.tsx`, which wraps the design system's `Markdown` (`packages/extension-ui`: react-markdown + rehype-sanitize, ADR 091). Never add a second markdown renderer: this view can run shell commands. The only `dangerouslySetInnerHTML` is RichContent's highlight.js output for fenced code.

### Lint and typecheck

`npx tsc -p extensions/git-integration/tsconfig.json` (the sources), `npx tsc -p extensions/git-integration/tsconfig.test.json` (the specs) and `npx eslint extensions/git-integration` must all exit 0; fix a React Compiler finding at its cause, do not silence it. ESLint also holds every function here, specs included, to at most 30 lines (blank lines and comments aside), complexity 10 and three parameters (`eslint.config.mjs`); pass more values as one named object, and split a long spec `describe` into several. The React Compiler rules apply: derive state during render instead of syncing it in an effect, read and write refs in handlers and effects, never during render.

### What extensions MUST NOT do

- **Never** put extension-specific methods in `src/main/preload.ts` (core file)
- **Never** modify `src/shared/electron-api/manifest.ts` (core file) or re-declare `window.electronAPI` here. The view API is declared once, in `packages/extension-sdk/types/renderer.d.ts`, which `tsconfig.extension.json` loads; if the extension needs something it lacks, extend the SDK declaration. Extension-owned channels are typed in the `src/api/*.ts` bridge modules through `invokeBridge<T>` (`src/api/bridge.ts`)
- **Never** add extension-only npm deps to the **root** `package.json` — add them to `extensions/git-integration/package.json`
- **Never** import from other extensions (`extensions/task-vault/...`, `extensions/foundry/...`)
- **Never** hardcode the extension ID in core app files

## NPM Dependencies

Add deps to `extensions/git-integration/package.json` only. npm workspaces hoist them automatically.
