# Feature Specification: Branch-First Sidebar

**Feature Branch**: `032-branch-first-sidebar`

**Created**: 2026-08-27

**Status**: Draft

**Input**: Direction A of the interface audit (2026-08-27). "Keep all three objects. Rename the middle one from _project_ to _branch_ and let the branch name be its identity. Then put on the row everything the other four surfaces already know."

## Context

A hands-on audit of build 0.1.90 found that Terminator draws a single session in five places — sidebar row, session tab, command palette, overview tile, issue drawer — and no two agree on what it is. The row the user looks at all day carries the least: a name and an age. Underneath that sits a vocabulary problem: the object between a repo and a terminal is called a _project_, but it is a branch, and every repo's default is therefore named `main`.

This feature closes the audit findings **PRJ-3, PRJ-4, SESS-1, SESS-3, NAV-5, NAV-6, NAV-7**. It deliberately does not close NAV-1 or NAV-2 (see Out of Scope).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Read a session's real state without touching it (Priority: P1)

A user with several terminals open glances at the sidebar and can tell, without clicking anything, which sessions are running, which are idle, which have exited, and which are blocked waiting on them. Selection is visibly a different thing from state.

**Why this priority**: The app already computes agent state and filters three built-in views on it, but the resting list never shows it — the bright dot means "selected", and idle, working and awaiting-input all render the same dim dot. Every other story is less valuable while the list cannot answer "what is happening".

**Independent Test**: Open four sessions in different states, take one screenshot, and have someone name each state correctly without interacting.

**Acceptance Scenarios**:

1. **Given** a session whose agent is producing output, **When** the user looks at its row, **Then** the row shows a running indicator distinguishable from idle by shape, not only by hue.
2. **Given** a session waiting on the user, **When** the user looks at its row, **Then** the row carries both a waiting glyph and a non-colour edge marker, and reads differently from every other state.
3. **Given** a selected session that is idle, **When** the user looks at its row, **Then** selection is expressed by the row's surface and the state glyph still reads "idle" — the two cues never substitute for one another.
4. **Given** an exited session, **When** the user looks at its row, **Then** it is distinguishable from an idle session at rest.
5. **Given** any of the four states, **When** the user views the sidebar in a high-contrast or greyscale rendering, **Then** every state remains distinguishable.

---

### User Story 2 - Know which branch you are about to type into (Priority: P1)

A user scanning the sidebar can see, for every branch row, which branch it is and whether it has its own working copy on disk. Selecting a row and reading the shell prompt is no longer the only way to find out.

**Why this priority**: The app's premise is parallel worktrees, and the sidebar never uses the word. A worktree and a plain checkout render identically today, which makes it possible to run a destructive command in the wrong tree.

**Independent Test**: With one plain checkout and one worktree in the same repo, confirm from the sidebar alone which is which, and what branch each is on, before selecting either.

**Acceptance Scenarios**:

1. **Given** a branch backed by a git worktree, **When** the user looks at its row, **Then** the row is marked as a worktree and reveals its path on hover.
2. **Given** a branch that is a plain checkout of the repo, **When** the user looks at its row, **Then** it is marked as a branch and carries no worktree marker.
3. **Given** a branch row whose display name is the branch name, **When** the branch is renamed or switched underneath it, **Then** the row's name follows the branch.
4. **Given** a branch with a user-supplied label, **When** the user looks at its row, **Then** both the label and the branch name are legible, with the label leading.
5. **Given** a repo group header, **When** the user looks at it, **Then** it names the repo and its folder path.

---

### User Story 3 - One name for one thing, everywhere (Priority: P2)

A user opening the command palette, the link-issue dialog, or the move-session dialog sees names that identify a single, unambiguous thing. "New terminal in main" repeated six times no longer appears anywhere.

**Why this priority**: This is what makes the fix stick. Repairing only the sidebar leaves the palette and dialogs still ambiguous, and the palette is the surface whose entire job is picking the right thing fast.

