# Feature Specification: Session Home and Monitor Wall

**Feature Branch**: `054-session-home-wall`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "Overview tab becomes the Monitor wall (design C). A new Home view lists every terminal session and switches between Ledger (design A) and Logbook (design E). Both answer which session, in which project, in which workspace, is on what work item, and in what state. Sessions without a ticket get a description that stays findable after they close." Mockups: https://claude.ai/artifact/GJHgpTvUmVNgjZiKSt5LQr

## Clarifications

### Session 2026-09-15

- Q: Today a ticket is linked per project. How does a session's work item work? → A: A session inherits its project's linked ticket and can be linked to a different ticket of its own, which then wins for that session only.
- Q: How long do descriptions stay findable after a session closes, and where? → A: Closed sessions that have a description or a session-level work item stay in Home, under Closed, searchable, for 30 days after they close.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See where every session is and what it is for (Priority: P1)

I open Home and see every open terminal session as one row in the Ledger layout, grouped by workspace, then project. Each row tells me the session's state, its name, its branch, its work item (or my description of it), its latest line of output, and how long ago it last did something. Sessions that need me sort first.

**Why this priority**: This is the question the feature exists to answer. Without it, the other stories have nothing to hang on.

**Independent Test**: Open sessions across two workspaces and three projects, one linked to a ticket, one with a description, one with neither. Open Home and confirm every session appears once, in the right group, with the right facts.

**Acceptance Scenarios**:

1. **Given** sessions open in several workspaces and projects, **When** I open Home, **Then** each open session appears exactly once, under a group labelled with its workspace and project.
2. **Given** a group contains a session awaiting input and a working session, **When** Home renders, **Then** the awaiting session is listed above the working one.
3. **Given** a session whose project is linked to a ticket, **When** its row renders, **Then** it shows that ticket's key and title.
4. **Given** a session with its own linked ticket in a project linked to a different ticket, **When** its row renders, **Then** it shows the session's ticket, not the project's.
5. **Given** a session with no ticket and no description, **When** its row renders, **Then** the work item cell shows an empty "What is this session doing?" field and a Link control.
6. **Given** I launch the app, **When** the main window appears, **Then** Home is the view shown.
7. **Given** two sessions need input, **When** I look at the app band, **Then** the Home entry shows the count 2.

---

### User Story 2 - Describe a session so I don't lose context (Priority: P1)

A session that is not working on a ticket gets a short description in my own words, which I can add or edit from Home, the Monitor wall, or the Logbook. The description stays with the session while it runs and remains findable for 30 days after I close it.

**Why this priority**: Losing track of why a shell is open is the problem the user named. It is cheap to deliver and valuable even without the other layouts.

**Independent Test**: Describe a session from Home, close the session, restart the app, and find it again by searching a word from its description.

**Acceptance Scenarios**:

1. **Given** a session with no description, **When** I type a description in its field and confirm, **Then** the description replaces the field on every surface that shows the session.
2. **Given** a session with a description, **When** I choose to edit it, **Then** I can change it or clear it, and clearing it brings back the empty field.
3. **Given** a described session, **When** I close it and restart the app, **Then** it is listed under Closed in Home with its description, workspace, project, branch and close time.
4. **Given** a closed session with a description, **When** I type a word from that description into Home's filter, **Then** the closed session is among the results.
5. **Given** a closed session that closed more than 30 days ago, **When** I open Home, **Then** it is no longer listed or found by search.
6. **Given** a session that already has a one-line note from before this feature, **When** Home first renders it, **Then** the note appears as its description.

---

### User Story 3 - Monitor wall on the Overview tab (Priority: P2)

The Overview tab shows every open session as a tile large enough to read its live output. Sessions that need me are pinned double-width in a "Needs you" band at the top. Everything else follows in a grid ordered working, idle, then exited. Each tile's caption names the workspace, project and branch; its footer names the work item or description.

**Why this priority**: It replaces an existing surface, the state-columned board, so it changes something people already use. It depends on the facts from Story 1 but not on the Home layouts.

