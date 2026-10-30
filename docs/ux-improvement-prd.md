# UX Improvement PRD — Terminator

**Version:** 1.0  
**Date:** 2026-05-10  
**Scope:** Core application + git-integration extension  
**Audience:** Engineering, design

---

## Executive Summary

Terminator is an Electron terminal with a strong extension model and a useful git integration. The core interaction model is sound: workspace rail → projects panel → tabbed terminal. This PRD lists where the current implementation falls short of UX best practices. It proposes changes in order of impact. The changes cover six areas: design system cohesion, onboarding & empty states, navigation & discoverability, modal interactions, the git extension, and the PR Review extension.

---

## 1. Design System & Visual Consistency

### 1.1 Dual Token Namespaces

**Problem.** The core app uses `--bg-*` / `--text-*` / `--border-*` CSS variables. The git-integration extension uses a different namespace (`--color-bg`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-accent`) with inline fallback hex values. The two surfaces look different at runtime. The extension's hardcoded fallback colours (`#161b22`, `#e6edf3`, `#8b949e`) differ from the host theme tokens.

**Recommendation.** Use one token namespace as the canonical Extension API contract:

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

Map every git-integration `--color-*` variable to the canonical equivalent. Remove the hardcoded hex fallbacks in extension CSS. Users see no change at runtime. The change stops visual drift when the host theme changes.

**Effort:** Medium. CSS-only, no logic changes.

---

### 1.2 Monospace Font Used as UI Font

**Problem.** `IBM Plex Mono` is the global `font-family` for the entire app, including all sidebar chrome, dialogs, buttons, and settings panels. Monospace fonts have equal-width glyphs. For prose UI text they waste horizontal space and give uneven letter-spacing. The same content looks better in a proportional font.

**Recommendation.** Add a second font token for UI chrome:

```css
--font-ui: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'IBM Plex Mono', 'JetBrains Mono', 'Fira Code', monospace;
```

Apply `--font-ui` to: workspace rail, projects panel, dialogs, settings panel, tab bar labels, toast messages, context menus. Apply `--font-mono` to: terminal pane, diff views, commit message inputs, branch names, file paths, all `<code>` / `<pre>` content. IBM Plex Sans comes from the same foundry as IBM Plex Mono, so the two fonts match visually.

**Effort:** Low-medium. Update `body` and the targeted component selectors.

---

### 1.3 Inconsistent Border Radius Values

**Problem.** `--radius-sm` (6px), `--radius-md` (10px), `--radius-lg` (16px) are defined globally. The git-integration extension uses raw values (4px, 6px, 7px, 8px, 10px) instead of the tokens. Several core components also skip the token. For example, `.ws-tile` uses `var(--radius-md)` but `.tab-bar__close` uses `border-radius: 3px`.

**Recommendation.** Audit all `border-radius` declarations. Replace each raw value with the nearest token. Add `--radius-xs: 4px` for the 3-4px case. Enforce token use with a CSS linting rule.

**Effort:** Low.

---

### 1.4 Focus Visible States Missing

**Problem.** Many interactive elements remove the browser default focus ring (`outline: none`) and add no replacement. Keyboard users who press Tab see no focus indicator. Affected elements: `.proj-card`, `.ws-tile`, `.tab-bar__tab`, `.ctx-menu__item`, `.branch-sw__item`, most buttons in the git extension.

**Recommendation.** Add one `:focus-visible` style that uses white. White exceeds WCAG 2.2 SC 2.4.11 (3:1 focus appearance contrast) on all dark background tokens. Dark-mode developer tools (VS Code, etc.) use the same convention:

```css
:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.85);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

The `:focus-visible` selector shows the ring for keyboard navigation only, not for mouse clicks. Apply the style globally in `styles.css`. No component can override it with `outline: none` unless it adds a substitute.

**Effort:** Low.

---

## 2. Onboarding & Empty States

### 2.1 Empty State Is Confusing

**Problem.** When no project is selected, the main content area shows:

```
⌥
Select or create a project
```

The `⌥` glyph is the macOS Option key symbol. It has no link to "getting started". New users can read it as a keyboard modifier hint. The single line of text gives no next step.

**Recommendation.** Replace it with a structured empty state that guides the user:

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

Show the welcome empty state on first launch only. Store a `ui.hasSeenWelcome: boolean` field in the existing `globalSettings` schema in `settings.store.ts`. Set it to `true` on the first workspace creation or the first project activation. After first use, show a simpler "Select a project" state.

**Effort:** Low.

---

### 2.2 No Guidance for the Workspace Rail

**Problem.** The rail shows colored initials tiles with no labels. First-time users must hover to see workspace names. The `+` add-workspace button at the bottom is a small dashed circle. It has no label, and its tooltip shows only on hover.

**Recommendation.**

- On first launch (no workspaces), show the rail expanded, with the workspace name next to each tile (a "labels visible" mode). Collapse it to icon-only after the user clicks a tile.
- Show the label "New workspace" next to the `+` button until the user creates the first workspace.
- Show the keyboard shortcut `Cmd+1` in the tooltip after the hover delay, for example `My Workspace (Cmd+1)`.

**Effort:** Low-medium.

---

### 2.3 Destructive Confirmations Use `window.confirm()`

**Problem.** "Remove workspace" and "Remove project" both use the native `window.confirm()` dialog. In Electron this is a native OS dialog. It does not match the app, cannot be styled, and gives no context: no icon, no description of the consequences, no undo option.

**Recommendation.** Build a reusable `ConfirmDialog` component with the existing `Dialog.css` infrastructure:

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

The "Remove" button uses `--danger` as its background. Show the count of contained projects so the user sees the scope of the deletion. Workspace deletion and project deletion share this component. Initial focus is on "Cancel". Tab cycles between the buttons. Enter activates the button that has focus. This stops accidental destructive actions from keyboard habits.

**Effort:** Medium. New component. Connect it to both context menu handlers.

---

## 3. Navigation & Discoverability

### 3.1 No Command Palette

**Problem.** Power users of developer tools expect a `Cmd+K` (or `Cmd+P`) command palette. It searches workspaces, projects, and actions with fuzzy matching, and needs no mouse. The current keyboard shortcuts need memorization (`Cmd+1–9` to switch workspace) and no screen shows them.

**Recommendation.** Add a command palette that `Cmd+K` opens:

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

The palette is filterable and keyboard-navigable (arrow keys + Enter). Results include all projects (across all workspaces), all workspaces, and registered extension actions. Register `Cmd+K` in `useKeyboardShortcuts`.

**Effort:** High. New feature. The state management is not trivial.

---

### 3.2 No Project Search / Filter

**Problem.** When a workspace has many projects (>10), the user cannot filter them. The user must scroll and scan by eye. The panel is 248px wide and cannot be resized.

**Recommendation.**

- Add a filter input at the top of the projects panel. It appears when the user presses `Cmd+F` with the panel focused. It is always visible when `projects.length > 6`.
- Let the user drag to resize the projects panel (min 200px, max 400px). Store the width in settings.

**Effort:** Medium.

---

### 3.3 Double-Click to Rename Is Undiscoverable

**Problem.** To rename a project, the user double-clicks the project card name. Nothing shows this: there is no pencil icon and no "click to rename" hint on hover. The context menu "Rename" item is hard to find and needs a right-click.

**Recommendation.**

- On hover over a project card name, show a small pencil icon (✎) to the right of the name. A single click on it starts the rename.
- Keep double-click as an alternative.
- Change the context menu item label to "Rename (double-click)" as a hint.

**Effort:** Low.

---

### 3.4 Tab Bar Overflow Is Invisible

**Problem.** The session sub-tab bar (`tab-bar--sessions`) has `overflow-x: auto` with `scrollbar-height: 0`. When more than ~5 tabs are open, the rightmost tabs disappear with no sign. The user must know to scroll sideways to reach them.

**Recommendation.**

- Show fade gradient overlays at the left and right edges when the tab bar can scroll.
- Add `<` and `>` navigation chevron buttons. They appear when tabs overflow.
- Show the count of hidden tabs in a badge when tabs overflow, for example `+3`.

**Effort:** Medium.

---

### 3.5 No Keyboard Navigation Within Projects Panel

**Problem.** The projects panel works with the mouse only. Users cannot move between projects with the arrow keys or activate one with Enter.

**Recommendation.** Give the projects panel list `role="listbox"` and set `aria-selected` on the active project. Support these keys:

- `↑` / `↓` — move focus between projects
- `Enter` — activate focused project
- `F2` — rename focused project
- `Delete` — confirm-delete focused project

**Effort:** Medium.

---

## 4. Dialog & Modal Improvements

### 4.1 Settings Panel Needs Better Information Architecture

**Problem.** The settings sidebar has one navigation item, "Appearance & Terminal". It controls two separate topics: visual appearance and terminal configuration. The "Extensions" section shows a flat list of installed extensions with enable/disable. It does not say what each extension does, where to find more, or how to install from a registry.

**Recommendation.**

Split "Appearance & Terminal" into two nav items: **Appearance** and **Terminal**. Add a **Keyboard Shortcuts** section: a read-only table of all registered shortcuts, editable in a future iteration. Improve the Extensions section:

```
Extensions
───────────────────────────────
git-integration    v1.1.0   [Enabled]
  Git status sidebar, staging, PR creation, and code review.

[Install from Directory]   [Browse Extension Registry ↗]
```

Each extension item shows its description, version, and status chip. In the "Install from Directory" flow, replace the bare `alert()` failure message with an error toast. The flow now calls `alert()` directly in `SettingsPanel.tsx:86`.

**Effort:** Medium.

---

### 4.2 Settings Modal Has No Unsaved Changes Guard

**Problem.** Some settings fields (default shell, worktree base dir) update only on `onBlur`. If the user clicks ✕ or presses Escape during an edit, the app discards the changes with no warning. No indicator shows unsaved changes.

**Recommendation.** Track a `dirty` state for each settings section. If the user tries to close (✕ or Escape) while a section is dirty, show an inline "You have unsaved changes — Save or Discard" banner at the top of the content area. Block the close until the user saves or discards. Fields that must update at once (theme radio buttons, scrollback limit) apply changes in real time, so they are never dirty.

**Effort:** Medium.

---

### 4.3 Create/Edit Dialogs Lack Field Validation Feedback

**Problem.** Dialog forms (Create Workspace, Create Project) show errors only after submit. They give no real-time validation feedback (for example, folder path not found or name already in use). The rename error is `proj-card__rename-error` at 10px. This is too small to notice.

**Recommendation.**

- Check that the folder path exists on blur, not on submit.
- Make error text at least 11px and add a warning icon (⚠).
- For name fields, check for duplicates on blur, not only on submit.
- Add a character count to name fields, with a max of 50 characters.

**Effort:** Low-medium.

---

## 5. Git Integration Extension

### 5.1 Commit Workflow UX

**Problem.** The commit section is cramped: the textarea has a 52px min-height and the action buttons are tiny. The "Commit" and "Push" buttons have no confirmation state or progress indicator. After a successful commit or push, the only feedback is an optional toast.

**Recommendations.**

- Set the commit message textarea to `min-height: 80px`.
- Change the commit message textarea font to `--font-ui` (IBM Plex Sans). Prose is easier to read in a proportional font, as in Tower, GitKraken, and GitHub.com. Use monospace for diff and code content only.
- Add a character count to the commit message area. It shows the conventional commit length guidance (72-character subject line limit).
- Show an inline spinner on the Commit/Push buttons while the operation runs. Disable the buttons to stop double submission.
- After a successful commit, highlight the button green and animate it back to normal (400ms), then return to the idle state.
- Add a combined "Commit & Push" button as the primary action. Make "Commit" the secondary action.

**Effort:** Low-medium.

---

### 5.2 Staging Area: Native Checkboxes

**Problem.** The staging area uses native `<input type="checkbox">` elements. They use the OS default style. They do not match the rest of the UI, which uses styled custom controls. They look unfinished, especially on macOS, where native checkboxes have rounded corners and a system look.

**Recommendation.** Replace the native checkboxes with custom checkboxes styled in CSS:

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

**Problem.** The staging area shows single-letter badges (`M`, `A`, `D`, `R`, `?`) for file status. Developers who know git understand them. They do not explain themselves, and there is no tooltip or legend.

**Recommendation.**

- Add a `title` attribute tooltip to each badge: `title="Modified"`, `title="Added"`, `title="Deleted"`, etc.
- Consider color-coded words (truncated to fit) instead of single letters for the selected file row. Keep single letters for unselected rows to save space.

**Effort:** Low.

---

### 5.4 Git Sidebar Has No Loading Skeleton

**Problem.** When the git sidebar first opens, it shows `Loading…` as plain text while it fetches git status. The wait has no known length. On slow or large repos the sidebar can look broken.

**Recommendation.** Replace the loading text with an animated skeleton UI that matches the file list structure:

```
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   M
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  M
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓          A
```

Animate it with a shimmer effect: `background: linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)` sliding left to right.

**Effort:** Low-medium.

---

### 5.5 No Undo for Discard Actions

**Problem.** The git extension lets the user discard file changes (unstaging, reverting). These operations destroy data and have no undo. There is no confirmation dialog and no undo option.

**Recommendation.**

- For "Discard changes" on a file: show a confirmation dialog ("Discard changes to `src/foo.ts`? This cannot be undone.") with a cancel option that dismisses itself after 3 seconds.
- For "Unstage all": require confirmation.
- Staging a file needs no confirmation because it destroys nothing.

**Effort:** Medium.

---

### 5.6 PR Creation Dialog Needs Better UX

**Problem.** The PR creation dialog (`PrDialog.tsx`) shows a textarea for the PR description and a basic mode toggle (Write/Preview). It has no draft toggle, reviewers, labels, or milestone fields. The dialog is 560px wide. Its textarea has a fixed size and does not auto-resize.

**Recommendation.**

- Auto-resize the PR body textarea while the user types.
- Add a "Copy link" button after the PR is created. Take the PR URL from the `gh` output.
- Show the branch→base pair, `feat/my-feature → main`, with a dropdown to set the base branch.
- Add a "Recently used PR templates" option for repos that have `.github/PULL_REQUEST_TEMPLATE.md`.

**Effort:** Medium-high.

---

## 6. PR Review Extension

### 6.1 Risk Score Explanation Is Missing

**Problem.** The PR review queue shows risk chips (HIGH / MEDIUM / LOW) and stat cards with numeric values (churn, blast radius, cyclomatic complexity delta). Users cannot learn what the numbers mean or how the app calculates them unless they read the source code.

**Recommendation.**

- Add an information icon (ℹ) next to the stat cards. It opens a popover that explains the scoring algorithm.
- In `RiskBreakdownPanel`, add a one-sentence description under each metric label. The sentence says what the metric measures.
- In the PR queue, the risk chip tooltip states the threshold: `"HIGH: composite score ≥ 70"`.

**Effort:** Low. Documentation and tooltip additions only.

---

### 6.2 Chapter Navigation Is Not Keyboard-Accessible

**Problem.** The `ChapterNav` tab bar needs mouse clicks to switch chapters. The PR review workflow has no keyboard shortcuts for "next chapter" or "previous chapter".

**Recommendation.**

- Register `Cmd+[` and `Cmd+]` as the "previous/next chapter" shortcuts in the PR review view.
- Register `Space` as "mark viewed and advance to next file" in the diff pane.
- Show keyboard shortcut hints on the nav bar buttons on hover.

**Effort:** Medium.

---

### 6.3 Viewed Files Have Insufficient Visual Treatment

**Problem.** Viewed files use `opacity: 0.55` (chapter file list) or `opacity: 0.5` (full file list). On dark backgrounds this lowers the text contrast to about 30% of normal. That is below the WCAG AA minimum of 4.5:1. The style also makes viewed files look broken or unavailable.

**Recommendation.**

- Keep the reduced opacity, but set it to `0.65` or higher.
- Also show the `✓ Viewed` checkmark label (already present) in green.
- Add a strikethrough on the filename as a second indicator. The name stays readable and clearly shows "done".
- Let the user click a viewed file to mark it as un-viewed (toggle the viewed state).

**Effort:** Low.

---

### 6.4 PR Review View Has No Progress Persistence Indicator

**Problem.** The PR review stores progress (review sessions survive restart). The queue view shows no overall progress. A user who returns to a review session cannot see from the queue item how far they got.

**Recommendation.** Add a progress bar or fraction (for example, `12/47 files`) to each PR row in the review queue. Use the existing `viewedFiles` data from the store. Style it as a thin accent-colored progress bar under the PR title.

**Effort:** Low. The data exists. Add the UI only.

---

### 6.5 Inline Comment Threading Has No Edit/Delete

**Problem.** Users can add inline comments but cannot edit or delete them after submission. The `InlineCommentThread` component shows comments with a reply action only. In a real code review, users often need to edit comments.

**Recommendation.** Add Edit (pencil icon) and Delete (trash icon) actions to each comment that the current user wrote. They appear on hover over the comment. Connect them to the matching `gh` CLI commands.

**Effort:** Medium-high. Needs `gh` API calls for edit and delete.

---

### 6.6 Pop-Out Window Loses Visual Context

**Problem.** The "Pop Out" button in `PrReviewTab` opens a new Electron window that holds the PR review only. The new window has no title bar branding, does not show which repo it reviews, and has no workspace color. It looks unconnected to the app.

**Recommendation.**

- Set the Electron window title to `Code Review — #123 repo-name`.
- Add a thin workspace-color accent bar at the top of the pop-out window.
- Store the window size and position across sessions.

