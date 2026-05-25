# Implementation Plan: Task Vault Extension

**Branch**: `005-task-vault-extension` | **Date**: 2026-05-19 | **Spec**: [spec.md](spec.md)

## Summary

Build `task-vault` as a Terminator extension that implements a GTD+BuJo+PARA daily productivity system backed by plain markdown files. The extension occupies a permanent top-level app-level tab (requiring a v1.2.0 Extension API addition), provides quick capture via OS-level global hotkey, exposes an MCP server with 8 tools for agent access, and supports bidirectional navigational linking between vault items and Terminator projects/workspaces.

## Technical Context

**Language/Version**: TypeScript 5.x (matches rest of codebase)  
**Primary Dependencies**: `@modelcontextprotocol/sdk`, `chokidar`, `node-ical`, `gray-matter`, `zod`, `zustand`, `react 18`, `electron-store`  
**Storage**: Plain markdown files in user-configured vault directory; ephemeral `.todo/index.json` rebuilt on file change  
**Testing**: Vitest (matches rest of codebase); 80% coverage gate enforced  
**Target Platform**: Electron (macOS primary; Windows/Linux secondary)  
**Project Type**: Electron extension + bundled MCP stdio server script  
**Performance Goals**: Capture overlay opens in <300ms; daily log loads in <1s; MCP query returns in <500ms on vaults up to 2000 files  
**Constraints**: Extension must pass isolation test (deletable without breaking core); all deps in extension's own package.json; no root-level additions  
**Scale/Scope**: Single-user, single vault; up to 2000 markdown files before archive is excluded from live index

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                  | Status   | Notes                                                                                                                                                                         |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Source Integrity        | PASS     | All implementation choices grounded in official docs — see research.md                                                                                                        |
| II. Extension Isolation    | PASS     | Extension is fully self-contained in `extensions/task-vault/`; core deletion test will pass. Extension API additions (v1.2.0) are proper API extensions, not internal imports |
| IV. Dependency Stewardship | PASS     | All proposed deps have active communities, multiple maintainers — see research.md §Dependencies                                                                               |
| V. Code Readability        | PASS     | No cleverness required; straightforward file I/O + React UI                                                                                                                   |
| VI. TDD                    | PASS     | Tests written before production code; 80% coverage gate enforced by vitest.config.ts                                                                                          |
| VII. SOLID & YAGNI         | PASS     | No speculative abstractions; scope bounded to spec                                                                                                                            |
| VIII. Documentation        | PASS     | IPC channels, Extension API changes, and README ship in the same PR                                                                                                           |
| IX. ADRs                   | REQUIRED | Three ADRs needed: (1) Extension API v1.2.0 additions, (2) MCP stdio sidecar approach, (3) line-based task IDs                                                                |
| X. Code Cleanliness        | PASS     | Lint enforced; no placeholder comments without issue references                                                                                                               |
| XI. Functional Purity      | PASS     | Vault parser/writer are pure functions; side effects (file I/O, IPC) isolated to boundary layer                                                                               |

**Complexity Tracking**

| Deviation                               | Why Needed                                                                             | Simpler Alternative Rejected Because                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Extension API v1.2.0 (3 new namespaces) | Permanent global tab, OS-level hotkey, and workspace enumeration are not in v1.1.x API | Using existing `sidebar.registerPanel` ('right-sidebar') cannot produce a permanent top-level tab per spec FR-027 |

## Project Structure

### Documentation (this feature)

```text
specs/005-task-vault-extension/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── ipc-channels.md  # New task-vault IPC channels
│   └── extension-api-v1.2.0.md  # API additions for global tab, globalShortcut, workspace
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code

```text
# Core changes (Extension API v1.2.0)
src/main/extensions/api.ts            # Add globalShortcut, workspace namespaces; extend PanelSlot
src/renderer/extensions/registry.ts   # Add GlobalTabRegistration type + registerGlobalTab method
src/renderer/App.tsx                  # Render registered global tabs in layout
src/renderer/electron.d.ts            # Add task-vault IPC channel types