**Independent Test**: With four sessions (one awaiting input, one working, one idle, one exited), open Overview and confirm the band, the order, the live output and the tile facts.

**Acceptance Scenarios**:

1. **Given** a session awaiting input, **When** Overview renders with "Pin sessions that need you" on, **Then** that session's tile sits in the Needs you band and spans two grid columns.
2. **Given** "Pin sessions that need you" is off, **When** Overview renders, **Then** there is no Needs you band and all tiles follow the chosen ordering.
3. **Given** a working session producing output, **When** its tile is on screen, **Then** new output appears in the tile as it is written.
4. **Given** I change tile size between S, M and L, **When** I restart the app, **Then** Overview uses the size I last chose.
5. **Given** a tile, **When** I click it or press Enter while it has focus, **Then** the app switches to that session's terminal.
6. **Given** no Needs you sessions, **When** Overview renders, **Then** the Needs you band is not drawn at all.
7. **Given** a session from a workspace with a colour, **When** its tile renders, **Then** the colour appears only as the tile's left edge.

---

### User Story 4 - Answer a waiting session without opening it (Priority: P2)

When an agent in a session asks a numbered-choice question, its tile on the Monitor wall and its expanded row in the Ledger show one button per choice. Pressing a button answers the question as if I had typed it.

**Why this priority**: It turns the wall from a status display into a place where work gets unblocked, but it only matters once Story 3 or the Ledger exists.

**Independent Test**: Run an agent until it shows a numbered choice prompt, press the second option on its tile, and confirm the terminal received that choice and the session leaves Needs you.

**Acceptance Scenarios**:

1. **Given** a session awaiting input whose visible screen shows a numbered choice prompt, **When** its tile renders, **Then** it shows one button per choice, labelled with the choice text, in the prompt's order.
2. **Given** those buttons, **When** I press one, **Then** the terminal receives that choice exactly as a keypress of its number would deliver it.
3. **Given** a session awaiting input whose screen shows no recognisable choice prompt, **When** its tile renders, **Then** no answer buttons appear and the tile offers Open terminal instead.
4. **Given** the prompt disappeared between rendering and pressing, **When** I press a button, **Then** nothing is sent and the buttons are removed.

---

### User Story 5 - Switch Home between Ledger and Logbook (Priority: P2)

Home has a layout switch with two choices, Ledger and Logbook, remembered across restarts. The Logbook lists sessions grouped by state (Needs you, Working, Idle, Exited, Closed), each headlined by its ticket title, else its description, else "Add a description". Selecting one opens a detail pane with the session's location, a description editor, a Link a work item control with suggested tickets, session facts and a large live preview.

**Why this priority**: The Logbook is the deeper, context-first view. It builds on the facts and descriptions from Stories 1 and 2.

**Independent Test**: Switch to Logbook, restart, confirm Logbook is still shown, select an undescribed session, save a description, and confirm the list headline updates.

**Acceptance Scenarios**:

1. **Given** Home in Ledger, **When** I choose Logbook, **Then** Home shows the Logbook layout with the same sessions.
2. **Given** I chose Logbook, **When** I restart the app, **Then** Home opens in Logbook.
3. **Given** a session with a ticket, **When** the Logbook list renders, **Then** its headline is the ticket title and its ticket key is shown beneath.
4. **Given** a session with neither ticket nor description, **When** I select it, **Then** the detail pane opens with the description editor focused.
5. **Given** a tracker is connected and open tickets are assigned to me, **When** the detail pane renders, **Then** up to three suggestions are offered as one-click links, each showing key, title and status, with the session's project ticket first when it has one and the session is not already on it.
6. **Given** the selected session, **When** the detail pane renders, **Then** it shows workspace, project, branch, shell, start time and tags.
7. **Given** a Closed session is selected, **When** the detail pane renders, **Then** it shows its description and facts, and in place of the live preview states that the session is closed and when.

---

### User Story 6 - Link a session to a work item from Home (Priority: P3)

