# Feature Specification: A3 Color Band Sidebar

**Feature Branch**: `ux-terminal-navigation-redesign`
**Created**: 2026-06-13
**Status**: Draft
**Input**: PRD `terminator-a3-prd.md` + design references `terminator-a3-design.html`, `terminator-a3-extensions.html`

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 — Unified Navigation (Priority: P1)

A developer with three workspaces (Backend, Frontend, Personal) wants to switch from the Backend API Service project to the Frontend Dashboard project without touching a workspace switcher rail, a projects panel, and a tab bar separately. In the new design, a single sidebar shows all workspaces as color-coded cards. The developer clicks the Frontend workspace card to expand it and clicks the Dashboard project row — that project's sessions appear inline immediately.

**Why this priority**: Collapsing three separate navigation surfaces into one is the core value proposition of this redesign. Without it, nothing else matters.

**Independent Test**: Can be fully tested with a fresh app instance that has at least two workspaces, each with at least one project. Navigate between projects across workspaces and verify that one click on a project row both selects the project and reveals its sessions — without any intermediate steps.

**Acceptance Scenarios**:

1. **Given** the sidebar shows three workspace cards with the Backend card expanded, **When** the user clicks the Frontend workspace card header, **Then** the Frontend card expands (showing its projects), and the Backend card collapses — all in the same sidebar column.

2. **Given** the Frontend card is expanded and shows three projects, **When** the user clicks the Dashboard project row, **Then** Dashboard becomes the active project, its sessions appear inline below the row, and the terminal area shows the active Dashboard session.

3. **Given** the user has navigated via the sidebar, **When** they restart the app, **Then** the previously active workspace, project, and session are restored.

---

### User Story 2 — Workspace Color Identity (Priority: P1)

A developer who has assigned distinct colors to each workspace (blue for Backend, green for Frontend, amber for Personal) needs to recognize which workspace a project belongs to at a glance, without reading the text.

**Why this priority**: The color band is the distinguishing feature of A3 over A1/A2/A4. If the color signal doesn't work, the entire design rationale collapses.

**Independent Test**: Can be tested in isolation by visually inspecting the sidebar with multiple workspaces. No click interaction required — the test is purely visual: each workspace card must display its configured color as a 3px left band and a matching tinted background/border, distinctly different from other workspace cards.

**Acceptance Scenarios**:

1. **Given** a workspace with color `#5c6bc0` (blue), **When** its card is rendered, **Then** the left band is solid blue, the card border is `rgba(#5c6bc0, 0.22)`, and the card background is `rgba(#5c6bc0, 0.04)`.

2. **Given** a workspace with color `#4ade80` (green) and one with color `#f59e0b` (amber), **When** both cards are visible in the sidebar, **Then** each card has visually distinct color bands with no color bleed between cards.

3. **Given** the active project belongs to the blue workspace, **When** its project row is rendered expanded, **Then** the project row has a `2px solid #5c6bc0` left border and `rgba(#5c6bc0, 0.14)` background.

---

### User Story 3 — Session Status at a Glance (Priority: P2)

A developer running multiple terminal sessions in the same project (a `zsh` shell and `npm run dev`) wants to see which session is active and which is busy without opening each one.

**Why this priority**: Replaces the tab bar's session-switching responsibility for within-project navigation. Users need session status to be as visible in the sidebar as it was in the tab bar.

**Independent Test**: Can be tested independently by creating two sessions in one project: leave one idle, type a long-running command in the other. The sidebar session rows must show the correct status indicators for each without clicking into the sessions.

**Acceptance Scenarios**:

1. **Given** a project has a `zsh` session (active/focused) and a `npm run dev` session (busy), **When** the project is expanded in the sidebar, **Then** the `zsh` row shows a filled blue dot on the right and the `npm run dev` row shows an animated spinning ring.

2. **Given** a session produces a terminal bell, **When** the user is viewing a different session, **Then** the session row shows a red badge with the unread count.

3. **Given** a session is idle (no recent output), **When** it is not focused, **Then** its row shows a dim dot indicator (no color fill).

---

