# Implementation Plan: Extension-First AI-Focused Terminal Emulator (Phase 1)

**Branch**: `001-extension-first-terminal` | **Date**: 2026-05-05 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/001-extension-first-terminal/spec.md`

## Summary

Build a desktop terminal emulator (Electron + TypeScript) that organizes work into a two-level hierarchy — Workspaces (repository-level) and Projects (task-level) — with persistent terminal sessions that stay alive across navigation. Phase 1 delivers: workspace/project management with a collapsible sidebar, persistent tabbed terminal sessions, agent-tab labeling, configurable dark/light theming, global and workspace-level settings, keyboard shortcuts for navigation, and a minimal extension architecture that allows extensions to contribute settings, sidebar items, context menu entries, and terminal event hooks without modifying core code.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)  
**Runtime**: Node.js 20 LTS (bundled with Electron)  
**Framework**: Electron 30.x  
**Primary Dependencies**:

- `xterm` 5.x — terminal rendering in renderer process
- `xterm-addon-fit` — terminal resize handling
- `node-pty` 1.x — native PTY process management in main process
- `zod` 3.x — runtime schema validation for all data boundaries (IPC, storage, extension API)
- `electron-store` 10.x — typed persistent storage (workspaces, projects, settings)
- `zustand` 4.x — lightweight renderer-side state management
- `react` 18.x + `react-dom` — UI rendering in renderer process  
  **Storage**: `electron-store` (JSON files in OS app-data directory); in-memory only for terminal session buffers  
  **Testing**: `vitest` (unit/integration) + `@playwright/test` with Electron launch (e2e)  
  **Target Platform**: macOS 13+ (primary), Windows 11, Ubuntu 22.04 LTS  
  **Project Type**: Desktop application (Electron main + renderer processes)  
  **Performance Goals**: <500ms workspace/project switch; <3s cold startup; <200ms theme switch; <2s session resource cleanup  
  **Constraints**: 20 concurrent backgrounded sessions supported; 10,000 line default scrollback buffer (user-configurable); contextIsolation enabled; nodeIntegration disabled in renderer  
  **Scale/Scope**: Single-user desktop app; no network/cloud dependencies in Phase 1

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                              | Status  | Notes                                                                                                                                                            |
| -------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity                    | ✅ PASS | All dependencies have official docs. Research cites official Electron, xterm.js, node-pty, Zod, electron-store documentation only.                               |
| II. Dependency Stewardship             | ✅ PASS | All selected packages pass community health check (see research.md §Dependency Audit). No single-maintainer packages. All versions will be pinned.               |
| III. Code Readability & Minimalism     | ✅ PASS | Extension architecture is spec-required (FR-024–029), not speculative. No premature abstractions planned.                                                        |
| IV. Test-Driven Development            | ✅ PASS | TDD cycle planned for all FRs. Test structure defined in Project Structure below.                                                                                |
| V. SOLID & YAGNI                       | ✅ PASS | Extension API surface is intentionally minimal (4 contribution points only). No marketplace, remote registry, or process isolation planned for Phase 1.          |
| VI. Documentation as First-Class       | ✅ PASS | quickstart.md ships with Phase 1. ADRs written at decision time.                                                                                                 |
| VII. ADRs                              | ✅ PASS | 4 ADRs identified (see docs/adr/). Written before implementation begins.                                                                                         |
| VIII. Functional Purity & Immutability | ✅ PASS | Side effects (PTY I/O, storage reads/writes) isolated to service layer boundaries. Domain logic (workspace/project management) uses immutable state via Zustand. |

**Constitution Check: PASSED — no gates blocked. Proceed to Phase 0.**

## Project Structure

### Documentation (this feature)

```text
specs/001-extension-first-terminal/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── extension-api.md # Extension API contract
│   └── ipc-channels.md  # Electron IPC channel contract
└── tasks.md             # Phase 2 output (created by /speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── main/                     # Electron main process (Node.js)
│   ├── index.ts              # Main entry point, BrowserWindow setup
│   ├── ipc/                  # IPC channel handlers
│   │   ├── terminal.ipc.ts   # terminal:* channels
│   │   ├── workspace.ipc.ts  # workspace:* channels
│   │   ├── settings.ipc.ts   # settings:* channels
│   │   └── extension.ipc.ts  # extension:* channels
│   ├── terminal/
│   │   └── pty-manager.ts    # node-pty process lifecycle
│   ├── extensions/
│   │   ├── extension-host.ts # Load/unload/sandbox extensions
│   │   └── api.ts            # ExtensionAPI implementation exposed to extensions
│   └── storage/
│       ├── workspace-store.ts # electron-store workspace persistence
│       └── settings-store.ts  # electron-store settings persistence
├── renderer/                  # Electron renderer process (React)
│   ├── index.tsx              # Renderer entry point
│   ├── components/
│   │   ├── sidebar/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── WorkspaceItem.tsx
│   │   │   └── ProjectItem.tsx
│   │   ├── terminal/
│   │   │   ├── TerminalPane.tsx       # Hosts xterm.js instances
│   │   │   ├── TabBar.tsx             # Tab strip with agent badge support
│   │   │   └── TerminalSession.tsx    # Single xterm.js terminal wrapper
│   │   └── settings/
│   │       ├── SettingsPanel.tsx
│   │       ├── GlobalSettings.tsx
│   │       └── WorkspaceSettings.tsx
│   ├── stores/
│   │   ├── workspace.store.ts  # Zustand: workspace + project state
│   │   ├── session.store.ts    # Zustand: terminal session registry
│   │   └── settings.store.ts   # Zustand: settings state
│   └── hooks/
│       ├── useTerminalSession.ts
│       └── useKeyboardShortcuts.ts
├── shared/
│   ├── types/
│   │   └── index.ts           # Shared TypeScript interfaces
│   └── schemas/
│       ├── workspace.schema.ts # Zod schemas for Workspace, Project
│       ├── session.schema.ts   # Zod schemas for TerminalSession
│       ├── settings.schema.ts  # Zod schemas for Settings
│       └── extension.schema.ts # Zod schemas for Extension manifest
tests/
├── unit/
│   ├── terminal/              # pty-manager pure logic
│   ├── storage/               # storage service logic
│   └── extensions/            # extension host logic
├── integration/
│   ├── ipc/                   # IPC channel round-trip tests
│   └── storage/               # electron-store read/write tests
└── e2e/
    ├── workspace.spec.ts      # FR-001–006 end-to-end
    ├── project.spec.ts        # FR-007–010 end-to-end
    ├── terminal.spec.ts       # FR-011–016, FR-035–036
    ├── keyboard.spec.ts       # FR-030–034
    ├── settings.spec.ts       # FR-019–023, FR-020a
    └── extension.spec.ts      # FR-024–029
docs/
└── adr/
    ├── 001-pty-in-main-process.md
    ├── 002-extension-host-in-main-process.md
    ├── 003-electron-store-for-persistence.md
    └── 004-xterm-instances-persist-on-tab-switch.md
```

**Structure Decision**: Single Electron application with clear main/renderer/shared separation. The `shared/` layer enables type-safe IPC contracts validated by Zod at both ends. Tests are split by layer: unit tests for pure logic, integration tests for IPC + storage, and Playwright e2e tests that launch the real Electron app for FR validation.

## Complexity Tracking

> No Constitution violations detected. No entries required.
