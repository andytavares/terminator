# Data Model: A3 Color Band Sidebar

**Feature**: `008-a3-color-band-sidebar`
**Date**: 2026-06-13

---

## Overview

**No data model changes.** The Workspace → Project → Session hierarchy in `workspaceStore`, `sessionStore`, and the SQLite main process schema is unchanged. The A3 sidebar redesign is a renderer-only restructuring.

One UI-state addition is made to `workspaceStore`:

---

## Store Addition: `workspaceStore`

### New Field

```typescript
// src/renderer/stores/workspace.store.ts
collapsedWorkspaceIds: Set<string>
```

**Purpose**: Tracks which workspace cards are collapsed in the sidebar. Persisted to `localStorage` key `terminator.workspace.collapsed` as a JSON array of IDs.

**Default value**: Empty `Set` (all workspaces expanded).

**Initialization**: On store creation, attempt to read and parse `localStorage.getItem('terminator.workspace.collapsed')`. If the value is a valid JSON array of strings, initialize the Set from it. On parse error, default to empty Set.

### New Action

```typescript
toggleWorkspaceCollapse(id: string): void
```

**Behaviour**:

1. Toggle the presence of `id` in `collapsedWorkspaceIds`.
2. Write `JSON.stringify([...newSet])` to `localStorage` key `terminator.workspace.collapsed`.
3. Call `set({ collapsedWorkspaceIds: newSet })`.

### New CSS Token Addition (`styles.css`)

The following tokens are added (replacements for the deprecated ones):

```css
:root {
  --sidebar-w: 260px; /* replaces --rail-w (72px) + --panel-w (248px) */
  --sidebar-min-w: 200px;
  --sidebar-max-w: 480px;
  --ws-card-radius: 8px;
  --ws-band-w: 3px;
  --session-row-h: 28px;
  --project-row-h: 30px;
  --ws-card-gap: 6px;
}
```

The following tokens are removed:

```css
/* REMOVE from :root */
--rail-w: 72px;
--panel-w: 248px;
```

All CSS rules referencing `--rail-w` or `--panel-w` are updated or deleted as part of Phase 1 / Phase 4.

---

## New localStorage Keys

| Key                              | Type                                   | Default | Written By                                   |
| -------------------------------- | -------------------------------------- | ------- | -------------------------------------------- |
| `terminator.workspace.collapsed` | `string` (JSON array of workspace IDs) | `"[]"`  | `workspaceStore.toggleWorkspaceCollapse()`   |
| `terminator.sidebar.width`       | `string` (integer px)                  | `"260"` | `UnifiedSidebar` resize handler on `mouseup` |

---

## Unchanged

- `Workspace` type — no new fields
- `Project` type — no new fields
- `TerminalSession` type — no new fields
- All IPC channel schemas
- All extension registration interfaces
- SQLite schema (main process)