### User Story 4 — Sidebar Resize and Persistence (Priority: P2)

A developer on a wide monitor wants to expand the sidebar to see full project names, while a developer on a 13" screen wants to compress it.

**Why this priority**: The sidebar is now the only navigation column. Its width directly affects the reading area for terminal content.

**Independent Test**: Drag the sidebar resize handle to 350px. Close and reopen the app. The sidebar must open at 350px without any additional interaction.

**Acceptance Scenarios**:

1. **Given** the sidebar is at its default 260px width, **When** the user drags the resize handle rightward to 350px, **Then** the sidebar reflows to 350px and the main content area shrinks correspondingly.

2. **Given** the sidebar has been resized to 350px, **When** the app is restarted, **Then** the sidebar opens at 350px (persisted in localStorage).

3. **Given** the user drags the resize handle past the minimum (200px) or maximum (480px) bounds, **Then** the sidebar clamps to the respective limit and does not collapse the content area beyond a usable width.

4. **Given** the sidebar is at any width within 20px of the default 260px, **When** the user double-clicks the resize handle, **Then** the sidebar snaps to exactly 260px.

---

### User Story 5 — Extension Surfaces in the Sidebar (Priority: P2)

A developer using the Git integration wants to see the current branch for each project at a glance and open the Git panel from the project row — not from a separate workspace rail button.

**Why this priority**: Extensions must integrate naturally into A3. If extensions still require the old rail-based triggers, the redesign is incomplete and the extension UX regresses.

**Independent Test**: With the git-integration extension active and a git repo-linked project, expand that project's row in the sidebar. Verify the branch badge appears on the project row and clicking it opens the Git panel — without touching the WorkspaceRail (which no longer exists).

**Acceptance Scenarios**:

1. **Given** a project is linked to a git repo on branch `main` with no uncommitted changes, **When** the project row is rendered in the sidebar, **Then** a green `main` chip is visible to the right of the project name on the project row.

2. **Given** a project has uncommitted changes, **When** the project row is rendered, **Then** the branch chip turns amber and shows the branch name (e.g., `feat/login`).

3. **Given** a project has merge conflicts, **When** the project row is rendered, **Then** the branch chip turns red.

4. **Given** the user clicks the branch chip on any project row, **When** the click registers, **Then** the Git panel slides in from the right (identical to the current `⌘⇧G` behaviour).

5. **Given** the Speckit extension has an active feature in phase "tasks", **When** the project row is rendered, **Then** phase badges `[●spec][●plan][→tasks]` appear on the project row — green for complete phases, blue for in-progress.

6. **Given** Task Vault has 3 open tasks for the Backend workspace, **When** the Backend workspace card header is rendered, **Then** a `[📋 3]` chip is visible in the card header row.

---

### User Story 6 — Sidebar Search (Priority: P3)

A developer with 12 projects spread across 4 workspaces wants to jump to a specific session without scrolling through all cards.

**Why this priority**: Search is a convenience feature, not core navigation. The sidebar remains usable without it. It is a Phase 3 item in the implementation plan.

**Independent Test**: With at least 3 workspaces and 3 projects each, open the sidebar search by clicking the search bar or pressing `⌘F` while sidebar is focused. Type the first three letters of a project name. All non-matching projects must dim and all non-matching sessions must hide.

**Acceptance Scenarios**:

1. **Given** the sidebar is visible, **When** the user clicks the search bar, **Then** an inline text input activates within the search bar (no overlay or new panel).

2. **Given** the user types "api" in the search bar, **When** there is a project named "API Service" across any workspace, **Then** the API Service project row is highlighted, all other projects are dimmed, workspace cards remain visible (not hidden), and non-matching sessions are hidden.

3. **Given** the search bar has text, **When** the user presses Escape, **Then** the search bar clears and all workspace cards return to their normal visibility.

---

### User Story 7 — Workspace Collapse Persistence (Priority: P3)

A developer who keeps only the Backend workspace expanded (and collapses Frontend and Personal) expects those workspaces to remain collapsed across app restarts.

**Why this priority**: This is a quality-of-life refinement on top of the core navigation. It eliminates "re-collapsing" work after restarting the app.

