# git-integration Extension — Development Rules

## Extension Isolation (MANDATORY)

`extensions/CLAUDE.md` holds the rules for every extension. In this extension:

- Call own IPC through `window.electronAPI.extensionBridge.invoke('git:...')`, `invoke('github:...')` and the extension's other own channels, in the `src/api/*.ts` bridge modules.
- Register IPC handlers in `src/index.ts` with `api.ipc.registerHandler()`, as a `ChannelSpec` (ADR 096). It has a zod `schema` for the payload, the `invalid` response (`VALIDATION_ERROR` from `src/ipc/register.ts`), `run` on the parsed payload, and `onError` where a thrown error becomes a response. Never parse the payload by hand. `tests/unit/channel-schemas.spec.ts` checks that every channel has a schema.

### Core git channels available to ALL extensions (core-owned)

The preload exposes these. Call them with `window.electronAPI.git.*`:

- `isRepo`, `currentBranch`, `listBranches`, `checkout`
- `suggestWorktreePath`, `createWorktree`, `removeWorktree`, `listWorktrees`

### Extension-owned git channels — use `gitAPI` bridge

**This extension** registers these IPC handlers, not the core. Always call them through `src/api/git.ts`:

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

`useGitStatus` (`src/hooks/useGitStatus.ts`) starts the core's file watch on the folders `git:watch-roots` names. Then it reads status, and it reads status again when the watch reports a change (ADR 109). It has no timer, except in the remote browser client, which has no watch. Do not add a poll to the Git tab: a change the watch misses is a defect in the watch. `tests/e2e/git-status-watch.spec.ts` drives it with changes made outside the app, in a checkout and in a linked worktree.

### Extension-owned GitHub channels — use `githubAPI` bridge

Always call them through `src/api/github.ts`:

```typescript
import { githubAPI } from '../api/github'
await githubAPI.prFileDiff(...)    // NOT window.electronAPI.github.prFileDiff(...)
```

### Running git and gh

Every command goes through the core (ADR 094). git runs through `runGit` (`src/shell/run-git.ts`) over `api.shell.exec`, which `activate` binds. gh runs through `api.github` (pull request verbs, `repositories`, and `api` for REST and GraphQL). The channel modules under `src/ipc/github/` reach it through a `GithubTarget` from `githubTarget(repoRoot, access)` (`src/ipc/github/context.ts`). Never import `child_process`: the extension starts no process of its own. The review agent and PR summaries ask the core's `api.agents.runOnce` (ACP, ADR 130), which rejects every permission ask. `onStarted` names the session, so `cancel` stops it with `api.agents.cancel`. ACP has no structured output, so the prompt carries the JSON schema and the zod schema parses the first top-level `{…}` of the reply. The run's `sessionId` is the one ACP picked. "Ask follow-up" on a finished review (`review-agent:open-terminal`) resumes it in an agent tab with `api.agents.start`. A running review offers no "continue": one conversation has one agent, so continuing would end the review. A view never runs a command: it invokes a channel (PR creation is `github:pr-create`). Specs bind the runner with `tests/unit/support/shell.ts`. The core runs git and gh only inside a workspace folder, a project root, this extension's own `api.paths.globalStorage` or the review clone folder. `manifest.json` declares the review clone folder in `contributes.shellRoots` (ADR 102, ADR 103). A gh call that needs no checkout (a `gh:owner/name` root, `gh api user`) runs in `GithubAccess.noCheckoutCwd`, which `activate` sets to that folder. Any other folder rejects with `CwdOutOfScopeError`.

### End-to-end specs

The Git, Code Reviews, Reviews and review-agent flows have e2e specs (`tests/e2e/git-commit-flow`, `merge-flow-resolve`, `pr-review-diff`, `pr-review-queue`, `review-agent`, `review-dashboard`). They run against a local bare `origin` and the stub GitHub (`tests/e2e/github-stub.ts`, reached through `tests/e2e/fixtures/bin/gh`). A gh call without a route fails (REST answers 404, GraphQL "stub GitHub cannot answer this query"), so a new gh call needs a route in `tests/e2e/github-stub-gh.ts`. The stub ACP agent (`tests/e2e/fixtures/acp-stub-agent.mjs`) supplies the review agent's reply from the file `E2E_AGENT_REPLY` names.

### Home feed (ADR 117)

`src/home/` publishes to Home through `api.home` from data already fetched. `feed.ts` builds these:

- asks: review requests addressed to me directly (the `requested` section, titled "Re-review requested" when I reviewed the pull request before) and failing checks of my pull requests. The `re-review` section raises no ask.
- pull request facets.
- the `HOME_MEASURES.shipped` and `HOME_MEASURES.contributionsDays` measures (the last 36 days' levels 0-4, oldest first, for the Today rail).

`publisher.ts` keeps the latest dashboard and calendar. It publishes after each `github:dashboard-search` and all-repositories `github:contributions` fetch (hooks in `GithubHandlerOptions`). It also runs one dashboard refresh at activation and every two minutes, because the dashboard otherwise refreshes only while Reviews is open. Add no search for Home: aliased searches run serially and Reviews has hit 502s. `actions.ts` answers `start-review`, `send-to-agent` (the agent tab this extension started on the branch's worktree, else a new one) and `open-log` (`gh pr checks --web`).

### Worktrees tab

`git:local-inventory` and `git:remove-local` (`src/ipc/worktrees.ipc.ts`, logic in `src/git/local-inventory.ts` and `src/git/remove-local.ts`) feed the Worktrees tab of the workspace view. Both are local-only. `removeLocalItems` refuses the main worktree, the current branch and any worktree an open terminal runs in (by its folder or by its project card). The view disables the same rows, but the channel does not trust the view. It never forces a worktree removal. A branch delete after a removed worktree still removes that worktree's project card.

### Stores

The electron-store files (`config.json` for merge flow, `pr-review-sessions.json`, `pr-active-reviews.json`, `pr-agent-reviews.json`) live in `api.paths.globalStorage`. `openStorageDirectory` (`src/storage-directory.ts`) creates the folder at activation. Unless the new folder exists, it first moves the files that earlier builds kept in the shared userData folder (ADR 103). Open a store with `namedStore`. Its name must be one of `STORE_NAMES`, the list that activation moves.

### Remote access

A channel is local-only unless it is in `REMOTE_READ_CHANNELS` (`src/remote-access.ts`). Only channels that read status or pull request data belong there. Adding one is a decision. `tests/unit/remote-access.spec.ts` lists the set exactly.

The remote browser chooses the checkout a channel runs git or gh in. Declare a payload's `repoRoot` (and `git:status`'s `path`) with the `RepoRoot` schema (`src/ipc/repo-root.ts`), never a bare string. The schema accepts a `gh:owner/name` repository, or a directory that is, or lies inside, a workspace folder, a project root or the review clone folder. It compares them after `realpath`, so a symlink inside a project cannot lead out of it. `activate` binds those roots with `bindWorkspaceRoots`. Any other value gets the channel's `invalid` response and nothing runs. The rule is the same for local calls: the handler cannot tell a remote caller from the app's own view. A new remote channel that takes a directory adds a row to `PAYLOAD_AT` in `tests/unit/remote-access.spec.ts`, which fails until it does.

### Rendering untrusted text

Render PR descriptions, templates and comments only through `src/components/pr-review/RichContent.tsx`, which wraps the design system's `Markdown` (`packages/extension-ui`: react-markdown + rehype-sanitize, ADR 091). Never add a second markdown renderer: this view can run shell commands. `dangerouslySetInnerHTML` is set in two places: RichContent's highlight.js output for fenced code, and the diff rows (`DiffLineRows.tsx`), whose input is hljs output or `escapeHtml` (`src/utils/syntax.ts`). `markChangedWords` only re-emits those units plus fixed-class spans. Keep that invariant.

### Lint and typecheck

`npx tsc -p extensions/git-integration/tsconfig.json` (the sources), `npx tsc -p extensions/git-integration/tsconfig.test.json` (the specs) and `npx eslint extensions/git-integration` must all exit 0. Fix a React Compiler finding at its cause: do not silence it. ESLint also limits every function here, specs included, to 30 lines (blank lines and comments aside), complexity 10 and three parameters (`eslint.config.mjs`). Pass more values as one named object. Split a long spec `describe` into several. The React Compiler rules apply: derive state during render instead of syncing it in an effect, and read and write refs in handlers and effects, never during render.

### What extensions MUST NOT do

- **Never** put extension-specific methods in `src/main/preload.ts` (core file).
- **Never** modify `src/shared/electron-api/manifest.ts` (core file) or re-declare `window.electronAPI` here. The view API is declared once, in `packages/extension-sdk/types/renderer.d.ts`, which `tsconfig.extension.json` loads. If the extension needs something it lacks, extend the SDK declaration. Type extension-owned channels in the `src/api/*.ts` bridge modules through `invokeBridge<T>` (`src/api/bridge.ts`).
- **Never** add extension-only npm dependencies to the **root** `package.json`. Add them to `extensions/git-integration/package.json`.
- **Never** import from other extensions (`extensions/task-vault/...`, `extensions/foundry/...`).
- **Never** hardcode the extension ID in core app files.

## NPM Dependencies

Add dependencies to `extensions/git-integration/package.json` only. npm workspaces hoist them automatically.
