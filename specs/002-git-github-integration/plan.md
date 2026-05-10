# Implementation Plan: Git & GitHub Integration Extension

**Branch**: `002-git-github-integration` | **Date**: 2026-05-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/002-git-github-integration/spec.md`

## Summary

Deliver three things as part of this feature branch:

1. **Git & GitHub integration extension** — a pre-bundled first-party Terminator extension contributing: a toggleable right sidebar showing live git status, a full git view panel for staging/diffing/committing, and PR creation via the `gh` CLI. All git/shell operations run in the main process via a new sandboxed `shell:exec` IPC bridge. File change detection uses Node.js native `fs.watch` with polling fallback (no new dependencies).

2. **Extension scaffolding CLI** — a `scripts/create-extension.js` script (Node.js, no compilation) that generates a new extension directory with a manifest, a TypeScript entry point demonstrating every v1.1.0 API surface, and a unit test skeleton. Runnable via `npm run create-extension -- <name>`.

3. **Extension Development Guide update** — `docs/EXTENSION-DEVELOPMENT.md` updated to cover the v1.1.0 API additions (`sidebar.registerPanel`, `topBar`, `shell`, `notifications`, `fs`) and the scaffolding CLI workflow.

---

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) — consistent with Phase 1
**Runtime**: Node.js 20 LTS (bundled with Electron 30.x)
**Framework**: Electron 30.x — existing
**Primary Dependencies** (additions to Phase 1):

- No new npm dependencies. All git/gh operations via `child_process.execFile` (stdlib). File watching via Node.js `fs.watch` (stdlib). Scaffolding CLI uses Node.js `fs` and `path` (stdlib).

**Storage**: `electron-store` (existing) — extension settings stored in global/workspace stores
**Testing**: `vitest` (unit/integration) + `@playwright/test` Electron (e2e) — consistent with Phase 1
**Target Platform**: macOS 13+, Windows 11, Ubuntu 22.04 LTS — consistent with Phase 1
**Project Type**: Desktop application extension + developer tooling CLI — consistent with Phase 1
**Performance Goals**:

- Sidebar initial load: < 2s (SC-001)
- Stage-and-commit workflow: < 60s (SC-002)
- PR creation: < 90s (SC-003)
- Sidebar refresh on file change: within configured interval, default 3s (SC-006)
- Scaffolding CLI: < 2s to generate a new extension directory

**Constraints**:

- Zero new npm dependencies (stdlib only for all new capabilities)
- Sandboxed shell exec: CWD pinned to project root; `shell: false`; env sanitized
- File cap: 500 changed files displayed by default; configurable via `git.maxDisplayedFiles`
- `gh` CLI is optional — GitHub features degrade gracefully when absent
- Scaffolding CLI must work on macOS, Windows, and Linux without any additional installs

---

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                              | Status  | Notes                                                                                                                                                                         |
| -------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity                    | ✅ PASS | All decisions grounded in official Node.js, Electron, git, gh CLI documentation. No blog-only sources.                                                                        |
| II. Dependency Stewardship             | ✅ PASS | Zero new npm dependencies. Native `fs.watch` (stdlib) over chokidar (ADR-005). `child_process.execFile` (stdlib) for shell. Scaffolding CLI uses `fs`/`path` stdlib only.     |
| III. Code Readability & Minimalism     | ✅ PASS | All extension API additions are spec-required (FR-022–FR-027). Scaffolding CLI generates only what the hello-world needs — no speculative features.                           |
| IV. Test-Driven Development            | ✅ PASS | TDD cycle for git parser, gh service, IPC handlers, and the scaffolding CLI's file generation logic.                                                                          |
| V. SOLID & YAGNI                       | ✅ PASS | Extension API additions minimal and spec-driven. Scaffolding CLI scoped to directory/file generation only — no plugin marketplace or registry logic.                          |
| VI. Documentation as First-Class       | ✅ PASS | `EXTENSION-DEVELOPMENT.md` updated in same delivery. All new IPC channels in `ipc-channels.md` and `electron.d.ts`. README updated.                                           |
| VII. ADRs                              | ✅ PASS | 3 ADRs written before implementation (ADR-005, ADR-006, ADR-007).                                                                                                             |
| VIII. Functional Purity & Immutability | ✅ PASS | Git/gh side effects isolated to service layer. Scaffolding CLI: file-write side effects isolated to a single `generateExtension()` function; all path/template logic is pure. |

**Constitution Check: PASSED — no gates blocked. Proceed to Phase 0.**

---

## Project Structure

### Documentation (this feature)

```text
specs/002-git-github-integration/
├── plan.md                              # This file
├── research.md                          # Phase 0 output
├── data-model.md                        # Phase 1 output
├── quickstart.md                        # Phase 1 output
├── contracts/
│   ├── extension-api-additions.md       # New ExtensionAPI surface (v1.1.0)
│   ├── ipc-channels-git.md              # New IPC channels for this feature
│   └── cli-scaffold.md                  # Scaffolding CLI interface contract
└── tasks.md                             # Phase 2 output (created by /speckit-tasks)
```

### Source Code (repository root)

```text
extensions/
└── git-integration/                    # Pre-bundled first-party extension
    ├── manifest.json                   # Extension manifest
    ├── src/
    │   ├── index.ts                    # activate() / deactivate() entry point
    │   ├── git/
    │   │   ├── git-service.ts          # git status, diff, stage, unstage, commit
    │   │   └── git-parser.ts           # Pure parsers: porcelain, unified diff
    │   ├── github/
    │   │   └── gh-service.ts           # gh CLI: auth check, pr create, pr view
    │   ├── components/
    │   │   ├── GitSidebarPanel.tsx     # Right sidebar panel (api.sidebar.registerPanel)
    │   │   ├── GitView.tsx             # Full git view panel (api.topBar.registerMenuItem)
    │   │   ├── StagingArea.tsx         # File list with stage/unstage checkboxes
    │   │   ├── FileDiffView.tsx        # Unified diff viewer
    │   │   └── PrDialog.tsx            # PR creation dialog (title, body, draft toggle)
    │   └── stores/
    │       └── git.store.ts            # Zustand: status, selected file, diff cache
    └── tests/
        ├── unit/
        │   ├── git-parser.spec.ts
        │   └── gh-service.spec.ts
        └── integration/
            └── git-ipc.spec.ts

