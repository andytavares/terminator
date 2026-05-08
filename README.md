# Terminator

An extension-first, AI-focused terminal emulator built on Electron. Organizes work into Workspaces (repository-level) and Projects (task-level) with persistent tabbed terminal sessions that stay alive as you navigate between them.

## Features

- **Workspaces & Projects** — Two-level hierarchy. Workspaces map to local directories; Projects hold terminal sessions. Collapsible sidebar with color coding and tag chips.
- **Persistent terminal sessions** — xterm.js `Terminal` instances are never destroyed on tab switch. Buffer, scroll position, and running process survive navigation.
- **Agent tab labeling** — Tabs can be designated `human` or `agent`. Agent tabs show a visible badge in the tab strip.
- **Theme system** — Dark/light themes switch immediately app-wide via CSS custom properties. Workspace-level overrides are supported.
- **Settings** — Global and per-workspace configuration for theme, scrollback limit, and default shell.
- **Extension system** — Extensions install from local directories and contribute settings sections, sidebar items, sidebar panels, top-bar menu items, native View menu items, context menu entries, and terminal event hooks without modifying core code. See [Extension Development Guide](docs/EXTENSION-DEVELOPMENT.md).
- **Git Integration** — Built-in first-party extension: toggleable right sidebar showing live git status, full git view for staging/committing, and PR creation via `gh` CLI. Configurable per-workspace. Auto-refreshes on file changes.
- **Code Reviews tab** — PR review workflow inside the git-integration extension. Prioritised queue of open PRs with risk scoring (churn, blast radius, cyclomatic complexity delta), chapter-by-chapter review surface with syntax-highlighted diffs, inline comment threading, and one-click review submission (Approve / Request Changes / Comment) via `gh` CLI. Review sessions persist across restarts. Requires `gh auth login`.
- **Keyboard shortcuts** — `Cmd+1–9` (switch workspace), `Cmd++/-` (cycle workspaces), `Cmd+T` (new tab), `Cmd+Left/Right` (cycle tabs), `Cmd+,` (settings), `Cmd+W` (close tab), `Cmd+Shift+G` (toggle git sidebar).

## Tech Stack

| Layer                  | Technology                       |
| ---------------------- | -------------------------------- |
| Framework              | Electron 30.x                    |
| Language               | TypeScript 5.x (strict)          |
| UI                     | React 18.x + Zustand             |
| Terminal rendering     | xterm.js 5.x + xterm-addon-fit   |
| PTY management         | node-pty 1.x (main process only) |
| Persistence            | electron-store 8.x               |
| Schema validation      | Zod 3.x                          |
| Build                  | electron-vite 2.x                |
| Unit/integration tests | Vitest 2.x                       |
| E2E tests              | Playwright 1.x                   |

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

# Rebuild native modules (node-pty requires native compilation for Electron)
npm run rebuild

# Start in development mode (hot-reload via electron-vite)
npm run dev
```

## Available Scripts

| Script                  | Description                               |
| ----------------------- | ----------------------------------------- |
| `npm run dev`           | Development mode with hot-reload          |
| `npm run build`         | Production build                          |
| `npm run preview`       | Preview production build                  |
| `npm test`              | Unit + integration tests (Vitest)         |
| `npm run test:watch`    | Tests in watch mode                       |
| `npm run test:e2e`      | E2E tests (Playwright, launches Electron) |
| `npm run test:coverage` | Tests with V8 coverage report             |
| `npm run lint`          | ESLint + TypeScript type check            |
| `npm run format`        | Prettier format                           |
| `npm run rebuild`       | Recompile native modules for Electron     |

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

tests/
├── unit/                     # Pure logic: storage, schemas, pty-manager, extensions
├── integration/              # IPC round-trip tests
└── e2e/                      # Playwright tests against real Electron app

docs/
├── ARCHITECTURE.md           # Deep-dive: process model, IPC, extension system
├── CONTRIBUTING.md           # Development setup, conventions, PR process
├── EXTENSION-DEVELOPMENT.md  # Guide for building Terminator extensions
└── adr/                      # Architectural Decision Records (ADR-001 to ADR-004)

specs/
└── 001-extension-first-terminal/  # Feature spec, plan, contracts, tasks
```

## Architecture Overview

Terminator uses Electron's two-process model strictly:

- **Main process** owns all Node.js APIs: PTY processes (`node-pty`), persistent storage (`electron-store`), extension loading, and native dialogs. It communicates with the renderer exclusively through IPC.
- **Renderer process** (`contextIsolation: true`, `nodeIntegration: false`) runs React + xterm.js. It calls `window.electronAPI.*` (exposed via `preload.ts` contextBridge) for all main-process operations.
- **Shared layer** (`src/shared/`) contains TypeScript interfaces and Zod schemas used at both ends of the IPC boundary for type-safe, validated communication.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for a full breakdown.

## Developing an Extension

Extensions install from local directories. Create a directory with an `extension.json` manifest and a JavaScript entry point:

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "Does something useful",
  "main": "index.js",
  "minAppVersion": "0.1.0"
}
```

The entry point exports an `activate(api)` function:

```js
export function activate(api) {
  api.settings.register({ label: 'My Settings', properties: { ... } })
  api.contextMenu.registerItem('workspace', { id: 'my-action', label: 'Do Thing', onClick: (id) => {} })
}
```

A working example is in `tests/fixtures/sample-extension/`.

See [docs/EXTENSION-DEVELOPMENT.md](docs/EXTENSION-DEVELOPMENT.md) for the full guide.

## Key Design Decisions

| Decision                                             | Record                                                           |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| PTY processes live in main process only              | [ADR-001](docs/adr/001-pty-in-main-process.md)                   |
| Extension host lives in main process (Phase 1)       | [ADR-002](docs/adr/002-extension-host-in-main-process.md)        |
| electron-store for persistence                       | [ADR-003](docs/adr/003-electron-store-for-persistence.md)        |
| xterm.js instances are never destroyed on tab switch | [ADR-004](docs/adr/004-xterm-instances-persist-on-tab-switch.md) |

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## License

Private — all rights reserved.