**Independent Test**: With six repos whose default branch is `main`, open the palette and confirm every listed command and session names exactly one thing.

**Acceptance Scenarios**:

1. **Given** six repos each with a `main` branch, **When** the user opens the command palette, **Then** each "new terminal" command is qualified by its repo and no two entries read identically.
2. **Given** a session listed in the palette, **When** the user reads its row, **Then** it names both the repo and the branch it belongs to.
3. **Given** the link-issue dialog, **When** it opens for a branch, **Then** it names the repo and the branch it will attach to.
4. **Given** the session tab bar, **When** the user switches to a different branch, **Then** the tab bar states which branch's terminals it is showing.
5. **Given** any user-visible surface that referred to a "project", **When** the user reads it, **Then** it says "branch".

---

### User Story 4 - App-level surfaces have one home (Priority: P3)

A user looking for Overview, Notes, Task Vault, Remote Control or Git Changes finds them all in one labelled band, rather than as four unlabelled icons at the top of the sidebar and one button at the bottom.

**Why this priority**: Real friction, but nobody is blocked by it and it is independent of the row work. Dropping it still leaves a coherent feature.

**Independent Test**: Ask someone who has not used the app to name every icon in the sidebar header. Then repeat after the change.

**Acceptance Scenarios**:

1. **Given** the sidebar, **When** the user looks at the top band, **Then** every app-level surface shows a visible text label alongside its icon.
2. **Given** an extension contributing a sidebar item, **When** it is registered, **Then** it appears in the same band as the global tabs rather than in a separate footer.
3. **Given** the app band, **When** the user navigates by keyboard, **Then** each entry is reachable and announces its label to assistive technology.
4. **Given** the sidebar header, **When** the user looks at it, **Then** the notification bell and the new-repo control sit with the list they act on, not with the app band.
5. **Given** scratch sessions exist, **When** the user looks at the list, **Then** they appear as a group with a count rather than a separate footer, and they are counted consistently wherever counts are shown.

---

### Edge Cases

- A branch name longer than the sidebar width — the row must truncate in the middle or at the head, never hide the disambiguating tail, and must reveal the full name on hover.
- A repo with no branches configured yet — the group header still renders and offers a way to add one.
- A branch whose git metadata cannot be read (repo moved, permissions) — the row renders with the state it has and does not block or blank the list.
- Diff statistics unavailable or slow — the row renders without them and fills them in when they arrive; they never delay first paint.
- A session whose branch record has been removed — it is either shown under a recovery group or excluded, but the count shown to the user always matches the rows the user can see.
- The narrowest supported sidebar width — every row must still show name and state; secondary metadata may drop out by a documented order.

## Requirements _(mandatory)_

### Functional Requirements

**Session state**

- **FR-001**: The system MUST render session state and session selection as two independent visual channels, such that neither substitutes for the other.
- **FR-002**: The system MUST distinguish at least four resting session states — running, idle, awaiting input, exited — by shape, not by hue alone.
- **FR-003**: The system MUST continue to show a session's relative last-activity time on its row.
- **FR-004**: The system MUST mark a session that is awaiting input with a second, non-colour cue in addition to its state glyph.

**Branch identity**

- **FR-005**: The system MUST use the branch name as a branch row's default display name.
- **FR-006**: The system MUST allow a user-supplied label on a branch, and MUST show the branch name alongside the label when one is set.
- **FR-007**: The system MUST visually distinguish a branch backed by a git worktree from a plain checkout, and MUST expose the worktree path on demand.
- **FR-008**: The system MUST show each repo's folder path on its group header.
- **FR-009**: The system MUST show a branch's uncommitted change statistics on its row when git can supply them, and MUST render the row without them when it cannot.

**Vocabulary**