**Effort:** Low-medium. Mostly Electron window configuration.

---

## 7. Accessibility Audit

| Component                     | Issue                                 | Recommended Fix                                                        |
| ----------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `AlertBadge`                  | Badge count has no `aria-label`       | `aria-label="3 notifications"`                                         |
| Toast close buttons           | Icon `✕` is the accessible text       | `aria-label="Dismiss"` (already added), set `role="button"`            |
| `WorkspaceTile`               | No keyboard activation                | Add `tabIndex={0}` + `onKeyDown` Enter/Space handler                   |
| `ProjectCard`                 | No `role` attribute                   | `role="option"` in a `role="listbox"` parent                           |
| `TabBar` tabs                 | No `role="tab"`                       | Wrap in `role="tablist"`, each tab gets `role="tab"` + `aria-selected` |
| Settings panel nav            | No `role="navigation"`                | Add `role="navigation"` to the sidebar nav                             |
| `ConfirmDialog` (to-be-built) | Needs a focus trap                    | Use a `FocusTrap` wrapper so Tab cannot leave the modal                |
| Color-only status indicators  | Risk dots show meaning by color alone | Add text label or `aria-label` to every risk dot                       |

---

## 8. Micro-Interaction Polish

### 8.1 Missing Transitions on State Changes

Several state changes happen abruptly:

