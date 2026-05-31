# Developer Quickstart: Terminator

**Date**: 2026-05-05  
**Branch**: `001-extension-first-terminal`

---

## Prerequisites

- **Node.js 20 LTS or newer** — required by Electron 30.x. Use `nvm` or `fnm` to manage versions. (Node.js 24 is confirmed working.)
- **Python setuptools** — required by `node-pty` native compilation. On macOS with Python 3.12+: `pip3 install setuptools --break-system-packages`
- **macOS 13+** (primary dev target), Windows 11, or Ubuntu 22.04 LTS
- **Git**

---

## Setup

```bash
# Clone the repository
git clone <repo-url>
cd terminator

# Install dependencies (all versions pinned in package-lock.json)
npm install

# Rebuild native modules (node-pty requires native compilation for Electron)
npm run rebuild
```

The `rebuild` script runs `electron-rebuild` to recompile `node-pty` against the Electron Node.js runtime. This step is required after any `npm install` if `node-pty` or Electron version changes.

---

## Running the App

```bash
# Development mode (with hot-reload via electron-vite)
npm run dev

# Build for distribution
npm run build

# Preview the built app
npm run preview
```

---

## Running Tests

```bash
# Unit + integration tests (vitest)
npm test

# Run tests in watch mode
npm run test:watch

# E2E tests (Playwright — launches real Electron app)
npm run test:e2e

# All tests with coverage report
npm run test:coverage
```

**TDD workflow**: Write a failing test first (`npm run test:watch`), implement the minimum code to pass it, then refactor.

---

## Project Structure (quick reference)

```
src/main/         — Electron main process (PTY, IPC, storage, extensions)
src/renderer/     — React UI (xterm.js, sidebar, settings, state stores)
src/shared/       — TypeScript types and Zod schemas shared between processes
tests/            — unit/, integration/, e2e/
docs/adr/         — Architectural Decision Records
specs/            — Feature specifications and plans
```

---

## Key Architectural Rules

1. **Main process owns PTY**: All `node-pty` interaction happens in `src/main/terminal/`. The renderer never calls PTY APIs directly.
2. **Validated IPC boundaries**: All IPC payloads are Zod-validated on both sides. See `specs/001-extension-first-terminal/contracts/ipc-channels.md`.
3. **xterm.js instances are never destroyed on tab switch**: When a user navigates away from a project, xterm.js `Terminal` objects are detached from the DOM but kept in memory. Re-attaching restores the exact buffer and scroll state.
4. **Extensions receive only ExtensionAPI**: See `specs/001-extension-first-terminal/contracts/extension-api.md`. Never import internal modules from extension code.
5. **All ADRs in `docs/adr/`**: Read ADRs 001–014 before touching the relevant subsystem. Key ADRs by area: ADR-005 (file watching), ADR-006 (shell execution), ADR-007 (bundled extension distribution), ADR-008 (extension build pipeline), ADR-012 (ExtensionAPI v1.2.0), ADR-013 (MCP stdio sidecar), ADR-014 (line-based task IDs).

---

## Developing an Extension (local)

Use the scaffold CLI to generate a complete, working hello-world extension:

```bash
npm run create-extension -- my-extension
# optional: npm run create-extension -- my-extension --id com.example.my-extension
```

This creates `extensions/my-extension/` with a `manifest.json` and a `src/index.js` that demonstrates all v1.2.0 API surfaces as commented-out stubs. Run `npm run dev` and the extension loads automatically.

After making TypeScript changes to your extension source, rebuild before testing:

```bash
npm run build:extensions
```

To install a third-party extension from an arbitrary directory, open Settings (`Cmd+,`) → Extensions → **Install from Directory** → select the extension folder. The extension activates immediately. Check the Extensions panel for status (`enabled` / `error`).

**Working example**: `extensions/git-integration/` — a full production extension demonstrating sidebar panels, context menus, top-bar items, IPC, and file watching.

**Full API reference**: `docs/EXTENSION-DEVELOPMENT.md` and `contracts/extension-api.md`.

---

## Common Commands Reference

| Command                      | Description                              |
| ---------------------------- | ---------------------------------------- |
| `npm run dev`                | Start app in development mode            |
| `npm test`                   | Run unit + integration tests             |
| `npm run test:e2e`           | Run Playwright e2e tests                 |
| `npm run rebuild`            | Recompile native modules for Electron    |
| `npm run build:extensions`   | Compile extension TypeScript source      |
| `npm run lint`               | ESLint check                             |
| `npm run typecheck`          | TypeScript type check (no emit)          |
| `npm run format`             | Prettier format                          |
| `npm run create-extension`   | Scaffold a new extension from template   |
