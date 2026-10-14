# Git Integration Extension

A first-party Terminator extension that adds a Git tab with a staging area, commit UI, and GitHub PR creation — all without leaving the terminal.

## Features

- **Staging area** — stage/unstage individual files or all at once; conflict detection blocks staging.
- **File diff viewer** — click any file to see a syntax-highlighted unified diff with line numbers.
- **Commit** — write a commit message and commit directly. Optionally add `--signoff` via settings. When a `pre-commit` or `commit-msg` hook rejects the commit, the view shows what it printed and offers **Commit without hooks** (`--no-verify`). That holds for plain git hooks as well as husky and lefthook. A refusal counts as a hook's when git printed no `fatal:` or `error:` line and the repository has that hook executable at `git rev-parse --git-path hooks/<name>`, which honours `core.hooksPath` ([githooks](https://git-scm.com/docs/githooks#_pre_commit)).
- **Pull Request** — click **Open PR** to create a PR via the `gh` CLI, draft or not. When the branch already has an open pull request, the dialog links to it instead of opening a second (`git:pr-status`). Once it is created, a "Pull request opened" notification appears, and the commit box shows a link to the new PR.
- **Conflict Solver** — each decision and each undo writes the file whole. The new text goes to a temporary file in the same folder, which is then renamed over the original (`src/utils/write-atomic.ts`). A reader, whether git, an editor or a watcher, therefore sees the old file or the new one and never an empty one, and the file keeps its mode.
- **Rich PR text** — PR descriptions, PR comments, inline review comments, the composer preview and the Open Pull Request template preview render markdown and any HTML embedded in it (`<details>`, `<br>`, `<sub>`, `<img>`, `<a>`…) through a sanitizing allowlist: scripts, frames, styles, `on*` handlers and `javascript:` links are dropped. Remote images load from their host, whether written as markdown or HTML; nothing proxies or blocks them.
- **Auto-refresh** — the Git tab refreshes automatically when files change (the core's file-change events) and on an interval.
- **Settings** — all behaviour is configurable globally and per-workspace (see below).

## Usage

The extension is bundled with Terminator and activates automatically on startup.

| Action             | How                                         |
| ------------------ | ------------------------------------------- |
| View changed files | Open the **Git** tab above the terminal     |
| Stage a file       | Check the file checkbox in the staging area |
| Stage all          | Click **Stage All**                         |
| Commit             | Enter a message and click **Commit**        |
| Open / create a PR | Click **Open PR** (requires `gh` CLI)       |

## Settings

Configure under **Settings → Git Integration**. `activate` (`src/index.ts`) registers them:

| Key                                                               | Type    | Default   | Scope     | Description                                                    |
| ----------------------------------------------------------------- | ------- | --------- | --------- | -------------------------------------------------------------- |
| `terminator.git-integration.git.enabled`                          | boolean | `true`    | workspace | Enable/disable the entire extension                            |
| `terminator.git-integration.git.githubToken`                      | string  | `''`      | global    | Token passed to gh as `GH_TOKEN`; stored as a secret           |
| `terminator.git-integration.git.commit.signOff`                   | boolean | `false`   | workspace | Commit with `--signoff` (a `Signed-off-by` trailer)            |
| `terminator.git-integration.git.maxDisplayedFiles`                | number  | `500`     | global    | Changed files the Git tab lists at most (10–5000)              |
| `terminator.git-integration.review.agentModel`                    | enum    | `sonnet`  | global    | Review agent model: `opus` or `sonnet`                         |
| `terminator.git-integration.review.agentEffort`                   | enum    | `default` | global    | Review agent effort: `default`, `low`, `medium`, `high`        |
| `terminator.git-integration.review.cloneFolder`                   | folder  | `''`      | global    | Where "Clone and review" clones; empty keeps reviews diff-only |
| `terminator.git-integration.review.agentTimeoutMinutes`           | number  | `5`       | global    | Review agent timeout (1–30)                                    |
| `terminator.git-integration.notify.<event>.{system,center,toast}` | boolean | `true`    | global    | Where each notification is delivered                           |

`git:commit` and `git:status` read the two Git settings on every call (`src/git-settings.ts`), so a change applies to the next commit and the next status refresh. With more changed files than **Max displayed changed files**, the Git tab lists that many and says so.

A **workspace** setting can also be set per workspace in Workspace Settings ("Use global default" hands it back), and is read for the repository a call is about (`api.settings.get(key, { repoPath })`). Sign-off is read for the repository being committed in. **Enable Git Integration** is read for the repository a channel names (`repoRoot`, or `git:status`'s `path`): where it is off, the channel answers `{ error: 'GIT_DISABLED' }` and runs nothing (`src/ipc/workspace-switch.ts`), and the Git tab says "Git Integration is off for this workspace." A channel that names no repository follows the global value. The extension activates when the setting is on globally or in any workspace; off everywhere, it registers only its settings page, and switching it back on takes a reload.

## Requirements

- **git** — must be on `$PATH`.
- **gh CLI** (optional) — required for pull requests and reviews. [Install gh](https://cli.github.com/), then run `gh auth login`. The app runs it from your login shell's `PATH`; the "gh CLI path" setting is gone (SDK 2.1.0), because the core runs only the bare `gh` command.

Every git and gh command goes through the core: git through `api.shell.exec` (`src/shell/run-git.ts`, bound in `activate`), gh through `api.github`. The extension starts no process of its own except the review agent's `claude`.

## How It Works

The extension has the two halves every extension has ([Extension Development Guide](../../docs/EXTENSION-DEVELOPMENT.md)):

- **Backend** (`src/index.ts`, bundled by `npm run build:extensions` into `src/index.js`, the manifest's `main`) — runs in the extension host. `activate` registers the settings, the `git:*`, `github:*`, merge-flow and review-agent channels (`src/ipc/`), the Quick Actions commands (`src/commands.ts`), the review command (`src/review-command.ts`) and the View menu's "Code Reviews in New Window".
- **View** (`src/renderer/main.tsx`, built by `npm run build:renderer` into `dist/index.html`, the manifest's `renderer`) — `src/renderer/App.tsx` routes on `?view=`: `project` shows `GitFullView` (the Git tab), `code-reviews` and `pr-review` show `PrReviewTab`, and `reviews` shows `ReviewDashboard`. It calls its own channels through the bridge modules in `src/api/`. The Git tab watches its repository through the core's file watch and reads status when a change is reported, with no timer (`src/hooks/useGitStatus.ts`, [ADR 108](../../docs/adr/108-a-file-watch-belongs-to-the-view-that-asked.md)). `git:watch-roots` names what to watch: the folder, and the repository's git directory when that is outside it, as a linked worktree's is. In the remote browser client, which has no watch, it reads status every three seconds.

## Why the review screen works as it does

Reasoning the code comments point to (`src/components/pr-review/`).

- **The queue pages itself** (`PrReviewTab.tsx`, `useAutoPaging`). The queue is meant to be worked top to bottom, and a "Load more pull requests" button made finishing it a manual chore, while the summary above it could count only the rows already held, so it reported the page size as the total. Pages now follow on their own, bounded so a repository with thousands of open pull requests cannot turn one screen into hundreds of API calls. Past the bound the summary still states the real total from `totalCount`, and search reaches anything the list has not got to.
- **Triage is one line, not four tiles** (`ReviewQueue.tsx`, `TriageBand`). Two of the four tiles routinely read "0", so half the row spent saying nothing was wrong, and two labels carried instructions inside them. A label names a metric; what to do with it belongs in the grouping below, which already says.

## Development

This extension is a first-party bundled extension. Its source lives inside the repository at `extensions/git-integration/`; `CLAUDE.md` holds its development rules.

### Directory structure

```
extensions/git-integration/
├── manifest.json        # id, main (src/index.js), renderer (dist/index.html), contributes
├── package.json         # its own dependencies and the build:renderer script
├── index.html           # view document
├── vite.renderer.config.ts
├── src/
│   ├── index.ts         # backend: activate(api) / deactivate()
│   ├── commands.ts      # Quick Actions commands
│   ├── review-command.ts
│   ├── remote-access.ts # REMOTE_READ_CHANNELS
│   ├── ipc/             # channel specs: git, github, merge-flow, review-agent
│   ├── schemas/         # zod payload schemas
│   ├── git/             # git-service, git-parser, conflict-reader
│   ├── github/          # gh access and PR review services
│   ├── review/          # diff analysis, reading order, review agent
│   ├── shell/run-git.ts # git over api.shell.exec
│   ├── api/             # the view's typed bridge to its channels
│   ├── stores/          # Zustand stores for the view
│   ├── hooks/
│   ├── components/      # GitFullView, StagingArea, FileDiffView, PrDialog, pr-review/, merge-flow/
│   └── renderer/        # main.tsx, App.tsx
└── tests/unit/
```

### Backend vs view split

| Code                  | Location                    | Runs in        |
| --------------------- | --------------------------- | -------------- |
| Settings registration | `src/index.ts`              | Extension host |
| View menu item        | `src/index.ts`              | Extension host |
| Git IPC handlers      | `src/ipc/git.ipc.ts`        | Extension host |
| GitHub IPC handlers   | `src/ipc/github.ipc.ts`     | Extension host |
| React UI components   | `src/components/`           | View (`dist/`) |
| Git status refresh    | `src/hooks/useGitStatus.ts` | View (`dist/`) |

### Modifying the extension

1. Edit `src/index.ts` for backend registrations (settings, menus, commands).
2. Edit `src/components/` for UI changes.
3. Add a channel as a `ChannelSpec` in `src/ipc/` and its bridge call in `src/api/`.
4. Run `npx vitest run extensions/git-integration` to verify nothing is broken.
5. Run `npm run dev` to test interactively; it runs `npm run build:extensions` first.

### Writing a new extension

See [`docs/EXTENSION-DEVELOPMENT.md`](../../docs/EXTENSION-DEVELOPMENT.md) and use the scaffold CLI:

```bash
npm run create-extension -- my-extension-name
```

This generates a plain-JavaScript extension at `extensions/my-extension-name/` that registers a setting, a command and a session listener, with commented-out examples of the rest of the API.