- **Tab activation:** the active tab indicator (`::before` pseudo-element for the 2px accent bar) has no `transition`, so tab switches look sudden and harsh. Add `transition: left 0.15s ease, width 0.15s ease` with a sliding indicator.
- **Panel open/close:** the projects panel has a `panel-in` animation and no exit animation. Add a matching `panel-out` animation on unmount.
- **Git sidebar:** no entrance animation. Add the `panel-in` animation that the projects panel uses.

### 8.2 Loading States Are Inconsistent

| Surface                  | Current Loading UX       | Recommended                           |
| ------------------------ | ------------------------ | ------------------------------------- |
| Git sidebar              | Plain text "Loading…"    | Skeleton rows                         |
| Branch switcher dropdown | "Loading branches…" text | Spinner + "Loading branches…"         |
| PR queue                 | "Loading…" text          | Skeleton PR rows (3 placeholder rows) |
| Commit/Push buttons      | No feedback              | Inline spinner, disabled state        |
| Settings load            | "Loading..." plain text  | Spinner                               |

### 8.3 Drag-and-Drop Has No Ghost Image

Native HTML5 drag (`draggable`) shows the default browser ghost, a semi-transparent copy of the whole dragged element. For small tiles and project cards this ghost is too large. Set a custom drag image with `dataTransfer.setDragImage()`: a compact version of the card name.

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

