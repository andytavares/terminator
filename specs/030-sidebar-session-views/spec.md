# Feature Specification: Sidebar Session Views

**Feature Branch**: `030-sidebar-session-views`

**Created**: 2026-08-21

**Status**: Planned (amended 2026-08-21 by Phase 0 research and the `/speckit-analyze` pass — see FR-028, FR-028a, FR-030, FR-037, SC-004)

**Input**: User description: `~/Desktop/terminator-ux-research/PLAN.md` — "Implementation plan — Proposal A (Views) + stale-session filter": replace the fixed Workspace → Project → Session sidebar tree with a flat session list driven by a view model (grouping predicate + sort key + filter chain), add a stale-session filter with bulk cleanup, and preserve every extension surface that exists today.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See every session at a glance (Priority: P1)

A user returning to the app after a break opens the sidebar and immediately sees every one of their sessions in one list, each showing what state it is in and how recently it did anything — without expanding anything. The list is grouped by workspace by default (amended 2026-08-25 — originally by project — with each project nested under its workspace), so the positional information the old tree carried is still there, but nothing is hidden behind a collapsed header.

**Why this priority**: This is the core complaint. Today all sessions sit behind collapsed workspace headers with no recency information, so a user with 20+ sessions cannot tell which ones matter without clicking through the tree. Every other story in this feature builds on the flat list.

**Independent Test**: Create multiple workspaces, projects, and sessions; open the app; confirm all sessions are visible on first paint, each with a status indicator and a last-activity time, grouped under their project.

**Acceptance Scenarios**:

1. **Given** 22 sessions spread across 4 workspaces, **When** the user opens the app, **Then** all 22 sessions are visible in the sidebar without the user expanding anything.
2. **Given** a session that produced output 5 minutes ago, **When** the user looks at its row, **Then** the row shows a relative last-activity time ("5m") and an idle status.
3. **Given** a session whose underlying process is producing output, **When** the user looks at its row, **Then** the row shows a working status.
4. **Given** a session that is waiting on the user, **When** the user looks at its row, **Then** the row is marked as needing attention by a non-colour-only cue (an edge marker plus a text label), and the marking is distinguishable without relying on hue.
5. **Given** the list is grouped by project, **When** the user selects any session, **Then** the session opens and the rest of the app (project-scoped tabs and panels) resolves to that session's project.

---

### User Story 2 - Every extension action stays reachable (Priority: P1)

A user who has SpecKit Pilot, Git Integration, and other extensions installed can still reach every action those extensions contribute — global buttons, workspace-scoped buttons, sidebar items, and project tabs — no matter how the session list is grouped.

**Why this priority**: Flattening the sidebar removes the host element that the workspace-scoped surface is attached to, and the sidebar-item surface has never had a working host at all. If they are lost the feature is a regression, not an improvement. This story is the acceptance gate for the whole feature.

**Independent Test**: With SpecKit Pilot and Git Integration installed, switch the list through every available grouping and confirm each contributed action is present and fires.

**Acceptance Scenarios**:

1. **Given** any grouping mode, **When** the user looks at the sidebar header, **Then** globally contributed buttons are present and clickable, unchanged from before this feature.
2. **Given** the list is grouped by project or workspace, **When** the user hovers a group header, **Then** the workspace-scoped extension buttons (e.g. SpecKit Pilot, Code Reviews) appear on that header and open their surfaces.
3. **Given** the list is grouped by something that is not a scope (status, branch, or nothing), **When** the user opens the scope affordance on any session row, **Then** the same workspace- and project-scoped actions are offered and work identically.
4. **Given** any grouping mode, **When** the user looks at the sidebar footer, **Then** each extension-contributed sidebar item appears exactly once, and clicking it performs the extension's action.
5. **Given** a session is selected under any grouping mode, **When** the user looks at the main tab bar, **Then** project-scoped extension tabs resolve for that session's project.

---

### User Story 3 - Find and clean up abandoned sessions (Priority: P2)

A user whose session list has accumulated over weeks switches to a "Stale" view, sees only the sessions that have been abandoned or have exited, selects several at once, and closes them in one action — including removing the on-disk worktree for sessions whose project is a worktree.

**Why this priority**: Cleanup is what keeps the flat list usable over time. It depends on the activity tracking from Story 1 but delivers value on its own.

**Independent Test**: Create sessions with varying last-activity times and states, open the Stale view, confirm the correct set is listed, multi-select and bulk close, and confirm the sessions and any worktrees are gone.

**Acceptance Scenarios**:

1. **Given** a session with no activity for longer than the staleness threshold, **When** the user opens the Stale view, **Then** the session is listed.
2. **Given** a session that is waiting on the user, **When** any amount of time passes, **Then** the session is never listed as stale.
3. **Given** a session whose process has exited, **When** the user opens the Stale view, **Then** the session is listed regardless of how recently it was active.
4. **Given** the Stale view with several sessions selected, **When** the user chooses bulk close and confirms, **Then** exactly the selected sessions are closed and no unselected or attention-needing session is affected.
5. **Given** selected sessions whose project is a worktree, **When** the user chooses bulk close, **Then** the confirmation states exactly what will be removed from disk, and on confirmation the worktree is removed.
6. **Given** the user changes the staleness threshold in settings, **When** they reopen the Stale view, **Then** the listed set reflects the new threshold without a restart.

---

### User Story 4 - Switch and save views (Priority: P2)

A user picks from named views — Everything, Needs me, Active, Stale — with one click, changes how the current list is grouped and sorted, hides stale sessions in any view, and saves their own combination for later. Their views survive a restart.

**Why this priority**: The saved views are what make the flat list adapt to different working modes. Built-in views deliver most of the value; custom views are the extension of that.

**Independent Test**: Switch between the built-in views, change grouping and sort, save a custom view, restart the app, and confirm the custom view is still there.

**Acceptance Scenarios**:

1. **Given** the default state, **When** the user selects "Needs me", **Then** only sessions waiting on the user are listed.
2. **Given** any view, **When** the user changes grouping or sort, **Then** the list regroups and reorders and the choice is remembered for that view.
3. **Given** any view, **When** the user enables "hide stale", **Then** stale sessions disappear from that view only, and the setting persists for that view.
4. **Given** a saved custom view, **When** the user restarts the app, **Then** the custom view is still listed and produces the same grouping, sort, and filters.
5. **Given** the user was last in a filtered view, **When** they restart the app, **Then** the sidebar restores to the unfiltered "Everything" view and the filtered view remains one click away.

---

### User Story 5 - Never be silently shown a subset (Priority: P2)

Whenever the visible list is filtered — by search, by a view's filters, or by hide-stale — the user sees a persistent notice saying how many sessions are shown out of how many exist, with a one-click way to show all.

**Why this priority**: A user opening a laptop to 6 of 22 sessions with no explanation will read it as data loss. This is cheap to build and prevents the worst failure mode of the whole feature.

**Independent Test**: Apply any filter, confirm the notice appears with correct counts, click "show all", confirm the full list returns.

**Acceptance Scenarios**:

1. **Given** a filter hides at least one session, **When** the user looks at the list, **Then** a non-dismissible notice states the shown count and the total count.
2. **Given** the notice is showing, **When** the user activates "show all", **Then** all filters clear and every session is listed.
3. **Given** no filter is active, **When** the user looks at the list, **Then** no notice is shown.

---

### User Story 6 - Search and keyboard navigation (Priority: P3)

A user types a query and the list narrows to matching sessions — matched on session name, note, project, and branch — with one consistent behaviour rather than dimming some rows and hiding others. Keyboard shortcuts jump to a session, cycle recently used sessions across projects, jump to the next session needing attention, and edit a session's note.

**Why this priority**: Speed layer on top of an already-working list. Valuable, but the feature is usable without it.

**Independent Test**: Type a query and confirm only matching sessions remain; exercise each shortcut and confirm the described jump happens.

**Acceptance Scenarios**:

1. **Given** a query matching a session's project name, **When** the user types it, **Then** that session is listed and non-matching sessions are removed from the list (not dimmed).
2. **Given** any query, **When** it matches nothing, **Then** an empty state explains that the query matched no sessions and offers to clear it.
3. **Given** sessions across several projects, **When** the user uses the recent-session cycle shortcut, **Then** focus moves through recently used sessions across project boundaries.
4. **Given** at least one session is waiting on the user, **When** the user uses the next-attention shortcut, **Then** the next such session is selected.
5. **Given** a selected session, **When** the user uses the note shortcut and types a line of text, **Then** the note is saved and shown on the row and is searchable.

---

### Edge Cases

- A session sits exactly at the staleness threshold — the boundary is defined and tested (strictly greater than the threshold is stale).
- A session is waiting on the user and has been for days — never stale, never bulk-closed.
- A session's process exited seconds ago — stale immediately.
- Grouping by status or branch, then selecting a session — the app's project-scoped state must still resolve; it must never be left undefined.
- A session created before activity tracking existed — treated as last active at its creation time.
- A very chatty session producing continuous output — activity stamping must not degrade responsiveness.
- Bulk close is confirmed while one of the selected sessions transitions to needing attention — attention-needing sessions are excluded from the action.
- Worktree removal is requested for a worktree with uncommitted changes — the user is told before anything is removed.
- The staleness threshold is set to zero or a very large value — the setting is bounded to a sane range.
- Zero sessions exist — the empty state explains how to create one, and no filter notice appears.
- Every session in a group is filtered out — the empty group is not rendered.

