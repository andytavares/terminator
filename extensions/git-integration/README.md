# Git Integration Extension

A first-party Terminator extension that adds a git sidebar, staging area, commit UI, and GitHub PR creation — all without leaving the terminal.

## Features

- **Git sidebar** — right panel showing all changed files with status badges (M modified, A added, D deleted, R renamed, ? untracked, U conflict). Toggle with `⌘⇧G` or **View → Toggle Git Sidebar**.
- **Staging area** — stage/unstage individual files or all at once; conflict detection blocks staging.
- **File diff viewer** — click any file to see a syntax-highlighted unified diff with line numbers.
- **Commit** — write a commit message and commit directly. Optionally add `--signoff` via settings.
- **Pull Request** — click **Open Pull Request** to create or view a PR via the `gh` CLI. Supports draft PRs.
- **Auto-refresh** — sidebar refreshes automatically when files change (via `fs.watch`).
- **Settings** — all behaviour is configurable globally and per-workspace (see below).

## Usage

The extension is bundled with Terminator and activates automatically on startup.

| Action | How |
|---|---|
| Toggle git sidebar | `⌘⇧G` · View menu → Toggle Git Sidebar |
| View changed files | Open git sidebar |
| Stage a file | Check the file checkbox in the staging area |
| Stage all | Click **Stage All** |
| Commit | Enter a message and click **Commit** |
| Open / create a PR | Click **Open Pull Request** (requires `gh` CLI) |

## Settings

Configure under **Settings → Git Integration** or per-workspace:

| Key | Type | Default | Scope | Description |
|---|---|---|---|---|
| `git.enabled` | boolean | `true` | workspace | Enable/disable the entire extension |
| `git.sidebar.defaultOpen` | boolean | `false` | workspace | Open sidebar automatically on project open |
| `git.sidebar.refreshIntervalMs` | number | `3000` | workspace | Polling interval in ms (500–60000) |
| `git.ghCliPath` | string | `""` | global | Path to `gh` binary; empty = use `$PATH` |
| `git.commit.signOff` | boolean | `false` | workspace | Append `--signoff` to commits |
| `git.maxDisplayedFiles` | number | `500` | global | Cap on changed files shown (10–5000) |

## Requirements

- **git** — must be on `$PATH`.
- **gh CLI** (optional) — required only for PR creation. [Install gh](https://cli.github.com/), then run `gh auth login`.

## How It Works

The extension runs in two parts:

- **Main process** (`src/index.js`) — registers settings, native menu items, and file-system watchers. Sends `git:toggle-sidebar` IPC events to the renderer when the menu item or keyboard shortcut fires.
- **Renderer** (`src/components/`) — React components imported directly by `src/renderer/components/git/GitRightSidebar.tsx`. All git IPC calls (`window.electronAPI.git.*`) happen in the renderer.

## Development

This extension is a first-party bundled extension. Its source lives inside the repository at `extensions/git-integration/`.

### Directory structure

```
extensions/git-integration/
├── manifest.json              # Extension manifest (main → src/index.js)
├── README.md                  # This file
├── src/
│   ├── index.js               # Main-process entry point (CommonJS)
│   ├── index.ts               # TypeScript source for type checking
│   ├── components/
│   │   ├── GitSidebarPanel.tsx  # Compact file list (reads from git.store)
│   │   ├── GitView.tsx          # Full staging / commit / PR view
│   │   ├── StagingArea.tsx      # Stage/unstage file list
│   │   ├── FileDiffView.tsx     # Unified diff renderer
│   │   └── PrDialog.tsx         # Pull request creation dialog
│   ├── git/
│   │   └── git-parser.ts        # Pure parsers: parseStatus, parseDiff
│   ├── github/
│   │   └── gh-service.ts        # gh CLI wrapper via api.shell.exec
│   └── stores/
│       └── git.store.ts         # Zustand store: status, selectedFile, diffCache
└── tests/
    └── unit/
        ├── git-parser.spec.ts
        └── gh-service.spec.ts
```

### Main process vs renderer split

| Code | Location | Runs in |
|---|---|---|
| Settings registration | `src/index.js` | Main process |
| Native menu / keyboard | `src/index.js` | Main process |
| File-system watcher | `src/index.js` | Main process |
| Git IPC handlers | `src/main/ipc/git.ipc.ts` | Main process |
| React UI components | `src/components/*.tsx` | Renderer (bundled by electron-vite) |
| Git status polling | `src/renderer/components/git/GitRightSidebar.tsx` | Renderer |

### Modifying the extension

1. Edit `src/index.js` for main-process behaviour (settings, menus, fs.watch).
2. Edit `src/components/` for UI changes.
3. Edit `src/main/ipc/git.ipc.ts` for new IPC channels.
4. Run `npm test` to verify nothing is broken.
5. Run `npm run dev` to test interactively.

### Writing a new extension

See [`docs/EXTENSION-DEVELOPMENT.md`](../../docs/EXTENSION-DEVELOPMENT.md) and use the scaffold CLI:

```bash
npm run create-extension -- my-extension-name
```

This generates a working hello-world extension at `extensions/my-extension-name/` with stubs for all API surfaces.
