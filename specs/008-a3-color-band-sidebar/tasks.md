# Tasks: A3 Color Band Sidebar

**Input**: Design documents from `specs/008-a3-color-band-sidebar/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ui-components.md ✅

**Tests**: Per the project constitution (Principle VI: TDD is NON-NEGOTIABLE), tests MUST be written before implementation. Write failing tests first — Red → Green → Refactor.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US7 map to spec.md stories)
- All file paths are repository-relative

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: CSS token additions and workspace store field — prerequisites for all component work.

- [x] T001 Add new CSS tokens to `src/renderer/styles.css` (`--sidebar-w: 260px`, `--sidebar-min-w: 200px`, `--sidebar-max-w: 480px`, `--ws-card-radius: 8px`, `--ws-band-w: 3px`, `--session-row-h: 28px`, `--project-row-h: 30px`, `--ws-card-gap: 6px`). Do NOT yet remove `--rail-w`/`--panel-w`.
- [x] T002 Add `collapsedWorkspaceIds: Set<string>` field and `toggleWorkspaceCollapse(id: string): void` action to `src/renderer/stores/workspace.store.ts`. Initialize from `localStorage` key `terminator.workspace.collapsed` (JSON array; try/catch guard). Write back to localStorage in the action.
- [x] T003 Write failing tests for the new `collapsedWorkspaceIds` store behavior in `tests/unit/renderer/stores/workspace.store.spec.ts` — verify initial load from localStorage, toggle adds/removes IDs, localStorage is updated on toggle.

**Checkpoint**: CSS tokens visible in browser devtools; store field exists and tests fail expectedly.

---

## Phase 2: Foundational (Core Atoms — Blocking All User Stories)

**Purpose**: Build the leaf components bottom-up. Each can be built in parallel once Phase 1 is done.

**⚠️ CRITICAL**: No user story integration work can begin until this phase is complete.

### `ScratchSection` (scratch terminal footer)

- [x] T004 [P] Write failing spec `tests/unit/renderer/components/ScratchSection.spec.tsx` — verify: renders scratch session rows, renders "New scratch terminal" add row, calls `onSelectSession` on row click, calls `onNewScratch` on add row click.
- [x] T005 Create `src/renderer/components/sidebar/ScratchSection.tsx` — renders pinned scratch sessions at the bottom of the sidebar. Pass/fail tests from T004.
- [x] T006 Create `src/renderer/components/sidebar/ScratchSection.css` — styled per design: `border-top: 1px solid var(--border)`, `padding: 6px 10px`, muted label text.

### `SessionRow` (leaf row showing a single terminal session)

- [x] T007 [P] Write failing spec `tests/unit/renderer/components/SessionRow.spec.tsx` — verify: renders `$` prefix for human sessions, renders `⟡` for agent sessions, applies `session-row--active` class when `isActive`, calls `onSelect` on click, renders busy spinner when `isBusy`, renders bell badge when `bellCount > 0`.
- [x] T008 Create `src/renderer/components/sidebar/SessionRow.tsx` with props per `contracts/ui-components.md`. Pass/fail tests from T007.
- [x] T009 Create `src/renderer/components/sidebar/SessionRow.css` — height `var(--session-row-h)`, monospace prefix, status indicator atoms (dot, spinner, badge), active state styles.

### `SidebarHeader` (top bar with search + global tab icons)

- [x] T010 [P] Write failing spec `tests/unit/renderer/components/SidebarHeader.spec.tsx` — verify: renders search bar, calls `onSearchFocus` when search bar is clicked, renders one button per `globalTabs` entry, calls `onSelectGlobalTab` with correct ID, renders `+` workspace button and calls `onAddWorkspace`.
- [x] T011 Create `src/renderer/components/sidebar/SidebarHeader.tsx` with props per `contracts/ui-components.md`. Pass/fail tests from T010.
- [x] T012 Create `src/renderer/components/sidebar/SidebarHeader.css` — flex header, search bar style matching design (`bg-elevated`, border, 5px border-radius), icon buttons (`sb-btn` pattern), 8px 9px padding.

**Checkpoint**: All three leaf components render in Storybook/isolation. Tests pass. `npx vitest run --coverage` threshold met for these files.

---

## Phase 3: US1 + US2 — Unified Navigation + Color Identity (Priority: P1) 🎯 MVP

**Goal**: Replace the two-column WorkspaceRail + ProjectsPanel with a single `UnifiedSidebar`. Each workspace card shows its color band.

**Independent Test**: Launch the app. Verify three workspaces appear as color-coded cards in one sidebar column. Click a project row to navigate to it. No WorkspaceRail tile visible.

### Tests

- [x] T013 [P] [US1] Write failing spec `tests/unit/renderer/components/ProjectRow.spec.tsx` — verify: renders project name, applies `project-row--active` class when `isActive`, calls `onSelect` on click, renders sessions when `isExpanded`, calls `onAddSession` on add-session click, applies `--ws-color` inline style.
- [x] T014 [P] [US2] Write failing spec `tests/unit/renderer/components/WorkspaceCard.spec.tsx` — verify: renders workspace name, renders color band element, renders all projects via `ProjectRow`, collapses project list when `isCollapsed`, calls `onToggleCollapse` when header is clicked, sets `--ws-color` CSS variable on root element.
- [x] T015 [P] [US1] Write failing spec `tests/unit/renderer/components/UnifiedSidebar.spec.tsx` — verify: renders all workspaces as `WorkspaceCard` components, passes correct `isCollapsed` state, passes correct `activeProjectId`, renders `SidebarHeader`, renders `ScratchSection` at bottom.

### Implementation

- [x] T016 [P] [US1] Create `src/renderer/components/sidebar/ProjectRow.tsx` with props per `contracts/ui-components.md`. Includes folder icon, project name, right-side badges area. No branch badge yet (Phase 7). Pass/fail tests from T013.
- [x] T017 [P] [US1] Create `src/renderer/components/sidebar/ProjectRow.css` — height `var(--project-row-h)`, active state: `border-left: 2px solid var(--ws-color)` + `rgba(var(--ws-color), 0.14)` bg, hover state, badge area layout.
- [x] T018 [P] [US2] Create `src/renderer/components/sidebar/WorkspaceCard.tsx` with props per `contracts/ui-components.md`. Sets `style={{ '--ws-color': workspace.color }}` on root. Renders color band div, header inner (name + count + chevron), collapsible project list. Pass/fail tests from T014.
- [x] T019 [P] [US2] Create `src/renderer/components/sidebar/WorkspaceCard.css` — card: `border-radius: var(--ws-card-radius)`, `border: 1px solid rgba(from var(--ws-color) r g b / 0.22)`, `background: rgba(from var(--ws-color) r g b / 0.04)`. Band: `width: var(--ws-band-w)`, `background: var(--ws-color)`. Collapsed header layout.
- [x] T020 [US1] Create `src/renderer/components/sidebar/UnifiedSidebar.tsx`. Reads `workspaces`, `activeWorkspaceId`, `projectsByWorkspaceId`, `collapsedWorkspaceIds`, `toggleWorkspaceCollapse` from `useWorkspaceStore`. Reads `activeProjectId`, `setActiveProject`, `setActiveWorkspace` from store. Renders `SidebarHeader` + scrollable workspace card list + `ScratchSection`. Includes resize handle (right edge, mousedown/mousemove/mouseup on document). Applies `unified-sidebar--hidden` when `visible === false`. Pass/fail tests from T015.
- [x] T021 [US1] Create `src/renderer/components/sidebar/UnifiedSidebar.css` — width `var(--sidebar-w)`, min/max constraints, `border-right: 1px solid var(--border)`, `background: var(--bg-surface)`, flex column. Resize handle: `width: 4px`, positioned on right edge, `cursor: col-resize`. Hidden state: `width: 0; min-width: 0; overflow: hidden`. Transition: `width 0.2s ease`.
- [x] T022 [US1] Update `src/renderer/App.tsx` — remove `WorkspaceRail` and `ProjectsPanel` imports; add `UnifiedSidebar` import. Replace `<WorkspaceRail ...>` + `<div className="sidebar-stack"><ProjectsPanel ... /><ScratchPanel .../></div>` with `<UnifiedSidebar visible={sidebarVisible} ... />`. Wire all required props.
- [x] T023 [US1] Update `src/renderer/styles.css` — update `.app-body` to work with single sidebar column (remove `.sidebar-stack` reference, add `--sidebar-w` to layout).
- [x] T024 [P] [US1] Add right-click context menus to `WorkspaceCard` header (Edit / Remove workspace) in `src/renderer/components/sidebar/WorkspaceCard.tsx` — using existing `ctx-menu` / `ctx-menu__item` CSS classes from `WorkspaceRail.css`.
- [x] T024b [P] [US1] Add right-click context menu to `ProjectRow` (Rename / Remove project) in `src/renderer/components/sidebar/ProjectRow.tsx` — reuse `ctx-menu` / `ctx-menu__item` CSS. "Rename" activates inline-edit on the name span. "Remove" calls `deleteProject(project.id)` from `useWorkspaceStore`.

**Checkpoint**: App navigates workspace → project → session via sidebar only. WorkspaceRail icons gone. Color bands visible. Tests pass.

---

## Phase 4: US3 — Session Status at a Glance (Priority: P2)

**Goal**: Session rows in the sidebar show live status indicators: active dot (workspace color), busy spinner, bell badge, idle dim dot.

**Independent Test**: Create two sessions in one project. Run a long command in one session and leave the other idle. The sidebar must show spinner on the busy session and active dot on the focused session — without clicking into them.

### Tests

- [x] T025 [US3] Extend `tests/unit/renderer/components/SessionRow.spec.tsx` — add tests: active indicator uses workspace color CSS var, spinner element exists when `isBusy === true`, bell badge shows correct count when `bellCount > 0`, dim dot when neither active nor busy nor bell.

### Implementation

- [x] T026 [US3] Update `src/renderer/components/sidebar/SessionRow.tsx` — wire `isBusy`, `bellCount`, `workspaceColor`, `isActive` to correct indicator elements. Active dot: `background: var(--ws-color)`. Busy: spinner ring div (CSS animation). Bell: `AlertBadge` component. Idle: dim dot.
- [x] T027 [US3] Update `src/renderer/components/sidebar/SessionRow.css` — add `.session-row__dot` (filled dot, `background: var(--ws-color)`), `.session-row__spinner` (8px ring, `animation: spin 0.8s linear infinite`), `.session-row__bell` (reuse `alert-badge` pattern).
- [x] T028 [US3] Update `src/renderer/components/sidebar/ProjectRow.tsx` — read sessions for this project from `useSessionStore`. Pass `isBusy`, `bellCount`, `isActive` per session to each `SessionRow`. Subscribe to `sessionBusy` and bell state.
- [x] T029 [US3] Add right-click context menu to `SessionRow` in `src/renderer/components/sidebar/SessionRow.tsx` — Rename / Move to project / Close. Reuse `ctx-menu` CSS. "Move to project" opens existing `MoveSessionDialog`.

**Checkpoint**: Status indicators work. `npx vitest run --coverage` passes for `SessionRow.tsx`.

---

## Phase 5: US4 — Sidebar Resize and Persistence (Priority: P2)

**Goal**: Users can drag the right edge of the sidebar to resize it (200px–480px). Width survives app restart. Double-clicking the resize handle snaps to 260px.

**Independent Test**: Drag sidebar to 350px. Close app. Reopen — sidebar is 350px. Double-click handle — sidebar is 260px.

### Tests

- [x] T030 [US4] Extend `tests/unit/renderer/components/UnifiedSidebar.spec.tsx` — test: initial width is read from `localStorage` key `terminator.sidebar.width` (mock `localStorage`), resize handle element exists, width stays within `--sidebar-min-w`/`--sidebar-max-w` bounds (mock mouse events), double-click handle snaps to `260`.

### Implementation

- [x] T031 [US4] Update `src/renderer/components/sidebar/UnifiedSidebar.tsx` — add `mousedown` handler on resize handle that sets up `mousemove` and `mouseup` listeners on `document`. On `mousemove`, update a `widthRef` (not state) and set `sidebar.style.width`. On `mouseup`, clamp to `[200, 480]`, commit to `useState`, write to `localStorage` key `terminator.sidebar.width`. On double-click, set width to `260` (snap applies regardless of current width).
- [x] T032 [US4] Update `src/renderer/components/sidebar/UnifiedSidebar.tsx` — on mount, read `localStorage.getItem('terminator.sidebar.width')` and initialize width state from it (default 260).

**Checkpoint**: Resize works. Width persists. Double-click snaps. Tests pass.

---

## Phase 6: US7 — Workspace Collapse Persistence (Priority: P3)

**Goal**: Collapsed workspace cards persist across app restarts.

**Independent Test**: Collapse two workspace cards. Restart app. Both cards are still collapsed.

### Tests

- [x] T033 [US7] Make T003 tests pass — verify `collapsedWorkspaceIds` initializes from `localStorage`, `toggleWorkspaceCollapse` updates the set and writes localStorage, toggling an already-collapsed ID removes it.
- [x] T034 [US7] Extend `tests/unit/renderer/components/WorkspaceCard.spec.tsx` — test: passes `isCollapsed={true}` hides project list, `isCollapsed={false}` shows project list, `onToggleCollapse` called on header click.

### Implementation

- [x] T035 [US7] Implement `toggleWorkspaceCollapse` in `src/renderer/stores/workspace.store.ts` (make T033 tests pass).
- [x] T036 [US7] Update `src/renderer/components/sidebar/UnifiedSidebar.tsx` — pass `isCollapsed={collapsedWorkspaceIds.has(ws.id)}` and `onToggleCollapse={() => toggleWorkspaceCollapse(ws.id)}` to each `WorkspaceCard`.
- [x] T037 [US7] Update `src/renderer/components/sidebar/WorkspaceCard.tsx` — wire collapse chevron direction (`▸` when collapsed, `▾` when expanded). Add `⌘1–9` keyboard shortcut handling in `UnifiedSidebar` — pressing `⌘N` expands the Nth workspace and collapses all others (update `useKeyboardShortcuts.ts` or wire in `UnifiedSidebar` via `useEffect`).

**Checkpoint**: Collapse/expand toggles work. Restart test passes. Keyboard shortcut ⌘1–⌘9 works.

---

## Phase 7: US5 — Extension Surfaces (Priority: P2)

**Goal**: Git branch badge on project rows, Speckit phase badges, Task Vault count chip on workspace header, extension footer buttons per card. No extension source changes.

**Independent Test**: With git-integration active and a git repo project, expand the project row — branch badge appears. Clicking it opens the Git panel. No WorkspaceRail involved.

### Tests

- [x] T038 [P] [US5] Write failing spec `tests/unit/renderer/components/ExtensionFooter.spec.tsx` — verify: renders one button per `buttons` entry, calls `button.action()` on click, renders nothing when `buttons` is empty, has `border-top` separator when non-empty.
- [x] T039 [P] [US5] Extend `tests/unit/renderer/components/ProjectRow.spec.tsx` — add tests: branch chip renders when `project.gitBranch` provided, chip has `chip-clean` class when `gitDirty === false`, chip has `chip-dirty` class when `gitDirty === true`, chip has `chip-conflict` class when `gitConflict === true`, clicking chip calls `onBranchBadgeClick`.

### Implementation

- [x] T040 [P] [US5] Create `src/renderer/components/sidebar/ExtensionFooter.tsx` with props per `contracts/ui-components.md`. Renders buttons from `SidebarButtonRegistration[]`. Pass/fail tests from T038.
- [x] T041 [P] [US5] Create `src/renderer/components/sidebar/ExtensionFooter.css` — `border-top: 1px solid var(--border)`, `padding: 5px 8px`, flex row, `.ext-btn` (transparent bg, `--text-muted` color, `border-radius: var(--radius-xs)`, hover: `var(--bg-card-hover)`).
- [x] T042 [US5] Update `src/renderer/components/sidebar/WorkspaceCard.tsx` — add `ExtensionFooter` at the bottom of the project list, passing `buttons` from `useExtensionRegistry((s) => s.sidebarButtons)`.
- [x] T043 [US5] Update `src/renderer/components/sidebar/ProjectRow.tsx` — add `gitBranch`, `gitDirty`, `gitConflict`, `onBranchBadgeClick` props. Render branch chip with class `chip-clean` / `chip-dirty` / `chip-conflict` based on state. Clicking chip calls `onBranchBadgeClick`. Add CSS classes to `src/renderer/components/sidebar/ProjectRow.css`: `.chip-conflict { background: rgba(224,92,92,0.12); color: var(--danger); border: 1px solid rgba(224,92,92,0.25); }`.
- [x] T044 [US5] Update `src/renderer/components/sidebar/UnifiedSidebar.tsx` — read git branch state per project from the git extension's store (same source as existing `BranchSwitcher`). Pass `gitBranch`, `gitDirty`, `gitConflict`, `onBranchBadgeClick` (calls `togglePanel('git')`) to `ProjectRow`.
- [x] T045 [US5] Update `src/renderer/components/sidebar/SidebarHeader.tsx` — render non-`hidden` `GlobalTabRegistration` entries as icon buttons, call `onSelectGlobalTab(tab.id)` on click, apply active state for `activeGlobalTabId`. This moves global tab icons from `WorkspaceRail` to sidebar header.
- [ ] T046 [P] [US5] Update `src/renderer/components/sidebar/WorkspaceCard.tsx` — add Task Vault count chip to header. Subscribe to the Task Vault extension's exported Zustand store (the same store it uses to power its own UI, not `pendingNavigations` which is navigation payload). Read the workspace-scoped task count by workspace ID. Render `[📋 N]` chip in header when count > 0; omit when count is 0 or the extension is not registered. Clicking chip calls `onSelectGlobalTab('task-vault')` with workspace filter navigation.
- [ ] T047 [P] [US5] Add Speckit phase badges to `src/renderer/components/sidebar/ProjectRow.tsx` — read speckit phase data for this project from the Speckit extension's exported store. Render phase badge row when a feature is active: `●spec`, `●plan`, `→tasks` with green/blue/grey state. Clicking badge calls `setActiveProjectTab('speckit')`.

**Checkpoint**: All extensions render in new layout. Git badge visible and clickable. Extension footer buttons appear per card. No extension source changes made.

---

## Phase 8: US6 — Sidebar Search (Priority: P3)

**Goal**: Inline fuzzy filter in sidebar. Typing in the search bar hides non-matching sessions, dims non-matching projects, keeps workspace cards visible.

**Independent Test**: With 3+ workspaces and 3+ projects each, type "api" in the search bar — only API-named projects and their sessions remain visible. Press Escape — all restored.

### Tests

- [x] T048 [P] [US6] Write failing spec `tests/unit/renderer/components/SidebarSearch.spec.tsx` — verify: renders input element, calls `onChange` as user types, calls `onClear` on Escape keydown, renders clear button when `query` is non-empty, clear button calls `onClear`.
- [x] T049 [P] [US6] Extend `tests/unit/renderer/components/UnifiedSidebar.spec.tsx` — test: typing a query in search bar dims non-matching project rows, hides non-matching session rows, workspace cards remain visible (not hidden) even when no match.

### Implementation

- [x] T050 [P] [US6] Create `src/renderer/components/sidebar/SidebarSearch.tsx` — controlled input, Escape calls `onClear`, show clear `×` button when `query` non-empty. Pass/fail tests from T048.
- [x] T051 [P] [US6] Create `src/renderer/components/sidebar/SidebarSearch.css` — flex input with search icon, `background: var(--bg-elevated)`, `border: 1px solid var(--border-strong)`, `border-radius: 5px`, `padding: 4px 8px`, `font-size: 10px`.
- [x] T052 [US6] Update `src/renderer/components/sidebar/UnifiedSidebar.tsx` — add `query` state. Replace search bar placeholder in `SidebarHeader` with `<SidebarSearch>`. On `query` change, filter: sessions that don't match `query` are hidden (passed `hidden` prop to `SessionRow`), projects with no matching sessions get `dimmed` class, workspace cards always visible. Add `⌘F` keyboard handler (when sidebar focused): focus the search input.

**Checkpoint**: Search filters inline. Escape clears. `⌘F` activates. Tests pass.

---

## Phase 9: Polish & Animations

**Purpose**: Animated transitions, ⌘B toggle, tooltips for truncated names, drag reorder for session rows.

- [x] T053 [P] Add `⌘B` sidebar toggle: update `useKeyboardShortcuts.ts` or wire in `App.tsx` — `⌘B` calls `setSidebarVisible((v) => !v)`. The `visible` prop on `UnifiedSidebar` already drives the `unified-sidebar--hidden` class + CSS transition (wired in T020/T021).
- [x] T054 [P] Animated collapse/expand for workspace cards in `src/renderer/components/sidebar/WorkspaceCard.css` — add CSS `max-height` transition on `.ws-card__projects` wrapper (`transition: max-height 0.18s cubic-bezier(0.22,1,0.36,1)`). Toggled by class `ws-card--expanded`.
- [x] T055 [P] Hover tooltips for truncated project names and session names — add `title={name}` attributes on `ProjectRow` name span and `SessionRow` name span. No custom tooltip component needed.
- [x] T056 [P] Drag reorder for workspace cards in `UnifiedSidebar` — add native HTML5 drag-and-drop (same pattern as `WorkspaceRail.tsx`: `draggable`, `onDragStart`, `onDragOver`, `onDrop`, `dragIndexRef`) to the workspace card list in `src/renderer/components/sidebar/UnifiedSidebar.tsx`. Call existing `reorderWorkspaces(ids)` store action on drag end. Show drop indicator using `.ws-card--dnd-over` class.
- [x] T056b [P] Drag reorder for project rows within `WorkspaceCard` — add native HTML5 drag-and-drop (same pattern as `ProjectsPanel.tsx` `ProjectList`) to project rows in `src/renderer/components/sidebar/WorkspaceCard.tsx`. Call existing `reorderProjects(workspaceId, ids)` store action on drag end.
- [x] T056c [P] Drag reorder for session rows within `ProjectRow` — add native HTML5 drag-and-drop to session rows in `src/renderer/components/sidebar/ProjectRow.tsx`. Call existing `reorderSessions(projectId, ids)` from `useSessionStore` on drag end.
- [x] T057 [P] Double-click inline rename on `SessionRow` — wire `onDoubleClick` to activate an inline `<input>` replacing the session name span. On blur/Enter, call existing `renameSession` IPC. Pattern mirrors existing `ProjectItem.tsx` rename.
- [x] T058 Run `npm run lint` — fix any lint errors across all new files.
- [x] T059 Run `npx vitest run --coverage` — verify ≥ 80% on all new/modified `.tsx` files. Fix any failing thresholds.

**Checkpoint**: App feels polished. All shortcuts work. No lint errors. Coverage gate met.

---

## Phase 10: Cleanup & Documentation

**Purpose**: Delete dead code, update docs. Phase 4 of the PRD.

- [x] T060 Delete `src/renderer/components/sidebar/WorkspaceRail.tsx`.
- [x] T061 Delete `src/renderer/components/sidebar/WorkspaceRail.css`.
- [x] T062 Delete `src/renderer/components/sidebar/ProjectsPanel.tsx`.
- [x] T063 Delete `src/renderer/components/sidebar/ProjectsPanel.css`.
- [x] T064 Delete `src/renderer/components/sidebar/ScratchPanel.tsx`.
- [x] T065 Delete `src/renderer/components/sidebar/ScratchPanel.css`.
- [x] T066 Remove `--rail-w: 72px` and `--panel-w: 248px` from `src/renderer/styles.css` `:root`.
- [x] T067 Remove `.sidebar-stack` class and its child rules from `src/renderer/styles.css`.
- [x] T068 [P] Remove `WorkspaceRail`, `ProjectsPanel`, `ScratchPanel` imports from `src/renderer/App.tsx`. Ensure no unused imports remain.
- [x] T069 [P] Update `docs/ARCHITECTURE.md` — replace the "Navigation Chrome" section to describe the `UnifiedSidebar` architecture. Remove references to WorkspaceRail and ProjectsPanel. Document the `--ws-color` CSS variable propagation pattern and `collapsedWorkspaceIds` store field.
- [x] T070 [P] Update `README.md` — update navigation description to describe the color band sidebar. Update the "keyboard shortcuts" table with `⌘B` (sidebar toggle) and `⌘F` (sidebar search). Remove references to WorkspaceRail.
- [x] T071 [P] Add ADR `docs/adr/004-a3-color-band-sidebar.md` — document the decision to choose A3 over A1/A2/A4/A5 with the criteria table from the PRD.
- [x] T072 Run `npm run lint` — must pass 0 errors after deletions.
- [x] T073 Run `npx vitest run --coverage` — must pass with all thresholds ≥ 80% after dead code removal.
- [x] T074 Run `npm run typecheck` — must pass 0 TypeScript errors.

**Checkpoint**: All old component files deleted. Docs updated. Zero lint/type errors. Coverage gate met. Feature complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 (T001, T002 complete) — all T004–T012 can run in parallel
- **Phase 3 (US1+US2)**: Depends on Phase 2 complete — BLOCKS Phases 4–8
- **Phase 4 (US3)**: Depends on Phase 3 (SessionRow exists with basic structure)
- **Phase 5 (US4)**: Depends on Phase 3 (UnifiedSidebar exists)
- **Phase 6 (US7)**: Depends on Phase 1 T002 (store field) and Phase 3 (UnifiedSidebar)
- **Phase 7 (US5)**: Depends on Phase 3 complete; T046, T047 can run in parallel
- **Phase 8 (US6)**: Depends on Phase 3 (UnifiedSidebar exists)
- **Phase 9 (Polish)**: Depends on Phases 3–8 complete
- **Phase 10 (Cleanup)**: Depends on Phase 9 complete; deletions (T060–T068) can run in parallel

### User Story Dependencies

- **US1+US2 (P1)**: Foundational phase complete — no story dependencies
- **US3 (P2)**: US1+US2 complete (SessionRow exists as a base)
- **US4 (P2)**: US1+US2 complete (UnifiedSidebar exists)
- **US5 (P2)**: US1+US2 complete (ProjectRow and WorkspaceCard exist as bases)
- **US6 (P3)**: US1+US2 complete (UnifiedSidebar exists for query state)
- **US7 (P3)**: Phase 1 T002 (store field) + US1+US2 (UnifiedSidebar to consume it)

### Within Each User Story Phase (TDD)

1. Write failing tests (Red)
2. Implement component (Green)
3. Pass lint + coverage gate (Refactor)
4. Checkpoint before moving to next phase

### Parallel Opportunities

- All Phase 2 tasks (T004–T012) can run in parallel with each other (different files)
- Within Phase 3: T013–T015 (specs) can run in parallel; T016–T019 can run in parallel; T022–T024 are sequential
- Phase 7: T038–T039 (specs) can run in parallel; T040–T041 can run in parallel; T046–T047 can run in parallel
- Phase 10: All deletions (T060–T068) + documentation (T069–T071) can run in parallel

---

## Parallel Example: Phase 2 (Foundational)

```text
# After Phase 1 is complete, launch all Phase 2 tasks simultaneously:

[P] T004 + T005 + T006  →  ScratchSection (spec + impl + CSS)
[P] T007 + T008 + T009  →  SessionRow (spec + impl + CSS)
[P] T010 + T011 + T012  →  SidebarHeader (spec + impl + CSS)
```

## Parallel Example: Phase 7 (US5 Extension Surfaces)

```text
[P] T038  →  ExtensionFooter.spec.tsx (failing tests)
[P] T039  →  ProjectRow.spec.tsx extension additions (failing tests)
    ↓ (when T038 done)
[P] T040 + T041  →  ExtensionFooter.tsx + .css
    ↓ (when T039 done)
[P] T043  →  ProjectRow.tsx branch badge
[P] T046  →  WorkspaceCard.tsx task vault chip
[P] T047  →  ProjectRow.tsx speckit badges
```

---

## Implementation Strategy

### MVP Scope (Phase 3 only — deliverable after T024)

1. Complete Phase 1: CSS tokens + store field
2. Complete Phase 2: ScratchSection, SessionRow, SidebarHeader (leaf atoms)
3. Complete Phase 3: ProjectRow, WorkspaceCard, UnifiedSidebar, App.tsx swap

→ **Working sidebar replacing WorkspaceRail + ProjectsPanel. Navigate workspace → project → session. Color bands visible.**

### Incremental Delivery

1. MVP (Phase 3) → functional navigation ✅
2. Add Phase 4 (US3) → session status indicators ✅
3. Add Phase 5 (US4) → resize + persistence ✅
4. Add Phase 6 (US7) → collapse persistence ✅
5. Add Phase 7 (US5) → extension surfaces ✅
6. Add Phase 8 (US6) → search ✅
7. Add Phase 9 → polish ✅
8. Phase 10 → cleanup + docs → **PR ready** ✅

---

## Notes

- `[P]` tasks operate on different files — no file conflicts
- `[US?]` labels map directly to user stories in `specs/008-a3-color-band-sidebar/spec.md`
- All new component specs go in `tests/unit/renderer/components/`
- CSS files do not need separate test tasks (mocked globally in `tests/setup.ts`)
- Do not edit `extensions/*/src/index.js` — extension source is unchanged through Phase 7
- Commit after each phase checkpoint (or use `/speckit-git-commit`)
- `WorkspaceItem.css`, `ProjectItem.css`, `Sidebar.css` are already fixed for undefined CSS vars (done in `/speckit-specify`) — no further action needed; they'll be deleted in Phase 10 alongside their parent components
