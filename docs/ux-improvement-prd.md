# UX Improvement PRD — Terminator

**Version:** 1.0  
**Date:** 2026-05-10  
**Scope:** Core application + git-integration extension  
**Audience:** Engineering, design

---

## Executive Summary

Terminator is a well-architected Electron terminal with a strong extension story and a genuinely useful git integration. The core interaction model — workspace rail → projects panel → tabbed terminal — is sound. The PRD below identifies where the current implementation falls short of established UX best practices and proposes concrete changes ordered by impact. Improvements span six areas: design system cohesion, onboarding & empty states, navigation & discoverability, modal interactions, the git extension, and the PR Review extension.

---

## 1. Design System & Visual Consistency

### 1.1 Dual Token Namespaces

**Problem.** The core app uses `--bg-*` / `--text-*` / `--border-*` CSS variables. The git-integration extension uses a different namespace (`--color-bg`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-accent`) with inline fallback hex values. The two surfaces do not feel unified at runtime, and the extension's fallback colours (hardcoded `#161b22`, `#e6edf3`, `#8b949e`) diverge from the host theme tokens.

**Recommendation.** Establish a single token namespace as the canonical Extension API contract:

```css
/* Canonical tokens — exported by the host, consumed by all extensions */
--tm-bg-base, --tm-bg-surface, --tm-bg-elevated, --tm-bg-card
--tm-text-primary, --tm-text-secondary, --tm-text-muted
--tm-border, --tm-border-strong
--tm-accent, --tm-accent-dim
--tm-danger, --tm-success, --tm-warning
--tm-radius-sm, --tm-radius-md, --tm-radius-lg
--tm-font-mono
```

Map every git-integration `--color-*` variable to the canonical equivalents. Remove hardcoded hex fallbacks in extension CSS. This change is transparent at runtime but eliminates visual drift when the host theme changes.

**Effort:** Medium. CSS-only, no logic changes.

---

### 1.2 Monospace Font Used as UI Font

**Problem.** `IBM Plex Mono` is set as the global `font-family` for the entire app, including all sidebar chrome, dialogs, buttons, and settings panels. Monospace fonts have equal-width glyphs; using them for prose UI text wastes horizontal space, creates awkward letter-spacing, and reads as lower visual quality than the same content in a proportional font.

**Recommendation.** Introduce a second font token for UI chrome:

```css
--font-ui: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', monospace;
```

Apply `--font-ui` to: workspace rail, projects panel, dialogs, settings panel, tab bar labels, toast messages, context menus. Apply `--font-mono` to: terminal pane, diff views, commit message inputs, branch names, file paths, all `<code>` / `<pre>` content. IBM Plex Sans ships from the same foundry as IBM Plex Mono, maintaining visual harmony.

**Effort:** Low-medium. Requires updating `body` and targeted component selectors.

---

### 1.3 Inconsistent Border Radius Values

**Problem.** `--radius-sm` (6px), `--radius-md` (10px), `--radius-lg` (16px) are defined globally, but the git-integration extension uses raw values (4px, 6px, 7px, 8px, 10px) rather than the tokens. Several core components also bypass the token (e.g. `.ws-tile` uses `var(--radius-md)` but `.tab-bar__close` uses `border-radius: 3px`).

**Recommendation.** Audit all `border-radius` declarations and replace raw values with the nearest token. Add `--radius-xs: 4px` to cover the 3-4px case. Enforce token usage via a CSS linting rule.

**Effort:** Low.

---

### 1.4 Focus Visible States Missing

**Problem.** Many interactive elements suppress the browser default focus ring (`outline: none`) without providing a replacement. Keyboard users navigating with Tab get no visual indication of focus. Affected: `.proj-card`, `.ws-tile`, `.tab-bar__tab`, `.ctx-menu__item`, `.branch-sw__item`, most buttons in the git extension.

**Recommendation.** Add a consistent `:focus-visible` style using white — which exceeds WCAG 2.2 SC 2.4.11 (3:1 focus appearance contrast) on all dark background tokens and is the convention used by dark-mode developer tools (VS Code, etc.):

```css
:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.85);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

This style uses `:focus-visible` so it only shows for keyboard navigation, not mouse clicks. Apply globally in `styles.css` and ensure no component overrides it with `outline: none` without substitution.

**Effort:** Low.

---

## 2. Onboarding & Empty States

### 2.1 Empty State Is Confusing

**Problem.** When no project is selected, the main content area shows:

```
⌥
Select or create a project
```

The `⌥` glyph is the macOS Option key symbol. It has no semantic connection to "getting started" and will confuse new users who may interpret it as a keyboard modifier hint. The single line of text gives no actionable next step.

**Recommendation.** Replace with a structured empty state that guides the user:

```
[App Icon / Terminal symbol]

Welcome to Terminator

↳ Select a workspace in the left rail
  or click + to create your first one.

[keyboard shortcut table]
Cmd+T     New terminal tab
Cmd+,     Settings
Cmd+⇧+G  Toggle git sidebar
```

Show the welcome empty state only on first launch. Persist a `ui.hasSeenWelcome: boolean` field inside the existing `globalSettings` schema in `settings.store.ts` — set to `true` on first workspace creation or first project activation. After first use, show a simpler "Select a project" state.

**Effort:** Low.

---

### 2.2 No Guidance for the Workspace Rail

**Problem.** The rail shows colored initials tiles with no labels. First-time users must hover to discover workspace names. The `+` add-workspace button at the bottom is a small dashed circle with no tooltip visible until hover, and no label.

**Recommendation.**

- On first launch (no workspaces), render the rail in an expanded state that shows the workspace name next to the tile (a "labels visible" mode). Collapse to icon-only once the user has clicked a tile.
- Add a persistent label "New workspace" next to the `+` button until the first workspace is created.
- Surface the keyboard shortcut `Cmd+1` in the tooltip after hover delay, e.g.: `My Workspace (Cmd+1)`.

**Effort:** Low-medium.

---

### 2.3 Destructive Confirmations Use `window.confirm()`

**Problem.** Both "Remove workspace" and "Remove project" use the native `window.confirm()` dialog. In Electron, this renders as a native OS dialog that is visually inconsistent with the app, cannot be styled, and provides no contextual information (no icon, no description of consequences, no undo option).

**Recommendation.** Build a reusable `ConfirmDialog` component using the existing `Dialog.css` infrastructure:

```
┌────────────────────────────────────┐
│  Remove workspace "My Repo"?       │
│                                    │
│  This will delete all 4 projects   │
│  within it. This cannot be undone. │
│                                    │
│               [Cancel] [Remove]    │
└────────────────────────────────────┘
```

The "Remove" button should use `--danger` as its background. Show the count of contained projects so the user understands the blast radius. This component can be shared between workspace and project deletion. Initial focus lands on "Cancel"; Tab cycles between buttons; Enter activates whichever button has focus — preventing accidental destructive actions from keyboard habits.

**Effort:** Medium. New component, wire up to both context menu handlers.

---

## 3. Navigation & Discoverability

### 3.1 No Command Palette

**Problem.** Power users in developer tools expect a `Cmd+K` (or `Cmd+P`) command palette for fuzzy-searching across workspaces, projects, and actions without touching the mouse. The current keyboard shortcuts require memorization (`Cmd+1–9` to switch workspace) with no discoverable surface.

**Recommendation.** Implement a command palette triggered by `Cmd+K`:

```
┌──────────────────────────────────────────┐
│ 🔍 Search projects, workspaces, actions… │
├──────────────────────────────────────────┤
│ RECENT                                   │
│  ◉ backend-api — main branch             │
│  ◉ frontend-app — feat/auth              │
├──────────────────────────────────────────┤
│ ACTIONS                                  │
│  ⚙ Open Settings              Cmd+,      │
│  ⎇ New Terminal Tab            Cmd+T     │
│  ⚡ Toggle Git Sidebar         Cmd+⇧+G   │
└──────────────────────────────────────────┘
```

The palette should be filterable and keyboard-navigable (arrow keys + Enter). Results include: all projects (across all workspaces), all workspaces, and registered extension actions. Register `Cmd+K` in `useKeyboardShortcuts`.

**Effort:** High. New feature, non-trivial state management.

---

### 3.2 No Project Search / Filter

**Problem.** When a workspace has many projects (>10), there is no way to filter them. The user must scroll and visually scan. The panel is 248px wide and cannot be resized.

**Recommendation.**

- Add a filter input at the top of the projects panel that appears on focus of `Cmd+F` (when the panel is focused) or always visible when `projects.length > 6`.
- Make the projects panel draggable to resize (min 200px, max 400px), storing the width in settings.

**Effort:** Medium.

---

### 3.3 Double-Click to Rename Is Undiscoverable

**Problem.** Renaming a project requires double-clicking the project card name. This interaction is invisible — there's no affordance (pencil icon, "click to rename" hint on hover). The context menu "Rename" item is buried and requires right-click knowledge.

**Recommendation.**

- On hover of a project card's name, show a small pencil icon (✎) to the right of the name that triggers rename on single click.
- Keep double-click as an alternative.
- Update the context menu item label to "Rename (double-click)" as a hint.

**Effort:** Low.

---

### 3.4 Tab Bar Overflow Is Invisible

**Problem.** The session sub-tab bar (`tab-bar--sessions`) has `overflow-x: auto` with `scrollbar-height: 0`. When more than ~5 tabs are open, the rightmost tabs silently disappear with no affordance. The user must know to scroll horizontally to reach them.

**Recommendation.**

- Show fade gradient overlays at the left/right edges when the tab bar is scrollable.
- Add `<` and `>` navigation chevron buttons that appear when overflow exists.
- Show the total tab count in a badge when overflow exists, e.g. `+3`.

**Effort:** Medium.

---

### 3.5 No Keyboard Navigation Within Projects Panel

**Problem.** The projects panel is mouse-only. Users cannot use arrow keys to move between projects or Enter to activate one.

**Recommendation.** Make the projects panel list a `role="listbox"` with `aria-selected` on the active project. Support:

- `↑` / `↓` — move focus between projects
- `Enter` — activate focused project
- `F2` — rename focused project
- `Delete` — confirm-delete focused project

**Effort:** Medium.

---

## 4. Dialog & Modal Improvements

### 4.1 Settings Panel Needs Better Information Architecture

**Problem.** The settings sidebar has a single navigation item "Appearance & Terminal" that controls two conceptually distinct sections (visual appearance and terminal configuration). The "Extensions" section shows only a flat list of installed extensions with enable/disable; it provides no information about what each extension does, where to find more, or how to install from a registry.

**Recommendation.**

Split "Appearance & Terminal" into two separate nav items: **Appearance** and **Terminal**. Add a **Keyboard Shortcuts** section (read-only table of all registered shortcuts, editable in a future iteration). Improve the Extensions section:

```
Extensions
───────────────────────────────
git-integration    v1.1.0   [Enabled]
  Git status sidebar, staging, PR creation, and code review.

[Install from Directory]   [Browse Extension Registry ↗]
```

Each extension item should show its description, version, and status chip. The "Install from Directory" flow should replace the bare `alert()` failure message with a proper error toast (it currently uses `alert()` directly in `SettingsPanel.tsx:86`).

**Effort:** Medium.

---

### 4.2 Settings Modal Has No Unsaved Changes Guard

**Problem.** Some settings fields (default shell, worktree base dir) update only on `onBlur`. If the user clicks ✕ or presses Escape mid-edit, their changes are silently discarded. There is no unsaved changes indicator.

**Recommendation.** Track a `dirty` state per settings section. When the user attempts to close (✕ or Escape) while dirty, show an inline "You have unsaved changes — Save or Discard" banner at the top of the content area and block the close action until the user explicitly saves or discards. For fields that should update immediately (theme radio buttons, scrollback limit), apply changes in real time so they never enter a dirty state.

**Effort:** Medium.

---

### 4.3 Create/Edit Dialogs Lack Field Validation Feedback

**Problem.** Dialog forms (Create Workspace, Create Project) only show errors after submit. There is no real-time validation feedback (e.g., folder path not found, name already in use). The error display for rename is `proj-card__rename-error` at 10px — far too small to reliably notice.

**Recommendation.**

- Validate folder path existence on blur (not on submit).
- Increase error text to 11px minimum and add a warning icon (⚠).
- For name fields, perform duplicate-check on blur, not only on submit.
- Add character count for name fields with a reasonable max (50 chars).

**Effort:** Low-medium.

---

## 5. Git Integration Extension

### 5.1 Commit Workflow UX

**Problem.** The commit section is cramped (52px min-height textarea, tiny action buttons). The "Commit" and "Push" buttons have no confirmation state or progress indicator. After a successful commit or push, there is no visible feedback other than (optionally) a toast.

**Recommendations.**

- Increase the commit message textarea to `min-height: 80px`.
- Switch the commit message textarea font to `--font-ui` (IBM Plex Sans) — prose is more readable in a proportional font, consistent with Tower, GitKraken, and GitHub.com. Monospace is reserved for diff/code content only.
- Add character count to the commit message area, showing conventional commit length guidance (72-char subject line limit).
- Show an inline spinner on the Commit/Push buttons while the operation is in progress, and disable them to prevent double-submission.
- After a successful commit, briefly highlight the button green and animate back to normal (400ms) before reverting to idle state.
- Add a "Commit & Push" combined button as a primary action, moving "Commit" to secondary.

**Effort:** Low-medium.

---

### 5.2 Staging Area: Native Checkboxes

**Problem.** The staging area uses native `<input type="checkbox">` elements, which render with the OS default styling. These are visually inconsistent with the rest of the UI (which uses styled custom controls) and look unpolished, especially on macOS where native checkboxes have rounded corners and a system appearance.

**Recommendation.** Replace native checkboxes with custom styled checkboxes using CSS:

```css
.staging-area__checkbox {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--border-strong);
  border-radius: 3px;
  background: var(--bg-input);
  cursor: pointer;
  transition:
    background 0.1s,
    border-color 0.1s;
}
.staging-area__checkbox:checked {
  background: var(--accent);
  border-color: var(--accent);
}
.staging-area__checkbox:checked::after {
  content: '✓';
  display: block;
  font-size: 10px;
  color: white;
  text-align: center;
  line-height: 14px;
}
```

**Effort:** Low.

---

### 5.3 File Status Badges Are Letter-Codes Without Explanation

**Problem.** The staging area shows single-letter badges (`M`, `A`, `D`, `R`, `?`) for file status. While developers familiar with git understand these, they are not self-explanatory and there is no tooltip or legend.

**Recommendation.**

- Add `title` attribute tooltips to each badge: `title="Modified"`, `title="Added"`, `title="Deleted"`, etc.
- Consider replacing single letters with color-coded words (truncated to fit) for the selected file row, while keeping single letters for unselected rows for density.

**Effort:** Low.

---

### 5.4 Git Sidebar Has No Loading Skeleton

**Problem.** When the git sidebar first opens, it renders `Loading…` as plain text for an indeterminate period while git status is fetched. On slow or large repos, this can feel broken.

**Recommendation.** Replace the loading text with an animated skeleton UI matching the structure of the file list:

```
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   M
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  M
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓          A
```

Animate with a shimmer effect (`background: linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)` sliding left-to-right).

**Effort:** Low-medium.

---

### 5.5 No Undo for Discard Actions

**Problem.** The git extension allows discarding file changes (unstaging, reverting). These are destructive operations with no undo. There is no confirmation dialog or undo affordance.

**Recommendation.**

- For "Discard changes" on a file: show a confirmation dialog ("Discard changes to `src/foo.ts`? This cannot be undone.") with a 3-second auto-dismiss cancel option.
- For "Unstage all": require explicit confirmation.
- Stage operations (staging a file) do not need confirmation as they are non-destructive.

**Effort:** Medium.

---

### 5.6 PR Creation Dialog Needs Better UX

**Problem.** The PR creation dialog (`PrDialog.tsx`) shows a textarea for the PR description and a basic mode toggle (Write/Preview). The draft toggle, reviewers, labels, and milestone fields are absent. The dialog width is 560px but uses a fixed textarea without auto-resize.

**Recommendation.**

- Auto-resize the PR body textarea as the user types.
- Add a "Copy link" button once the PR is created (pull the PR URL from the `gh` output).
- Show a branch→base visualization: `feat/my-feature → main` with a configurable base branch dropdown.
- Add a "Recently used PR templates" option for repos that have `.github/PULL_REQUEST_TEMPLATE.md`.

**Effort:** Medium-high.

---

## 6. PR Review Extension

### 6.1 Risk Score Explanation Is Missing

**Problem.** The PR review queue shows risk chips (HIGH / MEDIUM / LOW) and stat cards with numeric values (churn, blast radius, cyclomatic complexity delta). Users have no way to understand what these numbers mean or how they are calculated without reading source code.

**Recommendation.**

- Add an information icon (ℹ) next to the stat cards that opens a popover explaining the scoring algorithm.
- In `RiskBreakdownPanel`, add a one-sentence description under each metric label explaining what it measures.
- In the PR queue, the risk chip tooltip should explain the threshold: `"HIGH: composite score ≥ 70"`.

**Effort:** Low. Documentation/tooltip additions only.

---

### 6.2 Chapter Navigation Is Not Keyboard-Accessible

**Problem.** The `ChapterNav` tab bar requires mouse clicks to switch chapters. There are no keyboard shortcuts for "next chapter" or "previous chapter" in the PR review workflow.

**Recommendation.**

- Register `Cmd+[` and `Cmd+]` as "previous/next chapter" shortcuts within the PR review view.
- Register `Space` as "mark viewed and advance to next file" in the diff pane.
- Show keyboard shortcut hints in the nav bar buttons on hover.

**Effort:** Medium.

---

### 6.3 Viewed Files Have Insufficient Visual Treatment

**Problem.** Viewed files are shown with `opacity: 0.55` (chapter file list) or `opacity: 0.5` (full file list). On dark backgrounds, this drops the text to approximately 30% of normal contrast, which is below the WCAG AA minimum of 4.5:1. Beyond accessibility, the styling makes it feel like viewed files are broken or unavailable.

**Recommendation.**

- Retain the reduced opacity but set it to no less than `0.65`.
- Additionally apply a `✓ Viewed` checkmark label (already present) in green.
- Add a strikethrough on the filename as a secondary indicator (readable but clearly "done").
- Allow clicking a viewed file to mark it as un-viewed (toggling the viewed state).

**Effort:** Low.

---

### 6.4 PR Review View Has No Progress Persistence Indicator

**Problem.** The PR review stores progress persistently (review sessions survive restart), but there is no visible indicator of overall progress on the queue view. A user coming back to a review session cannot tell from the queue item alone how far they have gotten.

**Recommendation.** Add a progress bar or fraction (e.g., `12/47 files`) to each PR row in the review queue. This can reuse the existing `viewedFiles` data from the store. Style as a thin accent-colored progress bar under the PR title.

**Effort:** Low. Data already exists; UI addition only.

---

### 6.5 Inline Comment Threading Has No Edit/Delete

**Problem.** Users can add inline comments but cannot edit or delete them after submission. The `InlineCommentThread` component only shows comments with a reply action. In a real code review workflow, users frequently need to edit comments.

**Recommendation.** Add Edit (pencil icon) and Delete (trash icon) actions to each comment that the current user authored. These should appear on hover of the comment. Wire to the corresponding `gh` CLI commands.

**Effort:** Medium-high. Requires `gh` API calls for edit/delete.

---

### 6.6 Pop-Out Window Loses Visual Context

**Problem.** Clicking the "Pop Out" button in `PrReviewTab` opens a new Electron window with just the PR review. The new window has no title bar branding, no indication of which repo it's reviewing, and no workspace color. The experience feels disjointed.

**Recommendation.**

- Set the Electron window title to `Code Review — #123 repo-name`.
- Add a thin workspace-color accent bar at the top of the pop-out window.
- Persist the window size and position across sessions.

