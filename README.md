# Terminator

An extension-first, AI-focused terminal emulator built on Electron. Organizes work into Workspaces (repository-level) and Projects (task-level) with persistent tabbed terminal sessions that stay alive as you navigate between them.

## Features

- **Workspaces & Projects** — Two-level hierarchy. Workspaces map to local directories; Projects hold terminal sessions. Collapsible sidebar with color coding and tag chips.
- **Persistent terminal sessions** — xterm.js `Terminal` instances are never destroyed on tab switch. Buffer, scroll position, and running process survive navigation.
- **Theme system** — Dark/light themes switch immediately app-wide via CSS custom properties. Per-workspace theme overrides are supported.
- **Settings** — Global and per-workspace configuration for theme, scrollback limit, and default shell.
- **Command palette** — `Cmd+P` opens a quick-action palette for common operations.
- **Extension system** — Extensions install from local directories and contribute settings sections, sidebar items, sidebar panels, global tabs, workspace-scoped tabs (hover-reveal icons in workspace card headers), top-bar menu items, native View menu items, context menu entries, and terminal event hooks without modifying core code. See [Extension Development Guide](docs/EXTENSION-DEVELOPMENT.md).
- **Git Integration** — Built-in first-party extension: toggleable right sidebar showing live git status, full git view for staging/committing, and PR creation via `gh` CLI. Configurable per-workspace. Auto-refreshes on file changes.
- **MergeFlow** — Intent-first, card-based conflict resolver built into the git-integration extension. When a `git merge` produces conflicts, a "Resolve conflicts →" button appears in the git sidebar. MergeFlow presents each conflict as a two-panel diff (yours vs. theirs), shows author info and commit context for each side, and offers Keep Mine / Keep Theirs / Keep Both / Edit manually / Ask AI actions. Keyboard-first navigation: `M` (keep mine), `T` (keep theirs), `B` (keep both modal), `E` (manual editor), `Enter` (confirm), `←`/`→` (prev/next conflict), `Cmd+Z` (undo last decision), `Cmd+Shift+A` (AI suggestion panel), `Esc` (close modal). Session state persists across restarts so interrupted resolution sessions can be resumed. Commit flow stages all resolved files and runs the merge commit in one click.
- **Code Reviews tab** — PR review workflow inside the git-integration extension. Accessed via a hover-reveal icon inside each workspace card header (workspace-scoped tab — the icon appears on hover and is scoped to that workspace's repository). Paginated queue of open/closed PRs with search by title or PR number, five filter pills (All, High risk, Quick wins, In progress, Stale >3d), and stat cards (awaiting count, high-risk count, total review time, in-progress count). PRs are scored across six signals: tests, coverage, CI, lint, churn, and blast radius. Chapter-by-chapter review surface with syntax-highlighted diffs, inline comment threading, and one-click review submission (Approve / Request Changes / Comment) via `gh` CLI. Review sessions (chapter position, file, scroll) persist across restarts. In-progress PRs surface at the top of the queue even when they fall on a later pagination page; closed/merged PRs are automatically pruned from the in-progress list. Hover a paused/in-progress row to reveal a dismiss (×) button that removes it from the list. The pop-out button opens a dedicated focused review window and restores the exact PR, session, and view state. **AI-era enhancements**: universal language-agnostic chapter grouping via git co-change history (works in Go, Python, Ruby, Rust, Java, Swift, and any language), semantic-only diff filter that hides formatting/whitespace-only hunks (toggle in diff header), DRY violation detection across files with inline chip indicator, large-PR cognitive load warning (>400 LOC) with estimated review time and focus mode showing only medium/high risk files, and issue context section in the overview panel parsing Fixes/Closes/Linear refs from the PR body. Requires `gh auth login`.
- **SpecKit Pilot** — Extension that orchestrates the full Spec-Kit lifecycle (Constitution → Specify → Clarify → Plan → Checklist → Tasks → Analyze → Implement) with human-in-the-loop approval gates between every phase. Sidebar panel shows phase status glyphs with approve/reject/revoke controls; file watcher detects artifact changes; per-file confirm gate during Implement. State persisted to `.specify/.pilot/state.json`; audit log in `history.jsonl`. Toggle **kanban view** (⊞) to see tasks.md tasks in a 4-column board (Todo / In Progress / In Review / Done); view mode persists across restarts.
- **Task Vault** — GTD + Bullet Journal + PARA productivity extension. SQLite-backed vault with daily logs, inbox, projects, areas, and someday list. Global quick-capture hotkey (`Cmd+Shift+Space`). **Recurring tasks** — set daily/weekly/biweekly/monthly recurrence on any task; the engine automatically ensures exactly one future open instance exists at all times (idempotent, UNIQUE INDEX-enforced). 6-step guided weekly review wizard with optional ICS calendar feed integration. Bidirectional links between vault items and terminal sessions. Toggle **kanban view** (grid icon in toolbar) to see all vault tasks in configurable lanes; drag tasks between lanes to change their status; lanes scroll horizontally when there are more lanes than space allows; group tasks into **swimlanes** by project or area; add, rename, reorder, and remove lanes via the Lanes editor; default lanes are Todo / In Progress / In Review / Done; config and view mode persist across restarts. Kanban cards display a markdown-rendered description preview (capped at 2 lines). **Context filter** button always visible in toolbar — click to open a multiselect dropdown to filter all views by one or more `+context` tags; toolbar action buttons are right-aligned. **Task detail panel** — click any task (daily log or kanban card) to open a right-side panel with markdown-capable Description, Acceptance Criteria, and Dev Hints fields (stored in task metadata). **Ghost subtask row** — a faint `· + Add subtask…` row at the bottom of each open task's subtask list expands into an inline input on click.
- **View menu** — Toggle Sidebar and Open Settings (`Cmd+,`) are in the core View menu. Extensions contribute additional items: Toggle Git Sidebar (`Cmd+Shift+G`) and Code Reviews in New Window are added by the git-integration extension.
- **Split panes** — Split the current terminal vertically (`Cmd+D`, side by side) or horizontally (`Cmd+Shift+D`, top/bottom). Splits are recursive — each pane can be split further. Drag the divider bar to resize. Click a pane to focus it; keyboard input goes to the focused pane. `Cmd+W` closes the focused pane (collapsing the split) or the active tab when not in split mode. Each pane shows a blue focus border.
- **Notification center** — Bell icon in the tab bar opens a panel listing all in-app notifications (toasts, extension events). Unread count badge on the bell. Per-notification dismiss (×), "Mark all read," and "Clear all." ESC or clicking the backdrop closes the panel. Extensions create persistent notifications with action buttons via `api.notifications.createNotification({ type, title, message, actions })` — action callbacks run in the main process. Every toast automatically appears in the center so nothing is lost after auto-dismiss.
- **Activity indicators** — Spinning indicator on workspace tiles, project cards, and session tabs while a terminal is running a command or producing output (1.5 s idle debounce). Alert badge (red dot + count) coexists alongside the spinner for sessions awaiting input. OS-level system notification + Dock bounce fires on terminal bell.
- **Overview screen** — Press `⊞` in the workspace rail or `Cmd+Shift+O` to open a full-screen tiled grid of all open sessions. Each tile shows a live canvas snapshot of the terminal (refreshed every ~3 s), the project name, and per-session CPU% and memory. A top bar shows system-wide CPU%, memory used/total, and network in/out rates updated every 2 s. Click any tile to navigate directly to that session.
- **Global metrics bar** — Optional CPU / Memory / Network bar pinned to the bottom of every screen. Enable via Settings → Interface → "Show CPU / Memory / Network bar".
- **Scratch sessions** — Create a terminal instantly without selecting a workspace or project first. Click the `~` button in the workspace rail or press `Cmd+Shift+T`. Scratch sessions appear in a dedicated sidebar section beneath the project list. Move any scratch (or regular) session to an existing project — or create a new one — by right-clicking its tab and choosing "Move to project…".

- **Tab reordering** — Drag session tabs left or right within the tab bar to reorder them. The order persists for the lifetime of the app session.

- **About** — View app version and runtime details (Electron, Node, Chrome, platform) via **Help → About Terminator** (or the **Terminator** app menu on macOS).

- **Remote Control** — Enable a local HTTP/WebSocket server (default port 7681) and optionally an ngrok tunnel so you can access your Terminator terminals from any browser. Authenticate with a bcrypt-hashed password. Configure via Settings → Remote Control: toggle on/off, choose port, copy the public URL or LAN URL, show/copy/regenerate the session password. Requires `ngrok` for the public tunnel (`brew install ngrok`).

- **Clickable terminal links** — URLs and file paths in terminal output are underlined on hover. `Cmd+click` a URL to open it in the system browser; `Cmd+click` an absolute path (e.g. `/Users/foo/bar.ts` or `~/project/file.go`) to open it with the default application. Line:col suffixes like `file.go:42:5` are stripped before opening. All links throughout the app (PR comments, CI check links, issue refs) always open in the system browser.

- **Keyboard shortcuts** — `Cmd+B` (toggle sidebar), `Cmd+1–9` (switch workspace + expand it), `Cmd++/-` (cycle workspaces), `Cmd+T` (new tab), `Cmd+Shift+T` (new scratch terminal), `Cmd+W` (close focused pane / active tab), `Cmd+D` (split pane vertically), `Cmd+Shift+D` (split pane horizontally), `Cmd+Left/Right` (cycle tabs), `Cmd+K` (clear terminal), `Cmd+P` (command palette), `Cmd+,` (settings), `Cmd+Shift+G` (toggle git sidebar), `Cmd+Shift+O` (toggle Overview), `Cmd+Enter` (send newline to running program — always intercepted), `Shift+Enter` (send newline — only active when the running program has enabled bracketed paste mode, e.g. the `claude` CLI; passes through normally in a plain shell).

## Tech Stack

| Layer                  | Technology                                  |
| ---------------------- | ------------------------------------------- |
| Framework              | Electron 30.x                               |
| Language               | TypeScript 5.x (strict)                     |
| UI                     | React 18.x + Zustand + Lucide React (icons) |
| Terminal rendering     | xterm.js 5.x + xterm-addon-fit              |
| PTY management         | node-pty 1.x (main process only)            |
| Persistence            | electron-store 8.x                          |
| Schema validation      | Zod 3.x                                     |
| Remote server          | Fastify 4.x + @fastify/websocket 8.x        |
| Browser SPA            | xterm.js 6.x (AttachAddon + FitAddon)       |
| Password hashing       | bcryptjs (work factor 10, async only)       |
| Build                  | electron-vite 2.x + vite (remote SPA)       |
| Unit/integration tests | Vitest 2.x                                  |
| E2E tests              | Playwright 1.x                              |
| UI font                | IBM Plex Sans (@fontsource)                 |

Extension dependencies (not part of the core app): `better-sqlite3`, `@modelcontextprotocol/sdk`, `chokidar`, `gray-matter`, `node-ical` — declared in each extension's own `package.json`.

## Prerequisites

- **Node.js 20 LTS or newer** (Node.js 24 confirmed working). Use [nvm](https://github.com/nvm-sh/nvm).
- **Python setuptools** — required by node-pty's native compilation. On macOS with Python 3.12+:
  ```bash
  pip3 install setuptools --break-system-packages
  ```
- **git** — Required for the git integration extension. Assumed to be on your PATH.
- **gh CLI** (optional) — Required for GitHub PR creation and the Code Reviews tab. [Install gh](https://cli.github.com/). Authenticate with `gh auth login`.
- macOS 13+ (primary), Windows 11, Ubuntu 22.04 LTS.

## Quick Start

```bash
git clone <repo-url>
cd terminator

# Install dependencies (all versions pinned)
npm install

# Rebuild native modules (node-pty and better-sqlite3 require native compilation for Electron)
npm run rebuild

# Start in development mode (hot-reload via electron-vite)
npm run dev
```

## Installing the Packaged App (macOS)

Download the `.dmg` from the [latest release](../../releases/latest), mount it, and drag Terminator to your Applications folder.

Because the app is not notarized, macOS Gatekeeper will block it on first launch. Remove the quarantine flag before opening:

```bash
xattr -cr /Applications/Terminator.app
```

Then open the app normally. You only need to run this once.

## Available Scripts

| Script                     | Description                                           |
| -------------------------- | ----------------------------------------------------- |
| `npm run dev`              | Build extensions + development mode with hot-reload   |
| `npm run build`            | Build extensions + production build                   |
| `npm run build:extensions` | Compile extension TypeScript → `src/index.js` bundles |
| `npm run preview`          | Preview production build                              |
| `npm test`                 | Unit + integration tests (Vitest)                     |
| `npm run test:watch`       | Tests in watch mode                                   |
| `npm run test:e2e`         | E2E tests (Playwright, launches Electron)             |
| `npm run test:coverage`    | Tests with V8 coverage report                         |
| `npm run lint`             | ESLint check                                          |
| `npm run typecheck`        | TypeScript type check (no emit)                       |
| `npm run format`           | Prettier format                                       |
| `npm run format:check`     | Check formatting without writing files (CI)           |
| `npm run create-extension` | Scaffold a new extension from template                |
| `npm run rebuild`          | Recompile native modules for Electron                 |

## Project Structure

```
src/
├── main/                     # Electron main process (Node.js)
│   ├── index.ts              # Entry point: BrowserWindow, app menu, lifecycle
│   ├── ipc/                  # IPC channel handlers (one file per domain)
│   ├── terminal/             # PtyManager — node-pty lifecycle
│   ├── extensions/           # ExtensionHost + ExtensionAPI
│   └── storage/              # electron-store instances (workspaces, settings)
├── renderer/                 # React UI (Chromium renderer process)
│   ├── index.tsx             # Entry point, theme application
│   ├── components/           # sidebar/, terminal/, settings/
│   ├── stores/               # Zustand stores (workspace, session, settings)
│   └── hooks/                # useTerminalSession, useKeyboardShortcuts
└── shared/
    ├── types/index.ts        # TypeScript interfaces shared across processes
    └── schemas/              # Zod schemas (workspace, session, settings, extension)

extensions/
├── git-integration/          # Git status, PR creation, Code Reviews tab
├── speckit-pilot/            # Spec-Kit lifecycle orchestration
└── task-vault/               # GTD+BuJo+PARA productivity vault

tests/
├── unit/                     # Pure logic: storage, schemas, pty-manager, extensions
├── integration/              # IPC round-trip tests
└── e2e/                      # Playwright tests against real Electron app

docs/
├── ARCHITECTURE.md           # Deep-dive: process model, IPC, extension system
├── CONTRIBUTING.md           # Development setup, conventions, PR process
├── EXTENSION-DEVELOPMENT.md  # Guide for building Terminator extensions
└── adr/                      # Architectural Decision Records

specs/
├── 001-extension-first-terminal/  # Core terminal + extension system spec & contracts
├── 002-git-github-integration/    # Git integration spec
├── 003-pr-review/                 # Code Reviews feature spec & CSS token contract
├── 004-speckit-pilot-extension/   # SpecKit Pilot spec
├── 005-task-vault-extension/      # Task Vault spec
└── 006-mergeflow-conflict-resolver/ # MergeFlow conflict resolver spec
```

## Architecture Overview

Terminator uses Electron's two-process model strictly:

- **Main process** owns all Node.js APIs: PTY processes (`node-pty`), persistent storage (`electron-store`), extension loading, and native dialogs. It communicates with the renderer exclusively through IPC.
- **Renderer process** (`contextIsolation: true`, `nodeIntegration: false`) runs React + xterm.js. It calls `window.electronAPI.*` (exposed via `preload.ts` contextBridge) for all main-process operations.
- **Shared layer** (`src/shared/`) contains TypeScript interfaces and Zod schemas used at both ends of the IPC boundary for type-safe, validated communication.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a full breakdown.

## Developing an Extension

Extensions install from local directories. Create a directory with a `manifest.json` and a TypeScript entry point:

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "Does something useful",
  "main": "src/index.ts",
  "minAppVersion": "0.1.0"
}
```

The entry point exports an `activate(api)` function:

```typescript
// Generated by: npm run create-extension -- my-extension
// The scaffold produces a correctly typed src/index.js — do not import from src/main/ directly.

'use strict'

const disposables = []

function activate(api) {
  disposables.push(api.settings.register({ label: 'My Settings', properties: {} }))
  disposables.push(
    api.contextMenu.registerItem('workspace', {
      id: 'my-action',
      label: 'Do Thing',
      onClick: (id) => {},
    })
  )
}

function deactivate() {
  disposables.forEach((d) => d.dispose())
}

module.exports = { activate, deactivate }
```

Scaffold a new extension in seconds:

```bash
npm run create-extension -- my-extension
```

A production working example is in `extensions/git-integration/`. A minimal test fixture is in `tests/fixtures/sample-extension/`.

See [docs/EXTENSION-DEVELOPMENT.md](docs/EXTENSION-DEVELOPMENT.md) for the full guide including the v1.2.0 API (global tabs, global shortcuts).

## Key Design Decisions

| Decision                                               | Record                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| PTY processes live in main process only                | [ADR-001](docs/adr/001-pty-in-main-process.md)                   |
| Extension host lives in main process (Phase 1)         | [ADR-002](docs/adr/002-extension-host-in-main-process.md)        |
| electron-store for persistence                         | [ADR-003](docs/adr/003-electron-store-for-persistence.md)        |
| xterm.js instances are never destroyed on tab switch   | [ADR-004](docs/adr/004-xterm-instances-persist-on-tab-switch.md) |
| Native fs.watch instead of chokidar                    | [ADR-005](docs/adr/005-native-fswatcher-over-chokidar.md)        |
| Sandboxed shell execution for extensions               | [ADR-006](docs/adr/006-sandboxed-shell-exec-for-extensions.md)   |
| Bundled-first extension distribution (no marketplace)  | [ADR-007](docs/adr/007-bundled-first-extension-distribution.md)  |
| Extensions compile to CommonJS with esbuild            | [ADR-008](docs/adr/008-extension-commonjs-compilation.md)        |
| `gh` CLI for all GitHub PR review operations           | [ADR-009](docs/adr/009-gh-cli-for-review-ops.md)                 |
| Heuristic file ordering for code review (v1)           | [ADR-010](docs/adr/010-heuristic-file-ordering-v1.md)            |
| `react-markdown` + `remark-gfm` for comment rendering  | [ADR-011](docs/adr/011-react-markdown-for-comments.md)           |
| ExtensionAPI v1.2.0 additions                          | [ADR-012](docs/adr/012-extension-api-v1.2.0.md)                  |
| MCP stdio sidecar for Task Vault agent access          | [ADR-013](docs/adr/013-mcp-stdio-sidecar.md)                     |
| Line-based task IDs (session-scoped, rebuild-on-write) | [ADR-014](docs/adr/014-line-based-task-ids.md)                   |

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## License

Private — all rights reserved.
