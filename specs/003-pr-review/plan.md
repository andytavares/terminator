# Implementation Plan: UX Improvement PRD

**Branch**: `bugfix-various-small-issues` | **Date**: 2026-05-10 | **Spec**: `docs/ux-improvement-prd.md`  
**Input**: UX audit PRD from `docs/ux-improvement-prd.md` — 25 discrete improvements across core app and git-integration extension.

---

## Summary

This plan implements the P0–P2 items from the UX Improvement PRD: replace native browser dialogs (`window.confirm`, `alert`) with in-app components, add a global `:focus-visible` focus ring, unify the CSS token namespace between core app and the git-integration extension, introduce IBM Plex Sans as the UI font, add skeleton loading states, fix the empty state, and a set of targeted git extension UX improvements (custom checkboxes, file status tooltips, commit workflow polish, viewed-file contrast fix). P3/P4 items (command palette, resizable panels, PR creation improvements) are deferred to a future spec.

---

## Technical Context

**Language/Version**: TypeScript 5.x (strict), React 18.x  
**Primary Dependencies**: Electron 30.x, xterm.js 5.x, Zustand, `@fontsource/ibm-plex-sans` (new, 1 package)  
**Storage**: electron-store (no schema changes needed)  
**Testing**: Vitest 2.x for unit tests; Playwright for E2E  
**Target Platform**: macOS (primary), Windows 11, Ubuntu 22.04  
**Project Type**: Desktop application (Electron + React renderer)  
**Performance Goals**: No regressions — CSS/component changes only; no new network requests  
**Constraints**: No new npm dependencies in core beyond `@fontsource/ibm-plex-sans`; extension CSS changes must not introduce any `--color-*` fallback values  
**Scale/Scope**: ~25 targeted changes across ~20 files; 0 new IPC channels; 0 schema changes

---

## Constitution Check

### § II — Extension Isolation