**Effort:** Low-medium. Mainly Electron window configuration.

---

## 7. Accessibility Audit

| Component                     | Issue                                    | Recommended Fix                                                        |
| ----------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| `AlertBadge`                  | Badge count has no `aria-label`          | `aria-label="3 notifications"`                                         |
| Toast close buttons           | Icon `✕` as accessible text              | `aria-label="Dismiss"` (already added), ensure `role="button"`         |
| `WorkspaceTile`               | No keyboard activation                   | Add `tabIndex={0}` + `onKeyDown` Enter/Space handler                   |
| `ProjectCard`                 | No `role` attribute                      | `role="option"` in a `role="listbox"` parent                           |
| `TabBar` tabs                 | No `role="tab"`                          | Wrap in `role="tablist"`, each tab gets `role="tab"` + `aria-selected` |
| `BranchSwitcher` dropdown     | No `role="listbox"`                      | Add ARIA listbox pattern                                               |
| Settings panel nav            | No `role="navigation"`                   | Add `role="navigation"` to the sidebar nav                             |
| `ConfirmDialog` (to-be-built) | Needs focus trap                         | Use a `FocusTrap` wrapper to prevent Tab-escaping the modal            |
| Color-only status indicators  | Risk dots convey meaning via color alone | Add text label or `aria-label` to every risk dot                       |