From any surface that shows a session's work item, I can link that session to a ticket, change it, or remove the session's own link so it falls back to its project's ticket.

**Why this priority**: Project-level linking already exists, so most sessions already show a ticket. Session-level linking is the refinement for two sessions in one project serving different tickets.

**Independent Test**: In a project linked to ticket A, link one of its two sessions to ticket B, and confirm one session shows B and the other shows A; then remove the link and confirm both show A.

**Acceptance Scenarios**:

1. **Given** a session, **When** I choose Link and pick a ticket, **Then** the session shows that ticket on every surface.
2. **Given** a session with its own link, **When** I remove it, **Then** the session shows its project's ticket, or the description field if the project has none.
3. **Given** no issue tracker is connected, **When** I choose Link, **Then** I am told no tracker is connected and offered the way to connect one.
4. **Given** a session with both a description and a ticket, **When** it renders, **Then** the ticket is shown as the work item and the description stays visible in the Logbook detail pane.

---

### User Story 7 - Configure the Ledger (Priority: P3)

The Ledger's Display menu lets me group by workspace then project, project only, or none; sort by needs-you-first or most recent activity; show or hide the branch, work item, tags, latest output and age columns; preview the selected row; and hide exited sessions. A Needs you filter and a text filter narrow the list. All choices persist.

**Why this priority**: The user asked for a configurable view, but sensible defaults already deliver Story 1.

**Independent Test**: Hide the Latest output column, group by project only, restart, and confirm both choices held.

**Acceptance Scenarios**:

1. **Given** I hide a column, **When** the Ledger renders, **Then** that column and its header are absent and the remaining columns use the width.
2. **Given** "Preview the selected row" is on, **When** I select a row, **Then** the row expands to a live preview, with answer buttons when Story 4's conditions hold and an Open terminal control.
3. **Given** the Needs you filter is on, **When** the Ledger renders, **Then** only sessions awaiting input are listed.
4. **Given** text in the filter, **When** the Ledger renders, **Then** only sessions whose name, workspace, project, branch, ticket key, ticket title or description contains the text are listed.
5. **Given** every filter excludes every session, **When** the Ledger renders, **Then** it says no sessions match and offers to clear the filters.

### Edge Cases

- **No sessions open**: Home and Overview say no terminals are open and offer to open one; the Closed section still shows if it has entries.
- **Awaiting input goes undetected**: needs-you detection is a heuristic and under-reports, especially for agents started from a plain shell. Such a session is shown as working or idle and never gets answer buttons; nothing claims it needs input.
- **A session changes state while visible**: its tile moves into or out of the Needs you band, and the live preview carries on without restarting or losing output.
- **Many sessions on the wall**: with more tiles than fit, the wall scrolls; the Needs you band stays at the top of the scroll.
- **Session with no project or workspace (scratch terminal)**: it is shown in a group labelled "No project", with no colour edge, and can still be described.
- **The linked ticket cannot be fetched** (offline, revoked access, deleted ticket): the ticket key is still shown, with a note that details could not be loaded; the link is not removed.
- **Description too long**: input stops at 500 characters; single-line surfaces show the first line, truncated, and the Logbook shows it in full.
- **The same session is edited from two surfaces**: the last saved description wins, and every surface shows it.
- **Project link changes**: every session in that project without its own link shows the new ticket immediately.
- **A closed session is reopened or restored**: it leaves Closed and appears as an open session with its description and link intact.

## Requirements _(mandatory)_

### Functional Requirements

**Session facts (shared by all surfaces)**

- **FR-001**: The system MUST resolve, for every open session: workspace, project, branch, process name, state (awaiting input, working, idle, exited), time since last activity, tags, work item and description.
- **FR-002**: A session's work item MUST be its own linked ticket when it has one, otherwise its project's linked ticket, otherwise none.
- **FR-003**: State MUST be shown by icon shape and opacity, never by colour, using the same state emphasis the rest of the app uses.
- **FR-004**: A workspace's colour MUST appear only as a left edge on a session's row, tile or list entry.
- **FR-005**: A session with neither work item nor description MUST show an editable "What is this session doing?" field and a Link control wherever its work item would appear.

