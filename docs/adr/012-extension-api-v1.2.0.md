# ADR-012: Extension API v1.2.0 Additions

**Status**: Accepted  
**Date**: 2026-05-19  
**Feature**: `005-task-vault-extension`

## Decision

Add three new namespaces to `ExtensionAPI` in `src/main/extensions/api.ts`:

- `sidebar.registerGlobalTab(tab)` — registers a permanent, app-level tab always visible in WorkspaceRail
- `globalShortcut.register(accelerator, handler)` — wraps Electron's OS-level `globalShortcut` module
- `workspace.list() / listProjects() / onDelete() / onProjectDelete()` — exposes workspace metadata and deletion events to extensions

Also add `'global-tab'` to the `PanelSlot` union and `GlobalTabContribution`, `WorkspaceSnapshot`, `ProjectSnapshot` types.

## Motivation

The task-vault extension requires capabilities not present in v1.1.x:

- **FR-027/FR-028**: Task Vault must occupy a permanent top-level tab visible regardless of active workspace/project. The existing `sidebar.registerPanel('right-sidebar')` produces a floating panel scoped to the project view — it cannot produce a top-level tab.
- **FR-003**: The capture overlay must open from any application via an OS-level hotkey. Only Electron's `globalShortcut` (not `api.keyboard.register`) fires when the app is backgrounded.
- **FR-029/FR-033**: Vault↔Terminator links store opaque workspace/project UUIDs. The extension needs `workspace.list()` to resolve display names and `onDelete` to detect broken links without importing from core stores.

## Alternatives Considered

| Alternative                                           | Why Rejected                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Use existing `sidebar.registerPanel('right-sidebar')` | Right-sidebar panels are scoped to the workspace/project view and disappear when no project is selected. Cannot satisfy FR-027 (always visible). |
| Use `api.keyboard.register` for capture hotkey        | `api.keyboard.register` only fires when Terminator window is focused. FR-003 requires capture to work from _any_ foreground application.         |
| Import from `useWorkspaceStore` directly in extension | Violates Constitution Principle II (extension isolation). Store is renderer-only; extensions run in main process context.                        |
| Expose workspace data via a new IPC channel           | More indirection, same data. `workspace.list()` is synchronous read from existing `workspace-store.ts` — simpler and faster.                     |

## Consequences

- All v1.2.0 additions are purely additive. Existing extensions (git-integration, speckit-pilot) require no changes.
- `GlobalTabContribution.component` is typed as `unknown` in the main-process API to avoid a renderer dependency in the main-process type definition. The renderer registry uses `ComponentType`.
- Deletion events are routed through `src/main/extensions/workspace-events.ts` — a thin event bus imported by both `workspace.ipc.ts` (emitter) and `api.ts` (subscriber). No circular imports.