---

## 8. Micro-Interaction Polish

### 8.1 Missing Transitions on State Changes

Several state changes are abrupt:

- **Tab activation:** active tab indicator (`::before` pseudo-element for the 2px accent bar) has no `transition`, making tab switches feel instant and harsh. Add `transition: left 0.15s ease, width 0.15s ease` using a sliding indicator approach.
- **Panel open/close:** the projects panel has a `panel-in` animation but no exit animation. Add a matching `panel-out` animation on unmount.
- **Git sidebar:** no entrance animation. Add the same `panel-in` animation that the projects panel uses.

### 8.2 Loading States Are Inconsistent

| Surface                  | Current Loading UX       | Recommended                           |
| ------------------------ | ------------------------ | ------------------------------------- |
| Git sidebar              | Plain text "Loading…"    | Skeleton rows                         |
| Branch switcher dropdown | "Loading branches…" text | Spinner + "Loading branches…"         |
| PR queue                 | "Loading…" text          | Skeleton PR rows (3 placeholder rows) |
| Commit/Push buttons      | No feedback              | Inline spinner, disabled state        |
| Settings load            | "Loading..." plain text  | Spinner                               |

### 8.3 Drag-and-Drop Has No Ghost Image

Native HTML5 drag (`draggable`) renders a default browser ghost (a semi-transparent copy of the entire dragged element). For small tiles and project cards, this default ghost is disproportionate. Set a custom drag image using `dataTransfer.setDragImage()` — a compact version of the card name.

