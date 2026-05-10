# Tasks: UX Improvement PRD

**Input**: Design documents from `specs/003-pr-review/` + `docs/ux-improvement-prd.md`  
**Prerequisites**: plan.md ✅, research.md ✅, data-model.md ✅, contracts/extension-token-api.md ✅

**Tests**: Per the project constitution (Principle VI: TDD is NON-NEGOTIABLE), test tasks are written first and MUST fail before implementation begins. Red → Green → Refactor.

**Organization**: Tasks are grouped by improvement area. P0 (critical fixes) → P1 (design system + git UX) → P2 (core polish) → documentation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[Story]**: Maps to improvement phase (US1=P0 Fixes, US2=Design System, US3=Git UX, US4=Core Polish)

---

## Phase 1: Setup

**Purpose**: Install new dependencies required before any implementation can begin.

- [ ] T001 Install `@fontsource/ibm-plex-sans` in root `package.json` (`npm install @fontsource/ibm-plex-sans`)
- [ ] T002 Install `@testing-library/react` in root `package.json` devDependencies to enable React component unit tests (`npm install --save-dev @testing-library/react`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure that multiple user stories depend on. MUST complete before Phase 3+.

**⚠️ CRITICAL**: No user story implementation can begin until this phase is complete.

- [ ] T003 Add `ui: { hasSeenWelcome: boolean }` field to globalSettings Zod schema and TypeScript types in `src/renderer/stores/settings.store.ts` and `src/main/storage/settings-store.ts` (default: `false`)
- [ ] T004 [P] Write unit tests for `ConfirmDialog` in `tests/unit/ConfirmDialog.spec.tsx` (RED — test: renders title/description, calls `onConfirm` on confirm click, calls `onClose` on cancel click, calls `onClose` on Escape key, initial focus is on Cancel button, danger prop applies danger CSS class to confirm button)
- [ ] T005 Create `ConfirmDialog` component in `src/renderer/components/ConfirmDialog.tsx` (props: `title`, `description?`, `confirmLabel?`, `danger?`, `onConfirm`, `onClose`; initial focus on Cancel via `useEffect` + `ref.focus()`; Escape key listener; reuses `Dialog.css` classes)

**Checkpoint**: `ConfirmDialog` unit tests GREEN. `ui.hasSeenWelcome` field compiles without type errors.

---

## Phase 3: US1 — P0 Critical Fixes (Priority: P0) 🎯 MVP

**Goal**: Eliminate all native browser dialogs and missing focus indicators — the most visible quality regressions in the current app.

**Independent Test**: Right-click a workspace → Remove → a styled in-app dialog appears (not a native OS dialog). Tab through the workspace rail and project list — a white focus ring appears on the focused element. Install an extension from a bad path — a toast error appears (not a native alert).

- [ ] T006 [P] [US1] Replace `window.confirm` in `src/renderer/components/sidebar/WorkspaceRail.tsx:106` with `ConfirmDialog` (title: `Remove workspace "${workspace.name}"?`, description includes project count, danger: true, onConfirm: deleteWorkspace)
- [ ] T007 [P] [US1] Replace `window.confirm` in `src/renderer/components/sidebar/WorkspaceItem.tsx:52` with `ConfirmDialog` (same props pattern as T006)
- [ ] T008 [P] [US1] Replace `window.confirm` in `src/renderer/components/sidebar/ProjectsPanel.tsx:186` with `ConfirmDialog` (title: `Remove project "${project.name}"?`, danger: true, onConfirm: deleteProject)
- [ ] T009 [P] [US1] Replace `window.confirm` in `src/renderer/components/sidebar/ProjectItem.tsx:21` with `ConfirmDialog` (same props pattern as T008)
- [ ] T010 [US1] Replace `alert()` in `src/renderer/components/settings/SettingsPanel.tsx:84` with `addToast({ type: 'error', message: \`Failed to install extension: ${installResult.error}\` })`— import`useToastStore` at top of file
- [ ] T011 [US1] Add global `:focus-visible` rule to `src/renderer/styles.css` after the Reset block: `*:focus { outline: none; } *:focus-visible { outline: 2px solid rgba(255,255,255,0.85); outline-offset: 2px; border-radius: var(--radius-sm); }`
- [ ] T012 [US1] Remove the bare `outline: none` override from `src/renderer/components/settings/SettingsPanel.css:135` (now covered by the global rule in T011)

**Checkpoint**: All 5 `window.confirm` / `alert()` call sites replaced. Tab navigation shows white focus ring on workspace tiles, project cards, tab bar tabs, and settings nav items.

---

## Phase 4: US2 — P1 Design System Foundation (Priority: P1)

**Goal**: Unify the CSS token namespace between the core app and git extension, and introduce IBM Plex Sans for UI chrome text.

**Independent Test**: Open the git sidebar and PR review tab — all text, borders, and backgrounds visually match the core app's dark theme with no jarring hex-colour fallbacks. Sidebar labels (workspace names, project names, tab bar) render in a proportional sans-serif font while terminal content and diffs remain in monospace.

- [ ] T013 [US2] Add `--tm-*` CSS token alias block (all 20 tokens from `contracts/extension-token-api.md`) plus `--radius-xs: 4px` and `--font-ui` token to `:root` in `src/renderer/styles.css`; import IBM Plex Sans weights 400/500/600 in `src/renderer/index.tsx` (`import '@fontsource/ibm-plex-sans/400.css'` etc.); set `body { font-family: var(--font-ui); }` in `src/renderer/styles.css`
- [ ] T014 [P] [US2] Apply `font-family: var(--font-ui)` to sidebar chrome in `src/renderer/components/sidebar/WorkspaceRail.css`, `WorkspaceItem.css`, `ProjectsPanel.css`, `Dialog.css`, and `BranchSwitcher.css` — replace any `font-family: var(--font-mono)` on non-code selectors
- [ ] T015 [P] [US2] Apply `font-family: var(--font-ui)` to `src/renderer/components/terminal/TabBar.css` (tab labels only — not terminal content), `src/renderer/components/settings/SettingsPanel.css`, and `src/renderer/components/ToastContainer.css`
- [ ] T016 [US2] Migrate `extensions/git-integration/src/components/git-integration.css`: replace every `var(--color-*, #hex)` with the corresponding `var(--tm-*)` token per the mapping table in `contracts/extension-token-api.md`; remove all hardcoded hex fallback values; replace raw `border-radius` values (4px, 6px, 7px, 8px) with `var(--tm-radius-xs)` / `var(--tm-radius-sm)` / `var(--tm-radius-md)` tokens
- [ ] T017 [US2] Migrate `extensions/git-integration/src/components/pr-review/pr-review.css`: same replacement pattern as T016 — all `--color-*` → `--tm-*`, remove hardcoded hex fallbacks (including hardcoded `#3fb950`, `#f85149`, `#f0a500` — replace with `--tm-success`, `--tm-danger`, `--tm-warning`)
- [ ] T018 [P] [US2] Update `docs/EXTENSION-DEVELOPMENT.md` with the complete `--tm-*` token contract table and migration guide from `specs/003-pr-review/contracts/extension-token-api.md`
- [ ] T019 [P] [US2] Update `docs/ARCHITECTURE.md` with a "CSS Token Strategy" section describing the `--tm-*` alias layer and the core-private vs extension-public token split

**Checkpoint**: `npm run build:extensions` succeeds. Git sidebar and PR review tab visually match the core theme. Sidebar text renders in IBM Plex Sans (proportional). Terminal and diff text remain in IBM Plex Mono.

---

## Phase 5: US3 — P1/P2 Git Extension UX Improvements (Priority: P1/P2)

**Goal**: Polish the git sidebar and PR review surfaces — skeleton loading, custom checkboxes, status tooltips, commit workflow improvements, and viewed-file contrast fix.

**Independent Test**: Open the git sidebar on a large repo — skeleton rows animate during fetch (no "Loading…" text). Check a file in the staging area — the checkbox shows the accent color. Hover a status badge — a tooltip reads "Modified" / "Added" / etc. Type 73+ characters in the commit message — a character count appears. Open the PR review and mark a file as viewed — it dims to ≥0.65 opacity with a strikethrough and remains readable. Hover a health chip — a tooltip explains the metric.

- [ ] T020 [P] [US3] Write unit test: `GitSidebarPanel` renders `.skeleton--row` elements (not "Loading…" text) when `loading` state is `true`, in `extensions/git-integration/tests/unit/GitSidebarPanel.spec.tsx` (RED)
- [ ] T021 [P] [US3] Write unit test: `StagingArea` file-status badge elements have correct `title` attributes (e.g., `title="Modified"` for `M` badge) in `extensions/git-integration/tests/unit/StagingArea.spec.tsx` (RED)
- [ ] T022 [US3] Add skeleton utility CSS classes to `src/renderer/styles.css`: `.skeleton` (base with shimmer keyframe), `.skeleton--row` (full-width file-row placeholder, 12px height, 70% width), `.skeleton--text-sm`, `.skeleton--text-md`; shimmer animation: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)` sliding left-to-right over 1.4s
- [ ] T023 [US3] Replace "Loading…" text with 5× `.skeleton--row` elements in `extensions/git-integration/src/components/GitSidebarPanel.tsx` when git status is loading; verify T020 goes GREEN
- [ ] T024 [P] [US3] Add custom checkbox styles to `extensions/git-integration/src/components/git-integration.css`: override `.staging-area__checkbox` with `appearance: none`, 14×14px, 1.5px `--tm-border-strong` border, `--tm-bg-input` background; `:checked` state uses `--tm-accent` background + white `✓` via `::after`
- [ ] T025 [P] [US3] Add `title` attributes to each file status badge in `extensions/git-integration/src/components/StagingArea.tsx`: `M`→`"Modified"`, `A`→`"Added"`, `D`→`"Deleted"`, `R`→`"Renamed"`, `C`→`"Copied"`, `U`→`"Untracked"`, `!`→`"Conflicted"`; verify T021 goes GREEN
- [ ] T026 [US3] In `extensions/git-integration/src/components/GitFullView.tsx` commit section: increase `.git-view__commit-message` `min-height` from 52px → 80px in `git-integration.css`; set `font-family: var(--tm-font-ui)` on the textarea; add a character count `<span>` below the textarea that appears when `value.length > 50` and turns amber (`--tm-warning`) when `value.length > 72`
- [ ] T027 [US3] Add loading spinner state to Commit and Push buttons in `extensions/git-integration/src/components/GitFullView.tsx`: track `committing: boolean` state; when true, disable both buttons and replace label with `"⟳ Committing…"` / `"⟳ Pushing…"`; add "Commit & Push" as the primary button and move "Commit" to secondary
- [ ] T028 [P] [US3] Fix viewed-file contrast in `extensions/git-integration/src/components/pr-review/pr-review.css`: change `.chapter-file-row--viewed` opacity from `0.55` → `0.65`; change `.full-file-row--viewed` opacity from `0.5` → `0.65`; add `text-decoration: line-through` to `.chapter-file-name` and `.full-file-row-name` within their respective `--viewed` selectors
- [ ] T029 [P] [US3] Add descriptive `title` attributes to each health chip in `extensions/git-integration/src/components/pr-review/HealthChips.tsx` (e.g., `title="Cyclomatic complexity delta — how much more complex this file is after the change"`, `title="Patch coverage — percentage of changed lines covered by tests"`, etc.)
- [ ] T030 [P] [US3] Add `title` tooltip text to each stat card in `extensions/git-integration/src/components/pr-review/ReviewQueue.tsx` explaining what the metric means and what threshold triggers HIGH/MEDIUM/LOW (e.g., `title="Composite risk score ≥ 70 = HIGH, 40–69 = MEDIUM, < 40 = LOW"`)

**Checkpoint**: Git sidebar skeleton visible during load. Staging area checkboxes render in accent color. File status badges show tooltips. Character count appears in commit textarea. Viewed files show strikethrough at ≥0.65 opacity. Health chip tooltips visible on hover.

---

## Phase 6: US4 — P2 Core UX Polish (Priority: P2)

**Goal**: Replace the confusing empty state, add the rename pencil affordance, and polish the PR review pop-out window.

**Independent Test**: Launch the app with no workspaces — "Welcome to Terminator" empty state with keyboard shortcut table appears. Create a workspace → activate a project → close and reopen — the simpler "Select a project" state appears (welcome state not shown again). Hover a project card name — a pencil icon (✎) appears to its right; single-click it triggers rename mode. Open the PR review pop-out — window title reads "Code Review — #NNN repo-name" with a workspace-color accent bar at the top.

- [ ] T031 [P] [US4] Write unit tests for `EmptyState` in `tests/unit/EmptyState.spec.tsx` (RED — welcome variant renders icon, "Welcome to Terminator" title, keyboard shortcuts table; simple variant renders "Select a project" subtitle; component accepts `actions` prop and renders buttons with shortcut labels)
- [ ] T032 [P] [US4] Create `src/renderer/components/EmptyState.tsx` (props: `icon?`, `title`, `subtitle?`, `actions?: Array<{label, shortcut?, onClick}>`) and `src/renderer/components/EmptyState.css` (centered flex column layout, muted text, shortcut table styles); verify T031 goes GREEN
- [ ] T033 [US4] Replace ad-hoc empty state markup in `src/renderer/App.tsx` with `<EmptyState>`: when `!globalSettings?.ui?.hasSeenWelcome` render welcome variant (icon: `⬡`, title: "Welcome to Terminator", actions: New Tab/Settings/Git Sidebar shortcuts); when `hasSeenWelcome` render simple variant; call `updateGlobalSettings({ ui: { hasSeenWelcome: true } })` on first project activation in the `setActiveProject` effect
- [ ] T034 [P] [US4] Add rename pencil icon CSS to `src/renderer/components/sidebar/ProjectsPanel.css`: `.proj-card__rename-icon` with `opacity: 0`, `transition: opacity 0.1s`, `cursor: pointer`, `color: var(--text-muted)`; `.proj-card:hover .proj-card__rename-icon { opacity: 1; }`
- [ ] T035 [P] [US4] Add pencil icon `<span className="proj-card__rename-icon" onClick={(e) => { e.stopPropagation(); startRename() }}>✎</span>` after `.proj-card__name` in `ProjectCard` within `src/renderer/components/sidebar/ProjectsPanel.tsx`; update context menu label to "Rename (or double-click)"
- [ ] T036 [US4] Set the PR review pop-out window title to `"Code Review — ${repoName}"` in the Electron window creation call in `src/main/index.ts` (or wherever `openPrReview` IPC handler creates the BrowserWindow); extract repo name from the `repoRoot` path argument
- [ ] T037 [P] [US4] Add a 3px workspace-color top accent bar to `src/renderer/PrReviewWindow.tsx`: render a `<div style={{ height: 3, background: wsColor, flexShrink: 0 }} />` at the top of the layout; pass `wsColor` via URL query param from the IPC call or read from the store

**Checkpoint**: Empty state renders correctly for both first-launch and returning users. `hasSeenWelcome` persists across restarts. Pencil icon visible on project card hover. Pop-out window shows correct title and accent bar.

---

## Phase 7: Polish & Documentation

**Purpose**: Documentation updates, lint/build verification, and manual accessibility validation.

- [ ] T038 [P] Update `README.md` tech stack table: add `@fontsource/ibm-plex-sans` under the UI row alongside React 18.x + Zustand
- [ ] T039 Run `npm run lint` from repo root; fix all errors until exit code is 0
- [ ] T040 Run `npm run build:extensions` from repo root; fix any TypeScript compilation errors
- [ ] T041 [P] Verify all new unit tests pass GREEN: `npx vitest run tests/unit/ConfirmDialog.spec.tsx tests/unit/EmptyState.spec.tsx` and `npx vitest run extensions/git-integration/tests/unit/GitSidebarPanel.spec.tsx extensions/git-integration/tests/unit/StagingArea.spec.tsx`
- [ ] T042 Manual accessibility test: Tab through workspace rail → project list → tab bar → settings nav → open ConfirmDialog → Tab between Cancel/Remove; verify white `rgba(255,255,255,0.85)` focus ring visible at each step; verify Escape closes ConfirmDialog and focus returns to trigger element
- [ ] T043 [P] Manual visual regression: side-by-side compare git sidebar and PR review tab before/after token migration; verify no colour drift, no missing borders, no broken backgrounds

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (npm install must complete) — **blocks all user stories**
- **US1 — Phase 3**: Depends on Phase 2 (ConfirmDialog component must exist)
- **US2 — Phase 4**: Depends on Phase 1 (font must be installed) — independent of US1
- **US3 — Phase 5**: Depends on Phase 4 (T013 must add skeleton CSS to styles.css before T022 extends it; T016/T017 token migration should precede T024/T028 CSS additions to extension)
- **US4 — Phase 6**: Depends on Phase 2 (T003 globalSettings schema must exist before T033 reads `hasSeenWelcome`)
- **Polish (Phase 7)**: Depends on all previous phases

### User Story Dependencies

- **US1 (P0)**: Needs Phase 2 complete (ConfirmDialog) — no dependency on US2/US3/US4
- **US2 (P1)**: Needs Phase 1 complete — no dependency on US1/US3/US4
- **US3 (P1/P2)**: Needs US2 complete (token migration must precede CSS additions in extension) — no dependency on US1/US4
- **US4 (P2)**: Needs Phase 2 complete (globalSettings schema) — no dependency on US1/US2/US3

### Within Each Phase

- Test tasks marked [P] (T004, T020, T021, T031) must run FIRST and FAIL before their paired implementation task
- T006–T009 (ConfirmDialog wire-up) are all [P] — no shared file conflicts
- T014, T015 (font application) are [P] — different CSS files
- T024, T025, T028, T029, T030 (git extension UX) are all [P] — different files or non-conflicting selectors
- T034, T035 are [P] — CSS and TSX files are separate
- T036, T037 are [P] — different files

---

## Parallel Execution Examples

### Phase 3 (P0 Fixes) — After T005 complete:

```
Task T006: Wire ConfirmDialog into WorkspaceRail.tsx
Task T007: Wire ConfirmDialog into WorkspaceItem.tsx   [parallel with T006]
Task T008: Wire ConfirmDialog into ProjectsPanel.tsx   [parallel with T006, T007]
Task T009: Wire ConfirmDialog into ProjectItem.tsx     [parallel with T006-T008]
Task T010: Add :focus-visible CSS to styles.css        [parallel with T006-T009]
```

### Phase 5 (Git UX) — Can begin after T017 complete:

```
Task T020: Write GitSidebarPanel skeleton test (RED)
Task T021: Write StagingArea tooltip test (RED)        [parallel with T020]
→ T022: Add skeleton CSS (then T023: implement skeleton, verify T020 GREEN)
Task T024: Custom checkbox CSS                         [parallel with T023]
Task T025: Badge title attributes → T021 GREEN         [parallel with T023, T024]
Task T028: Fix viewed-file opacity                     [parallel with T023-T025]
Task T029: Health chip tooltips                        [parallel with T023-T025, T028]
Task T030: Stat card tooltips                          [parallel with T023-T025, T028, T029]
```

### Phase 6 (Core Polish) — Can begin after T003 complete:

```
Task T031: Write EmptyState unit tests (RED)
Task T032: Create EmptyState component → T031 GREEN    [parallel with other US3 tasks]
Task T034: Pencil icon CSS                             [parallel with T032]
Task T035: Pencil icon TSX                             [parallel with T032]
Task T036: Pop-out window title                        [parallel with T032-T035]
Task T037: Pop-out accent bar                          [parallel with T036]
```

---

## Implementation Strategy

### MVP (US1 Only — P0 Fixes, ~1 day)

1. Phase 1: Setup (T001–T002)
2. Phase 2: Foundational (T003–T005)
3. Phase 3: US1 (T006–T012)
4. **STOP and VALIDATE**: Native dialogs gone, focus ring visible everywhere
5. Ship — immediate quality improvement with zero visual regressions

### Incremental Delivery

1. Setup + Foundational → ConfirmDialog ready
2. US1 (P0) → No more native dialogs or missing focus rings ✅
3. US2 (P1) → Unified design system, IBM Plex Sans ✅
4. US3 (P1/P2) → Polished git extension UX ✅
5. US4 (P2) → Improved empty state and affordances ✅
6. Polish → Lint clean, docs updated, visual regression verified ✅

---

## Notes

- `[P]` tasks touch different files with no shared state — safe to run in parallel
- TDD order is strictly enforced: RED test → implementation → GREEN verification
- CSS-only changes (T011, T013–T017, T022, T024, T028) have no unit tests; verified manually via T042–T043
- After T039 (`npm run lint`), fix any errors before marking T039 done — do not skip
- After T040 (`npm run build:extensions`), fix TypeScript errors before proceeding to Polish
- Commit after each phase checkpoint to preserve a rollback point