## Requirements _(mandatory)_

### Functional Requirements

**Session list and model**

- **FR-001**: The sidebar MUST present sessions as a single flat list whose grouping, ordering, and filtering are all determined by the currently selected view.
- **FR-002**: Each session MUST carry a last-activity time, updated whenever the session produces output, and this MUST be shown on the row as a relative time.
- **FR-003**: Each session MUST carry a derived state of working, waiting-on-user, idle, or exited, and the row MUST show it. (Design artifacts name this state `awaiting-input`; the two terms are the same thing.)
- **FR-004**: The waiting-on-user state MUST be conveyed by at least one non-colour cue (shape or text), not by hue alone.
- **FR-005**: Each session MUST support an optional single-line user-authored note, editable and searchable.
- **FR-006**: Each session MUST carry a last-attended time, updated when the session becomes the visible one.
- **FR-007**: A session created without a recorded last-activity time MUST be treated as last active at its creation time.
- **FR-008**: Groups MUST default to expanded.

**Views**

- **FR-009**: The system MUST provide selectable views that each specify a grouping key, a sort key, and a filter set.
- **FR-010**: Grouping MUST support at least: by project, by workspace, by status, by branch, and no grouping.
- **FR-011**: Sorting MUST support at least: most recent activity, oldest activity, name, status, and manual order.
- **FR-012**: The system MUST ship built-in views: Everything (grouped by workspace, with each project nested under its workspace — amended 2026-08-25, was grouped by project; manual order), Needs me (waiting-on-user only), Active (working only), and Stale (stale only, oldest first).
- **FR-013**: Users MUST be able to change grouping, sort, and filters for the current view and save the result as a named custom view.
- **FR-014**: Custom views and per-view settings MUST persist across restarts.
- **FR-015**: On launch the sidebar MUST restore to the unfiltered Everything view, never to a filtered view.
- **FR-016**: Whenever any filter is active, the system MUST display a persistent, non-dismissible notice stating the shown count and the total count, with a control that clears all filters.

**Staleness and cleanup**

- **FR-017**: A session MUST be considered stale when its process has exited, or when it has been inactive for longer than the configured threshold and is not waiting on the user.
- **FR-018**: A session waiting on the user MUST never be considered stale.
- **FR-019**: Staleness MUST be evaluated against the current time at display, so a session becomes stale without any user action or restart.
- **FR-020**: The staleness threshold MUST be user-configurable in settings, defaulting to 2 hours.
- **FR-021**: Every view **except the built-in Stale view** MUST offer a hide-stale toggle whose state is remembered per view. The Stale view shows only stale sessions, so the toggle is meaningless there and MUST NOT be rendered.
- **FR-022**: In the Stale view users MUST be able to select multiple sessions — shift-click for a range, and a select-all control on each group header — and close them in one action. No new keyboard binding is introduced for selection: `⌘A` remains the terminal's select-all.
- **FR-023**: Bulk close MUST never close a session that is waiting on the user.
- **FR-024**: When any selected session belongs to a worktree-backed project, bulk close MUST offer to remove the worktree, and the confirmation MUST state exactly what will be removed from disk before anything is removed.

**Extension surfaces**

- **FR-025**: Globally contributed buttons MUST continue to render in the sidebar header, unchanged.
- **FR-026**: When grouping by a scope (project or workspace), the group header MUST host every action the corresponding tree row hosted: expand/collapse, branch switching, new-session creation, busy aggregation, context menu, and the hover-revealed workspace-scoped extension buttons.
- **FR-027**: When grouping by a non-scope key, every session row MUST offer a scope affordance that exposes the same workspace- and project-scoped actions, and those actions MUST also be reachable from the row context menu and the command palette.
- **FR-028**: Sidebar-contributed items MUST render exactly once per window, in the sidebar footer, and clicking one MUST invoke the contributing extension's handler. This surface is contributed to today (`api.sidebar.registerItem`) but has never rendered: the registration reaches the main process and stops there, because no host-renderer code consumes it. This feature completes the wiring rather than removing the API. See `research.md` R1 and its correction.
- **FR-028a**: An extension MUST be able to toggle its own sidebar panel programmatically. The `extension:toggle-panel` channel and both its listeners already exist, but nothing sends on it, which is why the one real sidebar-item contributor currently shows a hint toast instead of acting. A sidebar item that cannot perform its action is not wired up.
- **FR-029**: Project-scoped extension tabs MUST continue to resolve for the selected session's project under every grouping mode.
- **FR-030**: This feature MUST NOT add, remove, or change the semantics of any extension **contribution type** (`globalTab`, `workspaceTab`, `projectTab`, `sidebarPanel`, `windowViews`, `commands`) and MUST NOT remove any published API. It adds one method (`api.sidebar.togglePanel`) required by FR-028a; that is additive, so the extension SDK takes a MINOR version bump and no extension needs to change.