# New extension
extensions/task-vault/
├── manifest.json
├── package.json
├── README.md
├── src/
│   ├── index.ts                      # activate/deactivate; registers settings, globalShortcut, IPC handlers
│   ├── renderer.tsx                  # registerGlobalTab (TaskVaultView); registerSidebarPanel (LinkedVaultPanel)
│   ├── ipc/
│   │   ├── vault.ipc.ts              # Vault CRUD operations (complete, migrate, add, capture, query, etc.)
│   │   ├── projects.ipc.ts           # list-projects, weekly-review payload
│   │   ├── ics.ipc.ts                # ICS feed background polling + cache
│   │   └── links.ipc.ts              # Terminator link CRUD
│   ├── vault/
│   │   ├── parser.ts                 # Pure: markdown → Task[], Project, DailyLog
│   │   ├── writer.ts                 # Atomic file write (write-to-temp + rename)
│   │   ├── indexer.ts                # Builds/reads .todo/index.json
│   │   ├── watcher.ts                # chokidar watcher → triggers index rebuild + renderer notify
│   │   ├── stale.ts                  # Pure: staleness detection (no next action OR inactivity)
│   │   └── types.ts                  # Task, Project, DailyLog, InboxItem, VaultIndex, TerminatorLink
│   ├── mcp/
│   │   ├── server.ts                 # MCP stdio server entry point (run standalone via node)
│   │   └── tools/
│   │       ├── capture.ts
│   │       ├── today.ts
│   │       ├── add-task.ts
│   │       ├── complete-task.ts
│   │       ├── migrate-task.ts
│   │       ├── query.ts
│   │       ├── list-projects.ts
│   │       └── weekly-review.ts
│   ├── ics/
│   │   ├── fetcher.ts                # HTTP fetch + local file read; writes to cache file
│   │   └── parser.ts                 # Pure: ical string → CalendarEvent[]
│   ├── schemas/
│   │   ├── vault.schema.ts           # Zod schemas for IPC payloads
│   │   ├── project.schema.ts         # Zod schema for YAML frontmatter
│   │   └── mcp.schema.ts             # Zod schemas for 8 MCP tool inputs
│   ├── stores/
│   │   └── vault.store.ts            # Zustand: vault path, today's log, inbox count, projects list
│   └── components/
│       ├── TaskVaultView.tsx          # Root global tab: sidebar + main content router
│       ├── VaultSidebar.tsx           # Left nav: Today / Inbox / Projects / Areas / Archive
│       ├── DailyLog.tsx               # Daily log view (tasks + events + notes)
│       ├── QuickCaptureOverlay.tsx    # Floating capture modal
│       ├── ProjectsBrowser.tsx        # Projects list with stale detection
│       ├── InboxProcessor.tsx         # GTD clarify flow
│       ├── WeeklyReview.tsx           # 6-step wizard
│       ├── WeeklyReviewStep*.tsx      # One component per step
│       ├── LinkedVaultPanel.tsx       # Right-sidebar panel shown in Terminator project/workspace
│       └── LinkPicker.tsx             # Workspace/project picker for creating TerminatorLinks
└── tests/
    ├── vault/
    │   ├── parser.test.ts
    │   ├── writer.test.ts
    │   ├── indexer.test.ts
    │   └── stale.test.ts
    ├── mcp/
    │   └── tools/
    │       ├── capture.test.ts
    │       ├── complete-task.test.ts
    │       ├── migrate-task.test.ts
    │       ├── query.test.ts
    │       └── weekly-review.test.ts
    └── ics/
        └── parser.test.ts