---

## 9. Prioritized Implementation Order

| Priority | Item                                                  | Effort | Impact |
| -------- | ----------------------------------------------------- | ------ | ------ |
| P0       | 2.3 — Replace `window.confirm()` with `ConfirmDialog` | M      | High   |
| P0       | 4.1 — Fix `alert()` in Extensions settings            | S      | High   |
| P0       | 1.4 — Add `:focus-visible` global styles              | S      | High   |
| P1       | 1.1 — Unify CSS token namespace across extension      | M      | High   |
| P1       | 1.2 — Introduce `--font-ui` for sidebar/chrome text   | M      | High   |
| P1       | 2.1 — Improve empty state copy & illustration         | S      | Medium |
| P1       | 5.1 — Improve commit workflow UX                      | M      | High   |
| P1       | 6.1 — Add risk score explanations (tooltips)          | S      | High   |
| P1       | 6.4 — Add per-PR progress bar in review queue         | S      | Medium |
| P2       | 3.3 — Show rename affordance (pencil icon on hover)   | S      | Medium |
| P2       | 3.4 — Tab bar overflow chevrons + fade gradient       | M      | Medium |
| P2       | 5.2 — Custom styled checkboxes in staging area        | S      | Medium |
| P2       | 5.3 — File status badge tooltips                      | S      | Low    |
| P2       | 5.4 — Skeleton loading for git sidebar                | M      | Medium |
| P2       | 6.3 — Fix viewed-file opacity to meet WCAG AA         | S      | Medium |
| P2       | 6.6 — Pop-out window title + accent bar               | M      | Low    |
| P3       | 3.1 — Command palette (Cmd+K)                         | H      | High   |
| P3       | 3.2 — Project search/filter + resizable panel         | M      | Medium |
| P3       | 3.5 — Keyboard navigation in projects panel           | M      | Medium |
| P3       | 4.2 — Unsaved changes guard in settings               | M      | Low    |
| P3       | 4.3 — Real-time field validation in dialogs           | M      | Medium |
| P3       | 6.2 — Keyboard shortcuts in PR review view            | M      | Medium |
| P3       | 6.5 — Edit/delete inline comments                     | H      | Low    |
| P4       | 2.2 — Rail label mode on first launch                 | M      | Low    |
| P4       | 5.5 — Discard confirmation + undo                     | M      | Medium |
| P4       | 5.6 — PR creation dialog improvements                 | H      | Low    |
| P4       | 8.x — Micro-interaction polish pass                   | M      | Low    |