scripts/
└── create-extension.js                 # NEW: Scaffolding CLI (plain Node.js, no compile step)

src/
├── main/
│   ├── extensions/
│   │   ├── api.ts                      # EXTEND: sidebar.registerPanel, topBar, shell, notifications, fs, nativeMenu
│   │   └── extension-host.ts           # EXTEND: auto-load extensions/ subdirectories at startup
│   ├── ipc/
│   │   ├── git.ipc.ts                  # EXTEND: status, diff-file, stage, unstage, commit, pr-status, pr-create
│   │   └── shell.ipc.ts                # NEW: sandboxed shell:exec IPC handler (renderer→main path)
│   ├── shell/
│   │   └── shell-executor.ts           # NEW: shared execFile logic (used by api.ts + shell.ipc.ts)
│   ├── git/
│   │   └── git-service.ts              # EXTEND: status, diff, stage, commit operations
│   └── fs/
│       └── fs-watcher.ts               # NEW: fs.watch manager + polling fallback (accepts intervalMs)
├── renderer/
│   └── electron.d.ts                   # EXTEND: new channel types
└── shared/
    └── schemas/
        ├── git.schema.ts               # NEW: Zod schemas for git types
        └── shell.schema.ts             # NEW: Zod schemas for ShellExecOptions, ShellResult

docs/
├── EXTENSION-DEVELOPMENT.md            # UPDATE: v1.1.0 API additions + scaffold CLI guide
└── adr/
    ├── 005-native-fswatcher-over-chokidar.md
    ├── 006-sandboxed-shell-exec-for-extensions.md
    └── 007-bundled-first-extension-distribution.md
```

**Structure Decision**: The git integration is a true extension under `extensions/git-integration/` that interacts with the core app exclusively through `ExtensionAPI`. The scaffolding CLI (`scripts/create-extension.js`) is a plain Node.js dev-tool script — no TypeScript compilation required, no extra dependencies, works cross-platform. The `EXTENSION-DEVELOPMENT.md` update ships in the same PR as the API additions it documents.

---

## Complexity Tracking

> No Constitution violations detected. No entries required.