**Independent Test**: Collapse two workspace cards by clicking their headers. Restart the app. The two cards must remain collapsed — only their header row visible.

**Acceptance Scenarios**:

1. **Given** the user clicks a workspace card header to collapse it, **When** the app is restarted, **Then** that workspace card opens in the collapsed state.

2. **Given** a workspace is collapsed (shows header + session count only), **When** the user presses `⌘2` (that workspace's position), **Then** the workspace expands, scrolls into view, and collapses any previously expanded workspace.

---

### Edge Cases

- What happens when a workspace has no projects? The workspace card shows only the header row and a "New project" row inside — no crash, no empty space anomaly.
- What happens if a workspace color is `null` or `undefined`? The card falls back to `var(--accent)` (`#5c6bc0`) for the band color and no tint for background/border.
- What happens when a project name is very long (>40 characters)? The name is truncated with an ellipsis at the project row's available width; hovering shows a tooltip with the full name.
- What happens when all sessions in a project are closed? The project row remains expanded but shows only the "New session" add-row; the terminal area transitions to the EmptyState for that project.
- What happens during drag-reorder when the sidebar is narrower than 220px? The drag handle remains grabbable; only the preview label truncates.
- What happens when `⌘B` is pressed to hide the sidebar? The sidebar collapses to 0 width with a smooth animation, and the main content area expands to fill the full window. Pressing `⌘B` again restores the sidebar at its last saved width.

---

## Requirements _(mandatory)_

### Functional Requirements

**Navigation Structure**

- **FR-001**: The app MUST replace the `WorkspaceRail` (72px) and `ProjectsPanel` (248px) with a single `UnifiedSidebar` (default 260px) that contains all workspace, project, and session navigation.
- **FR-002**: The `UnifiedSidebar` MUST render each workspace as a `WorkspaceCard` containing project rows and inline session rows.
- **FR-003**: The `UnifiedSidebar` MUST be resizable by dragging a handle on its right edge, with a minimum width of 200px and a maximum of 480px.
- **FR-004**: The sidebar width MUST persist across sessions via `localStorage` key `terminator.sidebar.width`.
- **FR-005**: Double-clicking the resize handle MUST snap the sidebar to the default 260px when within 20px of default.
- **FR-006**: The `UnifiedSidebar` MUST support `⌘B` to toggle visibility (collapse to 0 / restore) with a CSS transition.

**Workspace Cards**

- **FR-007**: Each `WorkspaceCard` MUST display a 3px color band on its left edge using the workspace's configured `color` hex value.
- **FR-008**: Each `WorkspaceCard` MUST apply `rgba(workspaceColor, 0.22)` border and `rgba(workspaceColor, 0.04)` background using the CSS custom property `--ws-color` set via inline style.
- **FR-009**: Clicking a workspace card header MUST toggle the card's collapsed/expanded state.
- **FR-010**: Collapsed workspace cards MUST show only the header row (workspace name + session count + chevron).
- **FR-011**: Each workspace's collapsed/expanded state MUST persist in `workspaceStore.collapsedWorkspaceIds: Set<string>` and restore on app restart.
- **FR-012**: Workspace cards MUST support drag-reorder (preserving existing `reorderWorkspaces` store behaviour).

**Project Rows**

- **FR-013**: Each project MUST render as a `ProjectRow` inside its workspace card.
- **FR-014**: Clicking a `ProjectRow` MUST set that project as active and expand it inline to show its session rows (collapsing any previously expanded project in the same workspace card).
- **FR-015**: The active project's row MUST have a `2px solid var(--ws-color)` left border and `rgba(var(--ws-color), 0.14)` background.
- **FR-016**: Project rows MUST support drag-reorder within their workspace card.
- **FR-017**: Right-clicking a project row MUST show the existing context menu (Rename / Remove).
- **FR-018**: Double-clicking a session row MUST activate inline rename for that session.

**Session Rows**

- **FR-019**: Session rows MUST be indented under the expanded project and show: prefix (`$` for human, `⟡` for agent), session title (truncated at available width), and status indicator.
- **FR-020**: Status indicators MUST be: filled dot in workspace color (active/focused), animated spinner ring (busy), red bell badge with count (unread), dim dot (idle).
- **FR-021**: Clicking a session row MUST set it as the active session for that project.
- **FR-022**: Session rows MUST support drag-reorder within the project.

**Sidebar Header**

- **FR-023**: The sidebar header MUST contain: a search bar (activates fuzzy filter on click or `⌘F`), an Overview icon button, and a New Workspace icon button.
- **FR-024**: Global tab icons registered via `registerGlobalTab()` MUST appear in the sidebar header row (moved from WorkspaceRail).
- **FR-025**: Extension sidebar buttons registered via `registerSidebarButton()` MUST render in an `ExtensionFooter` section at the bottom of each workspace card (moved from ProjectsPanel footer).

**Extension Integration — Git**

- **FR-026**: Each project row for a git-linked project MUST display a branch chip inline: green with clean branch name, amber when dirty, red when conflicts.
- **FR-027**: Clicking the branch chip MUST open the Git sidebar panel (same as `⌘⇧G`).
- **FR-028**: The Git project tab in the tab bar MUST remain unchanged.

**Extension Integration — Speckit**

- **FR-029**: When a Speckit feature is active for a project, phase badges MUST appear on that project's row: `●` green = done, `→` blue = in-progress, `○` grey = locked.
- **FR-030**: Clicking a phase badge MUST open the Speckit project tab.

**Extension Integration — Task Vault**

- **FR-031**: When Task Vault has open tasks for a workspace, a task count chip MUST appear in that workspace card's header row.
- **FR-032**: Clicking the task count chip MUST open the Task Vault global tab filtered to that workspace.

**Search**

- **FR-033**: The sidebar search MUST perform a fuzzy filter: non-matching sessions hide, non-matching projects dim, workspace cards remain visible.
- **FR-034**: Pressing Escape while the search bar has focus MUST clear the filter.
- **FR-035**: `⌘K` (global quickswitcher command palette) MUST continue to work as a separate overlay; sidebar search is scoped only to sidebar items.

**CSS / Tokens**

- **FR-036**: The CSS custom properties `--rail-w` (72px) and `--panel-w` (248px) MUST be removed and replaced with `--sidebar-w: 260px`, `--sidebar-min-w: 200px`, `--sidebar-max-w: 480px`.
- **FR-037**: All CSS that references `--rail-w` or `--panel-w` MUST be updated or removed.
- **FR-038**: Workspace color theming MUST propagate via `style={{ '--ws-color': workspace.color }}` on each `WorkspaceCard`, inherited by all child elements.

**Keyboard Shortcuts**

- **FR-039**: `⌘1`–`⌘9` MUST expand/highlight the nth workspace card (counting from top) rather than selecting a rail icon.
- **FR-040**: `⌘F` (when sidebar has focus) MUST activate the sidebar search input.
- **FR-041**: `⌘B` MUST toggle sidebar visibility.
- **FR-042**: All other existing keyboard shortcuts (`⌘⇧G`, `⌘T`, `⌘,`, `⌘⇧L`, `⌘⇧I`, `⌘⇧T`, `⌘K`) MUST remain unchanged.

**Component Lifecycle**

- **FR-043**: The following components MUST be created: `UnifiedSidebar`, `WorkspaceCard`, `ProjectRow`, `SessionRow`, `SidebarHeader`, `SidebarSearch`, `ExtensionFooter`.
- **FR-044**: The following components MUST be removed after Phase 4: `WorkspaceRail`, `ProjectsPanel`, `ScratchPanel` (replaced by `ScratchSection` at the bottom of `UnifiedSidebar`).
- **FR-045**: `App.tsx` MUST replace `<WorkspaceRail>` + `<ProjectsPanel>` with `<UnifiedSidebar>`.

**Data Model**

- **FR-046**: The workspace store MUST add `collapsedWorkspaceIds: Set<string>` and a `toggleWorkspaceCollapse(id: string): void` action.
- **FR-047**: No changes to the Workspace, Project, or Session data types are required.

**Extension API**

- **FR-048**: All four extension registration APIs (`registerGlobalTab`, `registerProjectTab`, `registerSidebarPanel`, `registerSidebarButton`) MUST remain functional with no breaking changes.
- **FR-049**: No changes to extension `activate()` functions or IPC channels are required.

**Quality Gates**

- **FR-050**: `npm run lint` MUST pass with 0 errors after all phases.
- **FR-051**: `npx vitest run --coverage` MUST pass with ≥80% coverage on all new files.
- **FR-052**: All existing tests MUST continue to pass.

---

### Key Entities

- **UnifiedSidebar**: The single resizable navigation column (200–480px). Contains the header row and a scrollable list of workspace cards. Replaces `WorkspaceRail` + `ProjectsPanel`.
- **WorkspaceCard**: A rounded card representing one workspace. Has a color band, collapsible project list, and an extension footer. Identified by workspace ID.
- **ProjectRow**: A row within a workspace card representing one project. Shows name, branch chip, extension badges, and expands to reveal session rows when active.
- **SessionRow**: An indented row under an expanded project. Shows session prefix, title, and real-time status indicator.
- **SidebarHeader**: Fixed header within the sidebar containing the search bar and global action icon buttons.
- **ExtensionFooter**: Per-workspace-card footer row containing `registerSidebarButton()` entries contributed by extensions.
- **ScratchSection**: A pinned row at the bottom of the sidebar for scratch terminal sessions (replaces `ScratchPanel`).

---

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users reach any session in 1 click from the sidebar (workspace expanded) or 2 clicks (workspace collapsed → project click), compared to the current minimum of 3 separate interaction surfaces.
- **SC-002**: The sidebar column occupies 260px by default, compared to the previous combined width of 320px (72px rail + 248px panel) — a 19% reduction in navigation chrome at default settings.
- **SC-003**: All existing keyboard shortcuts and context menus work without regression — 0 keyboard shortcut breakages measured by running the full test suite.
- **SC-004**: No extension source code requires modification — all 4 extensions (Git, Speckit, Task Vault, and future extensions) render correctly in the new layout purely via renderer-side mapping changes.
- **SC-005**: Code coverage on all new component files (`UnifiedSidebar`, `WorkspaceCard`, `ProjectRow`, `SessionRow`, `SidebarHeader`, `SidebarSearch`, `ExtensionFooter`) reaches ≥80% on statements, branches, functions, and lines at merge.
- **SC-006**: Sidebar width changes persist: reopening the app after resizing the sidebar shows the correct saved width 100% of the time.
- **SC-007**: Workspace collapsed state persists: after collapsing a workspace and restarting the app, the card opens collapsed 100% of the time.

---

## Assumptions

- The workspace `color` field already exists as a hex string in the workspace data model; no schema migration is needed.
- The Workspace → Project → Session hierarchy in `workspaceStore` and `sessionStore` is unchanged; only the UI layout changes.
- The CSS custom property `--ws-color` propagation mechanism already exists in the codebase and can be inherited by the new components.
- `registerSidebarButton()` data is already available in the extension registry at render time; no new IPC calls are needed to surface it in the `ExtensionFooter`.
- The Git extension's branch status data (branch name, dirty flag, conflict flag) is already read from the same store that drives the existing `ProjectItem` branch display; `ProjectRow` can consume the same data.
- Speckit phase data (spec/plan/tasks status per project) is already published to a store that the renderer can subscribe to; no new IPC channel is needed.
- Task Vault workspace task counts are already available in the Task Vault store; the `WorkspaceCard` header can subscribe to that count reactively.
- Drag-reorder for workspaces and projects uses the existing `@dnd-kit/core` library already present in the project; session drag-reorder uses the same library.
- `localStorage` is available in the Electron renderer process for sidebar width persistence.
- The `ScratchPanel` is moved into the bottom of `UnifiedSidebar` as `ScratchSection`; its behaviour (showing scratch sessions, creating a new scratch session) is unchanged.
- Phase 1 of implementation can be completed without any changes to extension source files; extensions are only affected in Phase 2, which is also renderer-only.