**Descriptions**

- **FR-006**: Users MUST be able to add, edit and clear a session's description from the Ledger, the Logbook and the Monitor wall.
- **FR-007**: A description MUST be free text of at most 500 characters and MUST persist across app restarts.
- **FR-008**: An existing one-line session note MUST be carried over as that session's description; there MUST be one description field per session, not two.
- **FR-009**: When a session closes, the system MUST retain its description, work item, workspace, project, branch, start time and close time for 30 days if it had a description or its own linked ticket, then discard them.
- **FR-010**: Retained closed sessions MUST be listed under Closed in Home and included in Home's text filter results.

**Work item links**

- **FR-011**: Users MUST be able to link a session to a ticket, replace that link, and remove it, from any surface that shows the session's work item.
- **FR-012**: Removing a session's own link MUST NOT change its project's link.
- **FR-013**: When no issue tracker is connected, the Link control MUST say so and lead to where a tracker is connected.
- **FR-014**: When ticket details cannot be loaded, the surface MUST still show the ticket key and state that details are unavailable.

**Home**

- **FR-015**: The app MUST provide a Home view reachable from the app band, whose entry shows the number of sessions awaiting input, and hides the count at zero.
- **FR-016**: Home MUST be the view shown when the app launches.
- **FR-017**: Home MUST offer a layout switch between Ledger and Logbook, and MUST reopen in the last chosen layout after a restart.
- **FR-018**: Both layouts MUST show the same set of sessions and the same facts for each.

**Ledger**

- **FR-019**: The Ledger MUST show one row per session, grouped by workspace then project by default, sessions awaiting input first within each group.
- **FR-020**: Rows MUST offer columns for state, session name, branch, work item or description, latest output line, and time since last activity; state and session name are always shown.
- **FR-021**: The Display menu MUST let users choose grouping (workspace then project, project, none), sort (needs you first, most recent activity), visible optional columns, preview of the selected row, and hiding exited sessions; every choice MUST persist across restarts.
- **FR-022**: The Ledger MUST offer a Needs you filter and a text filter matching session name, workspace, project, branch, ticket key, ticket title and description.
- **FR-023**: With preview enabled, selecting a row MUST expand it to a live preview with an Open terminal control.

**Logbook**

- **FR-024**: The Logbook MUST list sessions grouped as Needs you, Working, Idle, Exited and Closed, omitting empty groups, each entry headlined by ticket title, else description, else "Add a description".
- **FR-025**: Selecting an entry MUST show a detail pane with workspace, project and branch; a description editor with Save; a Link a work item control; session facts (shell, start time, tags); and a live preview for open sessions.
- **FR-026**: The detail pane MUST suggest up to three tickets, each linkable in one action: the session's project ticket first when the session has a different own link or none, then open tickets assigned to the user in the connected tracker.
- **FR-027**: Selecting a session with neither work item nor description MUST place focus in the description editor.

**Monitor wall (Overview tab)**

- **FR-028**: The Overview tab MUST show every open session as a tile with a live preview, replacing the state-columned board; the board and anything only it used MUST be removed.
- **FR-029**: Each tile MUST show state, workspace / project / branch, process name, time since last activity, the live preview, and a footer with the work item or description (or the FR-005 field).
- **FR-030**: With "Pin sessions that need you" on (the default), sessions awaiting input MUST appear first in a Needs you band as double-width tiles; the band MUST NOT be drawn when empty.
- **FR-031**: Remaining tiles MUST be ordered by the chosen secondary ordering: state (working, idle, exited; the default), workspace then project, or most recent activity.
- **FR-032**: The toolbar MUST offer tile size S, M and L, the pin toggle, the secondary ordering, and a text filter; size, toggle and ordering MUST persist across restarts.
- **FR-033**: Activating a tile by click or keyboard MUST switch to that session's terminal.