```

## Implementation Phases

### Phase 1 — Extension API v1.2.0 (Core Changes)

Prerequisite for all extension work. Must land first.

1. Add `'global-tab'` to `PanelSlot` union in `src/main/extensions/api.ts`
2. Add `globalShortcut` namespace to `ExtensionAPI` interface (wraps Electron `globalShortcut.register`)
3. Add `workspace` namespace: `workspace.list()` returns `WorkspaceSnapshot[]`; `workspace.onDelete(handler)` subscribes to workspace deletion events
4. Add `GlobalTabRegistration` to registry + `registerGlobalTab` method in `src/renderer/extensions/registry.ts`
5. Update `App.tsx` to render global tabs as permanent left-side content alongside WorkspaceRail
6. Update `src/renderer/electron.d.ts` with task-vault channel types
7. Write ADR-005: Extension API v1.2.0 additions

### Phase 2 — Vault Core (Pure Logic)

No IPC, no UI. Pure functions only. TDD first.

1. `vault/types.ts` — all domain types
2. `vault/parser.ts` — markdown → typed structures (task bullets, YAML frontmatter, GFM task list syntax)
3. `vault/writer.ts` — atomic write (temp + rename), task status mutation
4. `vault/stale.ts` — staleness detection (no next action OR file mtime > N days) _(deferred to Phase 6 / US4 — not needed before user story work begins)_
5. `vault/indexer.ts` — build/read/write `.todo/index.json`
6. Zod schemas in `schemas/`

### Phase 3 — Main Process: IPC + Watcher

1. `vault/watcher.ts` — chokidar watcher; on change: rebuild index, notify renderer via IPC push
2. `ipc/vault.ipc.ts` — IPC handlers for all vault operations
3. `ipc/projects.ipc.ts` — `list-projects`, `weekly-review` payload assembly
4. `ipc/links.ipc.ts` — link CRUD (read/write TerminatorLink metadata)
5. `ipc/ics.ipc.ts` — ICS background poll (setInterval, configurable ms), cache to disk
6. `index.ts` — `activate()`: register settings, globalShortcut, IPC handlers, watcher, ICS poller

### Phase 4 — MCP Server

1. `mcp/tools/*.ts` — 8 tool implementations (read vault files directly via the parser)
2. `mcp/server.ts` — MCP SDK stdio server setup; tools registered from tools/
3. Write ADR-006: MCP stdio sidecar approach
4. Document server invocation path in extension README and quickstart.md

### Phase 5 — Renderer UI

1. `renderer.tsx` — register global tab + right-sidebar panel (LinkedVaultPanel)
2. `stores/vault.store.ts` — Zustand store (vault path, today's log, inbox count, open view)
3. `components/VaultSidebar.tsx` + `TaskVaultView.tsx` — layout shell
4. `components/DailyLog.tsx` — task list with complete/migrate actions
5. `components/QuickCaptureOverlay.tsx` — floating overlay triggered by globalShortcut
6. `components/ProjectsBrowser.tsx` — project cards with stale badges + resolution actions
7. `components/InboxProcessor.tsx` — sequential GTD clarify flow
8. `components/WeeklyReview.tsx` + step components — 6-step wizard
9. `components/LinkedVaultPanel.tsx` — shown in Terminator project sidebar
10. `components/LinkPicker.tsx` — workspace/project UUID picker

### Phase 6 — ICS Calendar Step

1. `ics/parser.ts` — pure ical string → CalendarEvent[]
2. `ics/fetcher.ts` — HTTP/file fetch, write cache, staleness timestamp
3. Wire into WeeklyReviewStepCalendar with last-refreshed display

### Phase 7 — Documentation + ADRs

1. Update `README.md` features list
2. Update `docs/ARCHITECTURE.md`
3. Add `specs/001-extension-first-terminal/contracts/ipc-channels.md` — task-vault channels
4. Add `specs/001-extension-first-terminal/contracts/extension-api.md` — v1.2.0 additions
5. Write ADR-007: Line-based task IDs (session-scoped, rebuild-on-write)
6. Update `quickstart.md` with MCP server setup instructions