**Effort key:** S = Small (<1 day), M = Medium (1–3 days), H = High (3+ days)

---

## Appendix A: Quick Win Code Snippets

### Replace `window.confirm` (P0)

```tsx
// Before (WorkspaceRail.tsx:106)
if (window.confirm(`Remove workspace "${workspace.name}"…`)) {
  deleteWorkspace(workspace.id)
}

// After
setConfirmOpen({
  title: `Remove workspace "${workspace.name}"?`,
  description: `This will delete all ${projects.length} projects within it.`,
  confirmLabel: 'Remove',
  danger: true,
  onConfirm: () => deleteWorkspace(workspace.id),
})
```

### Global `:focus-visible` (P0)

```css
/* styles.css */
*:focus {
  outline: none;
}
*:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.85);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

### Fix `alert()` in settings (P0)

```tsx
// SettingsPanel.tsx:86 — before
alert(`Failed to install extension: ${installResult.error}`)

// After
addToast({ type: 'error', message: `Failed to install extension: ${installResult.error}` })
```

---

## Clarifications

### Session 2026-05-10

- Q: Where should the `hasSeenWelcome` first-launch flag be stored? → A: Add `ui.hasSeenWelcome: boolean` to the existing `globalSettings` schema in `settings.store.ts`.
- Q: When Settings has unsaved changes and the user clicks ✕ or presses Escape, what happens? → A: Show an inline "You have unsaved changes — Save or Discard" banner at the top of the content area and block close until resolved.
- Q: What color should the global `:focus-visible` ring use? → A: `rgba(255,255,255,0.85)` (white) — exceeds WCAG 2.2 SC 2.4.11 3:1 contrast on all dark background tokens.
- Q: When `ConfirmDialog` is open for a danger action and the user presses Enter, what happens? → A: Focus starts on "Cancel"; Tab cycles between buttons; Enter activates whichever button is focused — user must Tab to reach the danger button.
- Q: What font should the commit message textarea use? → A: `--font-ui` (IBM Plex Sans) — prose reads better in proportional; monospace reserved for diff/code content only.

---

## Appendix B: Accessibility Checklist

Before any release, verify:

- [ ] All interactive elements reachable by Tab key in logical order
- [ ] All color-conveying information also conveyed by text or shape
- [ ] All text meets WCAG AA contrast (4.5:1 for body, 3:1 for large text)
- [ ] All dialogs have a focus trap and return focus on close
- [ ] All images/icons have `alt` or `aria-label`
- [ ] All dynamic content updates announced via `aria-live` regions
- [ ] Screen reader announces toast messages (`aria-live="polite"` — already implemented)
- [ ] `role`, `aria-selected`, `aria-expanded` correct on custom interactive widgets