- ✅ CSS token changes in the extension consume tokens from the host contract, not internal variables.
- ✅ No new imports from `src/renderer/*` or `src/main/*` in the extension.
- ✅ `@fontsource/ibm-plex-sans` is a renderer-only concern — it goes in the root `package.json` (not the extension's) because it is consumed by core app CSS.

### § IV — Dependency Stewardship

- ✅ `@fontsource/ibm-plex-sans`: Fontsource org, 10+ contributors, 5k+ GitHub stars, actively released, no CVEs. Official docs: https://fontsource.org/fonts/ibm-plex-sans
- ✅ All P0–P2 items otherwise use zero new packages (CSS + React only).

### § V — Code Readability & Minimalism

- ✅ `ConfirmDialog` is ~60 lines of JSX wrapping existing `Dialog.css`. No abstraction overhead.
- ✅ Skeleton CSS is a ~20-line utility class set in `styles.css`. No component wrapper.
- ✅ CSS token aliases are 20 lines in `:root`. No runtime logic.

### § VI — Test-Driven Development

- ✅ `ConfirmDialog` gets unit tests: renders correctly, calls `onConfirm`/`onClose`, traps focus, dismisses on Escape.
- ✅ `EmptyState` gets unit tests: renders icon/title/subtitle/actions, shortcut display.
- ✅ CSS-only changes (focus-visible, tokens, font) are visually verified; no unit tests needed.
- ✅ Git staging area checkbox styling: visual regression test via Playwright screenshot.

### § VII — YAGNI

- ✅ P3/P4 items (command palette, resizable panels, keyboard navigation in projects panel, etc.) are explicitly deferred. No speculative scaffolding.

### § VIII — Documentation

- ✅ `docs/EXTENSION-DEVELOPMENT.md` updated with `--tm-*` token contract.
- ✅ `contracts/extension-token-api.md` is the canonical contract document.
- ✅ `README.md` tech stack table updated for new font dependency.
- ✅ `docs/ARCHITECTURE.md` updated if CSS token strategy constitutes an architectural change.

### § X — Code Cleanliness

- ✅ All `--color-*` fallback values removed from `extensions/git-integration/src/components/*.css`.
- ✅ Hardcoded hex values removed and replaced with `--tm-*` tokens.
- ✅ `window.confirm` and `alert()` call sites replaced — not left in parallel.

---

## Project Structure

### Documentation (this feature)

```text
specs/003-pr-review/
├── plan.md                        # This file
├── research.md                    # Phase 0 decisions (done)
├── data-model.md                  # Phase 1 types (done)
├── contracts/
│   ├── extension-token-api.md     # CSS token contract (done)
│   └── adrs/
└── tasks.md                       # Phase 2 output (next: /speckit-tasks)
```

### Source Code Changes

```text
src/renderer/
├── styles.css                     # ADD: --tm-* token aliases, --font-ui, skeleton utilities
├── index.tsx                      # ADD: @fontsource/ibm-plex-sans imports
├── App.tsx                        # UPDATE: replace EmptyState ad-hoc markup
├── components/
│   ├── EmptyState.tsx             # NEW: reusable empty-state component
│   ├── ConfirmDialog.tsx          # NEW: replaces window.confirm()
│   ├── settings/
│   │   ├── SettingsPanel.tsx      # UPDATE: replace alert(), add dirty guard
│   │   ├── GlobalSettings.tsx     # UPDATE: split into sections (Appearance / Terminal / Git)
│   │   └── SettingsPanel.css      # UPDATE: font-family → --font-ui
│   ├── sidebar/
│   │   ├── WorkspaceRail.tsx      # UPDATE: replace window.confirm → ConfirmDialog
│   │   ├── WorkspaceItem.tsx      # UPDATE: replace window.confirm → ConfirmDialog
│   │   ├── ProjectsPanel.tsx      # UPDATE: replace window.confirm → ConfirmDialog
│   │   ├── ProjectItem.tsx        # UPDATE: replace window.confirm → ConfirmDialog
│   │   ├── ProjectsPanel.css      # UPDATE: font-family → --font-ui, rename affordance
│   │   ├── WorkspaceRail.css      # UPDATE: font-family → --font-ui
│   │   ├── WorkspaceItem.css      # UPDATE: font-family → --font-ui
│   │   ├── Dialog.css             # UPDATE: font-family → --font-ui
│   │   └── BranchSwitcher.css     # UPDATE: font-family → --font-ui
│   ├── terminal/
│   │   └── TabBar.css             # UPDATE: font-family → --font-ui for tab labels
│   └── ToastContainer.css         # UPDATE: font-family → --font-ui

extensions/git-integration/src/
├── components/
│   ├── git-integration.css        # UPDATE: migrate all --color-* → --tm-*, custom checkboxes,
│   │                              #         skeleton states, commit workflow styles
│   └── pr-review/
│       └── pr-review.css          # UPDATE: migrate all --color-* → --tm-*, fix viewed opacity

tests/unit/
├── ConfirmDialog.spec.tsx         # NEW
└── EmptyState.spec.tsx            # NEW
```

---

## Complexity Tracking

No constitution violations requiring justification.

---

## Implementation Phases

### Phase A — P0: Critical Fixes (can land independently)

**A1. Replace `window.confirm` and `alert()` with in-app components**

1. Create `src/renderer/components/ConfirmDialog.tsx` + test.
2. Update `WorkspaceRail.tsx:106` — workspace delete.
3. Update `WorkspaceItem.tsx:52` — workspace delete (duplicate site).
4. Update `ProjectsPanel.tsx:186` — project delete.
5. Update `ProjectItem.tsx:21` — project delete (duplicate site).
6. Update `SettingsPanel.tsx:84` — extension install failure → `addToast`.

**A2. Global `:focus-visible` styles**

1. Add to `styles.css` after the Reset block:
   ```css
   *:focus {
     outline: none;
   }
   *:focus-visible {
     outline: 2px solid var(--accent);
     outline-offset: 2px;
     border-radius: var(--radius-sm);
   }
   ```
2. Remove `outline: none` from `SettingsPanel.css:135` (now global).
3. Verify xterm.js canvas is not visually affected (manual test).

---

### Phase B — P1: Design System Foundation

**B1. CSS Token Contract**

1. Add `--tm-*` alias block to `styles.css` `:root`.
2. Add `--font-ui` and `--tm-success`, `--tm-warning` tokens.
3. Update `docs/EXTENSION-DEVELOPMENT.md` with token table.
4. Update `docs/ARCHITECTURE.md` with CSS token strategy note.

**B2. IBM Plex Sans**

1. `npm install @fontsource/ibm-plex-sans`.
2. Import 400/500/600 weights in `src/renderer/index.tsx`.
3. Set `body { font-family: var(--font-ui); }` in `styles.css`.
4. Audit and selectively override `--font-mono` on: terminal container, diff tables, commit message textareas, branch name elements, `<code>`, `<pre>`.

**B3. Git Extension Token Migration**

1. Migrate `extensions/git-integration/src/components/git-integration.css` — replace all `--color-*` with `--tm-*`. Remove all hardcoded hex fallback values.
2. Migrate `extensions/git-integration/src/components/pr-review/pr-review.css` — same pattern.
3. Verify visual parity with a manual side-by-side review before/after.

---

### Phase C — P1/P2: Git Extension UX Improvements

**C1. Skeleton Loading for Git Sidebar**

1. Add `.skeleton` utility classes to `styles.css`.
2. In `GitSidebarPanel.tsx`, when `loading` is true, render 5 `.skeleton--row` placeholder elements instead of the "Loading…" text.
3. In `BranchSwitcher.tsx`, when `loading`, render a spinner (CSS animation) next to "Loading branches…" text.

**C2. Custom Styled Checkboxes**

1. Add checkbox styles to `git-integration.css` using `appearance: none` pattern (see research §5).
2. Apply to all `<input type="checkbox">` inside `.staging-area`.

**C3. File Status Badge Tooltips**

1. Add `title` attribute to each `.staging-area__badge` element using the status lookup table from data-model §7.

**C4. Commit Workflow Polish**

1. Increase commit message textarea `min-height` from 52px → 80px.
2. Add character count display below textarea (shown when > 50 chars, highlighted amber at 72 chars).
3. Add spinner state to Commit/Push buttons during operation (disable buttons, show `⟳` spinning icon).
4. Add "Commit & Push" combined button as primary; demote "Commit" to secondary.

**C5. Fix Viewed-File Opacity (PR Review)**

1. In `pr-review.css`, change `.chapter-file-row--viewed` opacity from `0.55` → `0.65`.
2. Change `.full-file-row--viewed` opacity from `0.5` → `0.65`.
3. Add `text-decoration: line-through` to `.chapter-file-name` and `.full-file-row-name` when viewed.

**C6. Risk Score Tooltips**

1. Add `title` attribute to each `.pr-stat-card` with a brief explanation of the metric.
2. Add a tooltip to each `.health-chip` in `HealthChips.tsx` explaining what the metric measures.
3. Add a `title` to the "why?" link in `ReviewDiffPane.tsx`.

---

### Phase D — P2: Core UX Polish

**D1. Improved Empty State**

1. Create `src/renderer/components/EmptyState.tsx` + `EmptyState.css`.
2. Remove the ad-hoc empty state from `App.tsx`; render `<EmptyState>` with appropriate props.
3. Show keyboard shortcut hints (Cmd+T, Cmd+,, Cmd+⇧+G) in the welcome variant.

**D2. Rename Affordance (Pencil Icon)**

1. In `ProjectsPanel.tsx` `ProjectCard`, add a pencil icon (`✎`) that appears on hover of `.proj-card__name`.
2. Single-click on pencil triggers `startRename()`.
3. Add CSS for `.proj-card__rename-icon` to `ProjectsPanel.css` — visible on `.proj-card:hover`, opacity 0 otherwise.

**D3. Pop-Out Window Polish**

1. In the main process (`index.ts` or `extension-host.ts`), set the PR review window title to `Code Review — repo-name`.
2. Add a thin workspace-accent-color stripe to the top of `PrReviewWindow.tsx`.

---

## Deferred (P3/P4 — Next Spec)

The following items from the PRD are out of scope for this implementation plan and require a separate spec:

- **Command palette** (Cmd+K) — requires `cmdk` dependency, registration API design.
- **Resizable project panel** — requires `react-resizable-panels` or custom drag implementation.
- **Keyboard navigation in projects panel** — requires `role="listbox"` refactor.
- **Tab bar overflow chevrons** — requires scroll position tracking.
- **Settings unsaved changes guard** — requires snapshot comparison logic.
- **Real-time dialog validation** — requires debounced IPC calls.
- **PR creation dialog improvements** — auto-resize, PR templates.
- **PR review keyboard shortcuts** (Cmd+[/]) — requires focus management in review view.
- **Inline comment edit/delete** — requires additional `gh` API calls.
- **Workspace rail first-launch mode** — requires first-launch detection flag.

---

## Test Plan

| Item                      | Test Type | What to Test                                                                                                                               |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ConfirmDialog`           | Unit      | Renders title/description, calls onConfirm on confirm click, calls onClose on cancel, closes on Escape, danger style applied when prop set |
| `EmptyState`              | Unit      | Renders icon/title/subtitle, renders action buttons with shortcuts, calls onClick                                                          |
| Focus-visible             | Manual    | Tab through workspace rail, project list, tab bar, settings nav — accent ring visible on all                                               |
| CSS token migration       | Manual    | Git sidebar, staging area, PR review — all surfaces match pre-migration appearance                                                         |
| IBM Plex Sans             | Manual    | Sidebar labels render in proportional font; terminal and diffs still in monospace                                                          |
| Skeleton loading          | Manual    | Open git sidebar on large repo — skeleton rows visible during fetch                                                                        |
| Custom checkboxes         | Manual    | Staging area checkboxes render with accent color when checked                                                                              |
| ConfirmDialog (Workspace) | E2E       | Right-click workspace → Remove → ConfirmDialog appears → Cancel → workspace still exists; Confirm → workspace removed                      |
| ConfirmDialog (Project)   | E2E       | Same as above for project deletion                                                                                                         |

---

## Post-Implementation Checklist

Per Constitution §VIII and CLAUDE.md:

- [ ] `npm run lint` passes with 0 errors
- [ ] `npm run build:extensions` succeeds
- [ ] `README.md` tech stack table updated (IBM Plex Sans / @fontsource)
- [ ] `docs/EXTENSION-DEVELOPMENT.md` updated with `--tm-*` token table
- [ ] `docs/ARCHITECTURE.md` updated with CSS token strategy
- [ ] `specs/003-pr-review/contracts/extension-token-api.md` complete
- [ ] All `window.confirm()` and `alert()` call sites removed
- [ ] All `--color-*` fallback values removed from extension CSS
- [ ] No unused imports introduced
- [ ] Unit tests green
- [ ] E2E tests green