- **FR-010**: The system MUST use the word "branch" in every user-visible string that previously said "project", including menus, dialogs, commands, empty states and notifications.
- **FR-011**: The system MUST qualify every registered command that names a branch with the repo that owns it.
- **FR-012**: The system MUST name both the repo and the branch in the command palette's session entries.
- **FR-013**: The system MUST state which branch's terminals the session tab bar is showing.
- **FR-014**: The system MUST name the repo and the branch in any dialog that attaches, moves, or removes something scoped to a branch.

**Sidebar chrome**

- **FR-015**: The system MUST present app-level surfaces — global tabs and contributed sidebar items — in a single labelled band, visually separated from the session list.
- **FR-016**: The system MUST give every entry in that band a visible text label and an accessible name.
- **FR-017**: The system MUST place list-scoped controls (notifications, add repo) with the session list rather than with the app band.
- **FR-018**: The system MUST present scratch sessions as a group within the list.
- **FR-019**: The system MUST ensure every count shown to the user equals the number of rows that user can reach in the current view.

**Non-regression**

- **FR-020**: The system MUST preserve every existing grouping, sort and filter view, and every extension contribution point, without requiring extension changes.
- **FR-021**: The system MUST NOT change stored data such that an older build cannot read it.

### Key Entities

- **Repo** (today: Workspace): a git repository on disk. Has a name, a folder path, a colour, and owns branches.
- **Branch** (today: Project): a checkout of one branch, optionally backed by a worktree directory. Has a branch name, an optional label, an optional worktree path, an optional linked issue, and owns sessions.
- **Session**: a terminal, optionally running an agent. Has a title, a state, a last-activity time, an optional note.
- **Session state**: one of running, idle, awaiting input, exited — already computed by the app, newly made visible.
- **Change statistics**: added and removed line counts for a branch's working tree, supplied by git, always optional.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Given a screenshot of a sidebar containing one session in each of the four states, a person who has not used the app names all four correctly.
- **SC-002**: No two entries in the command palette are textually identical for a setup of six repos whose default branch is `main`.
- **SC-003**: A user can state which of two rows in the same repo is a worktree without selecting either.
- **SC-004**: Every user-visible occurrence of the word "project" is gone, verified by a repository-wide check over user-facing strings.
- **SC-005**: Sidebar first paint is not delayed by git metadata: the list renders with names and states before any change statistics arrive.
- **SC-006**: Every count shown in the view chips and the filter notice equals the number of rows rendered, in every built-in view.
- **SC-007**: The whole sidebar is operable by keyboard, and every control in the app band has an accessible name.

## Assumptions

- The rename is a **user-visible vocabulary change only**. The stored entity keeps its current internal name so that no data migration is required and FR-021 holds. The cost of that split is recorded in the plan's Complexity Tracking.
- Existing branch records whose name already equals their branch name need no data change; they display identically before and after.
- Change statistics come from the git integration already present in core; no new dependency is introduced.
- Session state continues to be inferred by the existing mechanism. Improving that signal is a separate concern; this feature only makes its output visible. If the signal is wrong, this feature makes it obvious — which is intended.
- The sidebar's default width will need to grow to fit the enriched row. The exact value is a design decision recorded in research.

## Out of Scope

- **NAV-1 / NAV-2** — giving Code Reviews and SpecKit Pilot persistent tabs and rationalising the seven content destinations. That touches the extension host's view model and deserves its own feature.
- **Direction B** (task as the unit) and **Direction C** (attention-ordered list). C becomes viable on top of this work once the state signal is trusted.
- Improving the "awaiting input" inference itself.
- The destructive-removal dialog (PRJ-1, PRJ-2), the escape-key and drawer-frame repairs (NAV-3, TKT-1), and the other standalone repairs from the audit. They are independent and should not wait for this.

## Dependencies

- PR #155 (`032-sidebar-workspace-grouping`) introduces workspace-grouped nesting and the workspace name on project headers. This feature builds directly on those components and assumes that work lands first.
