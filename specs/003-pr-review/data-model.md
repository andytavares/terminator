# Data Model: UX Improvement PRD

**Branch**: `bugfix-various-small-issues` | **Date**: 2026-05-10

---

## 1. ConfirmDialog Options

New type used by the shared `ConfirmDialog` component. Lives in `src/shared/types/index.ts` or as a local prop type in the component file (preferred — no shared type needed since it's a UI-only construct).

```typescript
interface ConfirmDialogProps {
  title: string // Primary question, e.g. "Remove workspace "My Repo"?"
  description?: string // Context message, e.g. "This will delete all 4 projects."
  confirmLabel?: string // Default: "Confirm"
  danger?: boolean // If true, confirm button uses --danger background
  onConfirm: () => void
  onClose: () => void
}
```

**Usage sites**: `WorkspaceRail.tsx`, `WorkspaceItem.tsx`, `ProjectsPanel.tsx`, `ProjectItem.tsx` (replace `window.confirm`). `SettingsPanel.tsx` (replace `alert`).

---

## 2. CSS Token Contract (Host → Extension)

The canonical token names published to extensions. Defined in `styles.css` as aliases over the core private tokens.

| Token                 | Maps to (core)     | Description                                  |
| --------------------- | ------------------ | -------------------------------------------- |
| `--tm-bg-base`        | `--bg-base`        | Deepest background                           |
| `--tm-bg-surface`     | `--bg-surface`     | Panel backgrounds                            |
| `--tm-bg-elevated`    | `--bg-elevated`    | Modals, dropdowns                            |
| `--tm-bg-card`        | `--bg-card`        | Card/list item backgrounds                   |
| `--tm-text-primary`   | `--text-primary`   | Primary text                                 |
| `--tm-text-secondary` | `--text-secondary` | Secondary / labels                           |
| `--tm-text-muted`     | `--text-muted`     | Hints, disabled text                         |
| `--tm-border`         | `--border`         | Subtle borders                               |
| `--tm-border-strong`  | `--border-strong`  | High-contrast borders                        |
| `--tm-accent`         | `--accent`         | Primary accent color (workspace-overridable) |
| `--tm-accent-dim`     | `--accent-dim`     | Tinted accent background                     |
| `--tm-danger`         | `--danger`         | Error/destructive color                      |
| `--tm-success`        | _(new)_ `#4ade80`  | Success state                                |
| `--tm-warning`        | _(new)_ `#facc15`  | Warning state                                |
| `--tm-radius-sm`      | `--radius-sm`      | 6px                                          |
| `--tm-radius-md`      | `--radius-md`      | 10px                                         |
| `--tm-radius-lg`      | `--radius-lg`      | 16px                                         |
| `--tm-font-mono`      | `--font-mono`      | Monospace font stack                         |
| `--tm-font-ui`        | `--font-ui`        | UI / proportional font stack                 |

**Extension CSS migration mapping** (git-integration `--color-*` → `--tm-*`):

| Old                                  | New                      |
| ------------------------------------ | ------------------------ |
| `var(--color-bg, #161b22)`           | `var(--tm-bg-surface)`   |
| `var(--color-bg-secondary, #1a1a1a)` | `var(--tm-bg-base)`      |
| `var(--color-text, #e6edf3)`         | `var(--tm-text-primary)` |
| `var(--color-text-muted, #8b949e)`   | `var(--tm-text-muted)`   |
| `var(--color-border, #333)`          | `var(--tm-border)`       |
| `var(--color-accent, #58a6ff)`       | `var(--tm-accent)`       |

---

## 3. Font Token

New token `--font-ui` added to `:root` in `styles.css`. Propagates to all non-terminal, non-code UI surfaces.

```
--font-ui: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

**Apply to**: workspace rail labels, projects panel, dialogs, settings panel nav + fields, tab bar labels, toast messages, context menus, branch switcher.  
**Keep `--font-mono` on**: terminal pane, diff views, commit message textareas, branch name pills, file paths, `<code>` / `<pre>` content.

---

## 4. Skeleton Utility Classes

Shared CSS utility classes added to `styles.css` for use across all surfaces that need loading skeletons.

```css
.skeleton            /* Base placeholder block */
.skeleton--text-sm   /* 11px text placeholder (width: 60%) */
.skeleton--text-md   /* 13px text placeholder (width: 80%) */
.skeleton--icon      /* 16x16 icon placeholder */
.skeleton--row       /* Full-width file-row placeholder */
```

---

## 5. EmptyState Component Props

New `EmptyState` component at `src/renderer/components/EmptyState.tsx`. Props:

```typescript
interface EmptyStateProps {
  icon?: string // Emoji or SVG character, default "⬡"
  title: string // Main message
  subtitle?: string // Optional secondary message
  actions?: Array<{ label: string; shortcut?: string; onClick: () => void }>
}
```

Replaces the ad-hoc `.empty-state` + `.empty-state__icon` pattern in `App.tsx`.

---

## 6. Settings Dirty State

Tracked inside `SettingsPanel` local state — no shared store needed (UI-only concern):

```typescript
interface SettingsDirty {
  global: boolean
  workspace: boolean
}
```

When any field value differs from the loaded settings snapshot, the corresponding flag is set. The close button shows "Discard" or renders a confirmation when dirty.

---

## 7. File Status Badge Labels

Lookup table (no new type — derived from existing `StagedFile.status` field already typed in git schema):

| Status code | Badge letter | Tooltip text |
| ----------- | ------------ | ------------ |
| `M`         | M            | Modified     |
| `A`         | A            | Added        |
| `D`         | D            | Deleted      |
| `R`         | R            | Renamed      |
| `C`         | C            | Copied       |
| `U`         | U            | Untracked    |
| `!`         | !            | Conflicted   |