**Search and keyboard**

- **FR-031**: Search MUST behave as a filter with one consistent behaviour — matching sessions remain, non-matching sessions are removed — and MUST match session name, note, project name, and branch.
- **FR-032**: The system MUST provide keyboard access to: a session palette, cycling recently used sessions across projects, jumping to the next session waiting on the user, and editing the selected session's note.
- **FR-033**: Keyboard shortcuts introduced by this feature MUST NOT take an OS-exclusive claim, and MUST NOT bind the Escape key.

**Existing defects in scope**

- **FR-034**: Attention counts MUST be per-session, not aggregated onto every row of a project.
- **FR-035**: A child session's busy state MUST reflect that session, not its parent.
- **FR-036**: Any status indicator that no data source feeds MUST be either fed or removed — not carried forward inert.
- **FR-037**: Deleting a worktree-backed project or session with worktree removal requested MUST actually remove the worktree from disk. **Already implemented and correct** (verified at plan time — see `research.md` R2); this feature adds a regression test pinning the behaviour, not new removal code.

### Key Entities

- **Session**: A running or exited terminal. Gains a last-activity time, a last-attended time, a derived agent state, and an optional one-line note. Belongs to exactly one project.
- **Project**: Existing scope. Owns a branch and may be worktree-backed. Continues to be the default grouping key and the scope for project-scoped extension surfaces.
- **Workspace**: Existing top-level scope. Continues to host workspace-scoped extension surfaces.
- **View**: A named, persisted combination of grouping key, sort key, and filter set. Either built-in or user-created.
- **Group**: A runtime bucket of sessions produced by applying a view to the current data. Carries a label, a count, and — when its key is a scope — that scope's actions.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: With 20+ sessions across 4+ workspaces, 100% of sessions are visible on first paint without the user expanding anything.
- **SC-002**: A user can locate a specific named session among 20+ sessions in under 10 seconds using search or a view, without expanding any container.
- **SC-003**: A user can identify every session waiting on them in a single action (one view switch or one shortcut), with zero false negatives among sessions the system can detect.
- **SC-004**: Every extension-contributed action is reachable in every grouping mode — verified by an automated check covering all four contribution surfaces (global tabs, workspace tabs, sidebar items, project tabs) across all grouping modes. The sidebar-item surface is newly reachable rather than merely preserved; see FR-028.
- **SC-005**: A user can clear 10 abandoned sessions in under 30 seconds, in at most 3 interactions.
- **SC-006**: Zero sessions waiting on the user are ever closed by a bulk action.
- **SC-007**: Whenever the list is filtered, the shown/total counts are visible 100% of the time, and the full list is one interaction away.
- **SC-008**: Switching views or grouping updates the list within 100 ms for 100 sessions, with no visible stutter in terminal output.
- **SC-009**: Custom views and per-view settings survive a restart with 100% fidelity.
- **SC-010**: Selecting a session never leaves project-scoped UI unresolved, under any grouping mode.
- **SC-011**: All status distinctions remain distinguishable without colour (verified against WCAG 1.4.1) and at the sidebar's normal text size.
- **SC-012**: The three status defects listed under FR-034 to FR-036 are demonstrably fixed before the new rows ship.

## Assumptions

- Session persistence across restart, worktree-per-session, a resume overlay, and a multiplex grid are explicitly out of scope; this feature must not block any of them.
- The waiting-on-user state is a best-effort heuristic derived from the terminal byte stream and the terminal bell. Core cannot consume an extension's agent hooks, and shell-launched agents expose none, so this feature ships the state behind a single swappable source and documents the limitation rather than implying certainty.
- The default staleness threshold of 2 hours is taken from published task-resumption research (27% of suspended tasks not resumed within two hours) and is user-configurable.
- View definitions and per-view settings persist locally per machine, matching how existing sidebar preferences are stored; they are not synced.
- Sidebar-contributed items appear for the first time, once, in the sidebar footer. Verified at plan time: an extension can register one today and the registration is stored and queryable, but no host-renderer code has ever rendered it. This is therefore a new capability, not a relocation — the practical effect is that git-integration's "Git Changes" item becomes visible and functional. See FR-028, FR-028a, and `research.md` R1.
- The existing three-level Workspace → Project → Session data model is unchanged; only its presentation and the session record's fields change.
- Multi-select is offered in the Stale view; extending it to other views is out of scope for this feature.
- Sessions are not persisted across restart, so no data migration is required for the new session fields.