- Q: Where does the `hasSeenWelcome` first-launch flag live? → A: Add `ui.hasSeenWelcome: boolean` to the existing `globalSettings` schema in `settings.store.ts`.
- Q: What happens when Settings has unsaved changes and the user clicks ✕ or presses Escape? → A: Show an inline "You have unsaved changes — Save or Discard" banner at the top of the content area. Block the close until the user resolves it.
- Q: What color does the global `:focus-visible` ring use? → A: `rgba(255,255,255,0.85)` (white). It exceeds WCAG 2.2 SC 2.4.11 3:1 contrast on all dark background tokens.
- Q: What happens when the user presses Enter while `ConfirmDialog` is open for a danger action? → A: Focus starts on "Cancel". Tab cycles between the buttons. Enter activates the focused button. The user must press Tab to reach the danger button.
- Q: What font does the commit message textarea use? → A: `--font-ui` (IBM Plex Sans). Prose reads better in a proportional font. Use monospace for diff and code content only.

---

## Appendix B: Accessibility Checklist

Before each release, verify:

- [ ] All interactive elements reachable by Tab key in logical order
- [ ] All color-conveying information also conveyed by text or shape
- [ ] All text meets WCAG AA contrast (4.5:1 for body, 3:1 for large text)
- [ ] All dialogs have a focus trap and return focus on close
- [ ] All images/icons have `alt` or `aria-label`
- [ ] `aria-live` regions announce all dynamic content updates
- [ ] The screen reader announces toast messages (`aria-live="polite"` — already implemented)
- [ ] `role`, `aria-selected`, `aria-expanded` correct on custom interactive widgets