**Answering in place**

- **FR-034**: For a session awaiting input whose visible screen shows a numbered choice prompt, its wall tile and its expanded Ledger row MUST show one button per choice, labelled and ordered as in the prompt.
- **FR-035**: Pressing a choice button MUST deliver that choice to the session exactly as typing its number would, and only if the prompt is still on screen; otherwise nothing is sent and the buttons are removed.
- **FR-036**: Sessions awaiting input without a recognisable choice prompt MUST NOT show choice buttons.

**Quality**

- **FR-037**: Every interactive element on Home and the wall MUST be reachable and operable by keyboard with a visible focus state.
- **FR-038**: Live previews MUST pause output animation when the user has asked for reduced motion, while still showing current output.

### Key Entities

- **Session**: an open or recently closed terminal. Belongs to at most one project. Has a state, process name, start time, last activity, optional close time, tags, an optional own work item link, and an optional description.
- **Work item link**: an association between a ticket in a connected tracker (identified by tracker and key) and either a project or a session. A session's own link overrides its project's.
- **Description**: the user's free-text account of what a session is for, up to 500 characters, owned by one session, retained 30 days past close.
- **Closed session record**: the retained facts of a closed session (description, work item, workspace, project, branch, start and close times), kept 30 days.
- **Home preferences**: the chosen layout, and the Ledger's grouping, sort, visible columns, preview and exited-session settings.
- **Wall preferences**: tile size, pin toggle and secondary ordering.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: With 20 open sessions across 3 workspaces, a user can name the workspace, project, branch, work item and state of any given session from Home in under 5 seconds, without opening the session.
- **SC-002**: A newly opened session appears on Home and the Monitor wall within 1 second, and a state change is reflected within 2 seconds.
- **SC-003**: A numbered choice question shown on the wall can be answered in one click, and the session leaves Needs you within 2 seconds of the answer.
- **SC-004**: 100% of descriptions saved before a restart are present after it, and a closed session's description is found by text filter on day 29 after close and not on day 31.
- **SC-005**: With 12 live tiles on the wall, typing in a focused terminal shows no perceptible delay (characters echo within 50 ms).
- **SC-006**: Home's layout choice, and every Ledger and wall preference, is the same after a restart in 100% of cases.
- **SC-007**: Every session with neither a work item nor a description is visibly prompted for one on all three surfaces.

## Assumptions

- **Home and Overview both exist**: Home (Ledger or Logbook) is a new view; Overview keeps its place and becomes the Monitor wall. The mockups' Board direction (B) and Matrix direction (D) are out of scope.
- **Home is the launch view**, replacing whatever the app currently opens to; no setting to change it in this feature.
- **Needs-you detection gains one signal**: besides the terminal bell, a numbered choice prompt visible on a session's screen marks it as needing you. The bell alone rarely fires for agents, which would leave answer buttons unreachable. Detection remains a heuristic, and anything it misses is shown as working or idle.
- **Ticket suggestions** come from the issue tracker integration already in core (Linear and Jira). A project is linked to one ticket, not to a tracker project, so "tickets in this project" cannot be derived; suggestions are the project's ticket plus the user's own open tickets.
- **Tags** are the session's workspace tags, plus "agent" for agent sessions. Sessions carry no tags of their own, and this feature adds no tag editing.
- **Recent commands are out of scope**: the app does not capture the commands a shell runs, so the Logbook mockup's recent-commands list is dropped rather than shipped empty. Capturing them would need shell integration, which is a separate feature.
- **Closed sessions without a description or own link** are not retained: they have no context worth recovering beyond what their project already records.
- **The existing session note is migrated**, not kept alongside, so there is exactly one place to write what a session is for.
- **Constitution constraints apply**: flat lucide icons with state by opacity only; everything here is core, with no dependency on or from any extension; test-first with 80% coverage; README, ARCHITECTURE.md and a new ADR (replacing the state-columned board, session-level work item links) ship in the same PR.
