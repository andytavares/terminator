# Feature Specification: Declutter the Sidebar, and a Board for the Fleet

**Feature Branch**: `034-declutter-sidebar`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "the left sidebar is still way too busy this was the primary idea we were based on https://superset.sh/parallel-coding-agents https://superset.sh/agent-orchestration take inspiration from that. https://docs.superset.sh/workspaces https://docs.superset.sh/diff-viewer" — followed by: "i also want the board view of the terminals shown in the screenshots so i can keep track of what terminal is in what state"

## Context

Feature 032 was written as an addition. Its stated input was "put on the row everything the other four surfaces already know", answering an audit finding that the sidebar row "carries the least: a name and an age". Feature 033 then ran the repo's identity colour down the whole column as background washes and edge rails. Both did what they set out to do, and together they produced a list that is hard to read.

Measured against the build on `main`:

- **Four stacked bands of chrome** sit above the first row of work: the app band, the search row, the view bar (view chips with counts, a Group menu, a Sort menu, a Hide-stale checkbox) and the filter notice.
- **A branch group header can carry thirteen separate elements** in a 28px strip: collapse chevron, branch-kind glyph, branch name, repo-name qualifier, repo folder path, busy dot, issue badge, per-extension tab icons, a "worktree" tag chip, added/removed line counts, a session count, a select-all link, and an add-session button.
- **A terminal row can carry ten** in a 24px strip: selection checkbox, state glyph or spinner, bell count pill, title, note, "needs you" pill, branch badge, relative activity time, and two edge markers.
- **Repo colour is spent on every surface**: a 10% wash on group headers, 5% on rows at rest, 14% on hover, 22% on selection, 70%/30% edge rails, and the header's own text colour.
- **Terminals are listed twice.** Every terminal appears as a sidebar row and again as a tab in the tab bar above the terminal it belongs to.

The reference product the user named solves the same problem with a shorter list. Its sidebar shows a project, its branches, and five facts per branch — name, branch, lines added, lines removed, pull request number. Status, CI state, review state and links are all revealed on hover or on click. Its whole toolbar is one row: a search field and two menus. Its list is greyscale; colour is reserved for meaning — status icons, pull-request badges, and the red and green of a diff. Terminals are not in its sidebar at all: they are tabs inside the selected branch.

What that product puts in the sidebar's place, for tracking a fleet, is a **board**: cards in columns by state, with a small status icon, a label and a count on each column header, empty columns rendering as blank space, and history columns held at lower contrast. Its own summary of why is the point of this feature — the goal is to turn "check every tab in rotation" into "get pulled in only when needed".

Terminator already has the two surfaces this needs. The tab bar above the terminal already lists every terminal of the active branch. The Overview screen already draws every terminal as a tile with a live preview — but as one flat grid, with no state grouping, and its tile shows only whether a terminal is busy, not which of the four states it is in.

So this feature does two things at once, and they depend on each other:

1. **Subtract.** Take terminals out of the sidebar, cut the resting element count on what remains, collapse four bands of chrome into two, and demote colour from decoration to identity.
2. **Re-home.** Give the per-terminal state that the sidebar used to carry a better home than it had: the tab bar for the branch you are in, and a state-columned board for the whole fleet.

Neither half is shippable alone. Subtracting without re-homing destroys information; the board without the cut leaves the sidebar exactly as busy as it is now.

This does not change the underlying repo/branch/terminal model, and it does not change any published extension contribution contract.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See the whole fleet without scrolling past it (Priority: P1)

A user with several repos and a dozen branches in flight opens the app and sees, in one screenful, every branch they have work on and which of them wants their attention. Terminals are no longer listed in the sidebar; each branch is one row.

**Why this priority**: The list is the product. Every other story is cosmetic while the list is a three-level tree in which the leaves outnumber the work by a factor of two or three, and half the screen is spent before the first row appears.

**Independent Test**: Populate three repos with four branches each and two or three terminals per branch. Confirm the sidebar shows exactly three repo headers and twelve branch rows, that no terminal appears in it, and that the whole list fits without scrolling at the default window height.

**Acceptance Scenarios**:

1. **Given** a branch with three open terminals, **When** the user looks at the sidebar, **Then** the branch occupies exactly one row and none of its terminals appears as a row.
2. **Given** a branch whose terminals include one waiting on the user, **When** the user looks at that branch's row, **Then** the row reads as waiting on the user.
3. **Given** a branch whose terminals are a mix of working and idle with none waiting, **When** the user looks at that branch's row, **Then** the row reads as working.
4. **Given** a branch with no open terminals, **When** the user looks at its row, **Then** the row is still listed and reads as idle.
5. **Given** the user clicks a branch row, **When** the branch becomes active, **Then** its terminals are reachable in the tab bar above the terminal pane.
6. **Given** a scratch terminal, which belongs to no branch, **When** the user looks at the sidebar, **Then** it appears in its own section, because it has no branch to be represented by.

---

### User Story 2 - Track every terminal's state on one board (Priority: P1)

A user running a fleet of agents opens the board and sees every terminal in the app arranged in columns by what it is doing: waiting on them, working, idle, or exited. When an agent finishes or starts asking a question, its card moves to the matching column without the user doing anything. Clicking a card takes them straight to that terminal.

**Why this priority**: This is where "which terminal is in what state" is answered once the sidebar stops answering it, and it answers the question better than a list of rows ever did — across every repo and branch at once, rather than only inside the branch that happens to be selected. It is what makes the sidebar cut safe.

**Independent Test**: Open eight terminals across three branches and drive them into all four states. Open the board and, without clicking anything, name the state of all eight. Then make one agent ask a question and confirm its card moves to the waiting column on its own.

**Acceptance Scenarios**:

1. **Given** terminals in all four states, **When** the user opens the board, **Then** each terminal appears as a card in the column matching its state.
2. **Given** any column, **When** the user looks at its header, **Then** it shows a status icon, a label, and the number of cards in it.
3. **Given** a terminal that changes state, **When** the state changes, **Then** its card moves to the new column without the user reloading or re-navigating.
4. **Given** a column with no cards, **When** the user looks at the board, **Then** the column draws nothing in its body — no placeholder message and no empty-state artwork.
5. **Given** the column holding exited terminals, **When** the user looks at the board, **Then** it reads as history: visibly lower contrast than the active columns, and hidden entirely while it is empty.
6. **Given** any card, **When** the user reads it, **Then** it identifies the terminal, the branch it belongs to and the repo that branch is in, and shows when it was last active.
7. **Given** a card whose terminal has no linked issue, no change counts, or no other optional fact, **When** the user looks at it, **Then** the line for that fact is omitted rather than drawn empty.
8. **Given** a card, **When** the user clicks it, **Then** that terminal becomes the active terminal.
9. **Given** the board, **When** the user wants the previous flat arrangement, **Then** a list layout is available on the same surface, and the board is the default.
10. **Given** the board, **When** the user wants to hide a column they do not care about, **Then** column visibility is controllable, and that choice does not change what the sidebar shows.

---

### User Story 3 - Nothing is lost, only moved (Priority: P1)

A user who relied on the per-terminal information the sidebar used to show — which terminal has rung a bell, what note they left on it, how to rename or close it — finds all of it on the tab bar of the branch that owns those terminals.

**Why this priority**: The board answers fleet-wide state, but the moment-to-moment work happens inside one branch. Shipping US1 without both this and the board trades one complaint for a worse one.

**Independent Test**: Open a branch with four terminals in four different states, one carrying a note and one with unread bells. Without opening any menu, name each terminal's state, read the note, and see the bell count from the tab bar alone.

**Acceptance Scenarios**:

1. **Given** a branch with terminals in different states, **When** the user looks at the tab bar, **Then** each tab carries its own state indicator, distinguishable by shape and not by colour alone.
2. **Given** a terminal with unread bells, **When** the user looks at its tab, **Then** the tab shows the unread count.
3. **Given** a terminal carrying a note, **When** the user looks at its tab, **Then** the note is legible or reachable without leaving the tab bar.
4. **Given** the user invokes the rename or note command for the active terminal, **When** the command runs, **Then** it acts on the tab and the result is visible there.
5. **Given** a terminal that has gone stale, **When** the user wants to close it, **Then** closing it is possible without a sidebar row for it.

---

### User Story 4 - A branch row states its case in five facts (Priority: P2)

A user scanning the list reads each branch row as a short, consistent sentence rather than decoding a strip of thirteen competing marks. Anything the row used to show that is not one of those facts is revealed on hover, on click, or in the row's context menu.

**Why this priority**: The structural cut in US1 removes rows; this removes the noise inside the rows that remain. It is below the P1 set because a shorter list of busy rows is already a large improvement.

**Independent Test**: Take a screenshot of a populated sidebar and count the distinct visual elements on any one branch row at rest. Then hover the same row and confirm the demoted items appear.

**Acceptance Scenarios**:

1. **Given** any branch row at rest, **When** the user counts the elements it draws, **Then** there are no more than six, and every one of them is present because it is different on some other row.
2. **Given** a branch whose working copy is a worktree and one that is a plain checkout, **When** the user looks at both rows, **Then** they are distinguishable, and neither carries both a glyph and a separate word saying the same thing.
3. **Given** a branch with a linked issue, **When** the user looks at its row, **Then** the issue key is legible as plain text without a surrounding badge, border or state dot.
4. **Given** a branch row, **When** the user hovers it, **Then** the collapse control, add-terminal control and any registered per-repo actions appear, and the row's own facts do not move.
5. **Given** a repo header, **When** the user looks at it at rest, **Then** it shows the repo name and a count, and its folder path is available on hover rather than drawn.
6. **Given** a repo header, **When** the user hovers it, **Then** creating a new branch is offered there, and no separate always-visible row exists for that purpose.

---

### User Story 5 - One row of controls, not four bands (Priority: P2)

A user opens the app and the first row of work is near the top of the sidebar. Filtering and display options are still available, but they are behind two menus rather than spread across a chip strip, two dropdowns, a checkbox and a notice.

**Why this priority**: This is the most visible reclaim of vertical space and is independent of everything below it, but the list itself matters more.

**Independent Test**: Measure the vertical distance from the top of the sidebar to the first row of work, before and after.

**Acceptance Scenarios**:

1. **Given** the default state, **When** the user opens the app, **Then** at most two bands of chrome sit above the first row of work.
2. **Given** the user wants a saved view, a grouping or a sort order, **When** they open the controls, **Then** every one of those options is reachable from two menus in the control row.
3. **Given** any filter is active, **When** the user looks at the control row, **Then** the filter control carries a count of what is hidden, and clearing the filter is offered there.
4. **Given** a filter is hiding rows, **When** the user looks at the sidebar, **Then** no separate always-visible notice strip is drawn to say so.
5. **Given** the app-level surfaces at the top of the sidebar, **When** the user looks at them, **Then** they occupy a single compact row of icons with no text labels, and every icon has an accessible name and a tooltip.
6. **Given** a user navigating by keyboard, **When** they tab through the control row and the app icons, **Then** every control is reachable and announces itself.

---

### User Story 6 - Colour identifies a repo; it does not paint the column (Priority: P3)

A user with five repos open can tell at a glance which rows belong to which repo, from a single coloured edge. The rest of the list is neutral, so the eye is drawn by state and by selection rather than by a wash.

**Why this priority**: The colour system is the loudest single contributor to the complaint, but it is also the most recently shipped and the most self-contained, so it can land last without blocking the rest.

**Independent Test**: Render the sidebar with five repos of different colours and confirm each row's repo is identifiable, while every background in the column is a neutral surface.

**Acceptance Scenarios**:

1. **Given** rows belonging to different repos, **When** the user looks at the list, **Then** each row's repo is identifiable from a coloured edge on that row.
2. **Given** any row at rest, **When** the user inspects its background, **Then** it is a neutral surface with no repo-colour tint.
3. **Given** a row that is hovered or selected, **When** the user looks at it, **Then** the hover and selection surfaces are neutral and identical regardless of which repo the row belongs to.
4. **Given** a repo header, **When** the user reads its name, **Then** the name is drawn in a standard text colour, not in the repo's colour.
5. **Given** every preset repo colour, in both light and dark themes, **When** text is placed on any surface in the sidebar or on a board card, **Then** it meets the contrast standard the current build already guarantees.
6. **Given** a branch belonging to no repo, such as a scratch terminal, **When** the user looks at its row, **Then** it draws no coloured edge and its layout is otherwise identical.

---

### Edge Cases

- **A branch with terminals in several states at once.** The row shows one state. Precedence is fixed and documented: waiting on the user beats working, working beats idle, idle beats exited. A branch with no terminals reads as idle, not exited.
- **The same terminal in two places.** A terminal appears as a board card and as a tab. Its state must agree in both, and a state change must reach both without a reload.
- **Every terminal in one state.** The board shows one populated column and, since empty columns draw nothing, a mostly blank surface. That is the intended result and must not be filled with placeholder content.
- **A terminal that exits while its card is on screen.** It moves to the history column, which becomes visible at that moment if it was hidden for being empty.
- **A great many terminals in one column.** The column scrolls within itself; the board does not force the whole page to scroll horizontally to reach a column.
- **A filter that used to select terminals.** The built-in views filter on terminal state. With branches as the listed item in the sidebar, a branch matches a view when any of its terminals matches it. The counts shown must equal the number of rows drawn.
- **Grouping options that no longer have anything to group.** Grouping by terminal status, by branch name, or not at all were choices about how to bucket terminals. With branches as the item, only grouping by repo and not grouping remain meaningful. The obsolete options are removed rather than left inert.
- **Bulk close of stale terminals.** This acted on terminal rows and their checkboxes. It must either act on branches, or be re-homed to a surface that still lists terminals — the board is the natural candidate — or be removed. It must not be left reachable but inoperable.
- **A branch whose folder is not a git repository.** It has no branch name to be identified by, so it falls back to its user-supplied name and offers rename, exactly as today.
- **A repo collapsed to hide its branches.** Its header still reports how many branches it holds, and any of them waiting on the user is still signalled on the collapsed header.
- **The narrowest sidebar width.** With fewer elements per row, the width at which facts start being dropped must be re-derived rather than inherited; a row must never drop its branch name or its state.
- **Selecting a branch that has no terminals.** The user gets a clear way to start one; the terminal area does not show a blank pane with no affordance.
- **Restoring state on launch.** The branch that was active last is active again, and its terminals are in the tab bar; no terminal is silently lost because its sidebar row no longer exists.

## Requirements _(mandatory)_

### Functional Requirements

**Sidebar structure**

- **FR-001**: The sidebar MUST list repos and branches only. Terminals MUST NOT be drawn as sidebar rows.
- **FR-002**: Scratch terminals, which belong to no branch, MUST remain listed in their own section, since no branch row can represent them.
- **FR-003**: Each branch row MUST show a single aggregate state derived from its terminals, using the fixed precedence: waiting on the user, then working, then idle, then exited. A branch with no terminals MUST read as idle. Where the row also shows a count, that count MUST be the number of terminals in the row's own state, not the total — a branch showing the waiting glyph counts what is waiting.
- **FR-004**: A collapsed repo header MUST report the number of branches it holds and MUST still signal when any hidden branch is waiting on the user.
- **FR-005**: The always-visible "new branch" row that closes each repo's run MUST be removed, and creating a branch MUST be offered from the repo header instead.

**The board**

- **FR-006**: The app MUST provide a board that arranges every open terminal into columns by state, across all repos and branches.
- **FR-007**: The board's columns MUST be: waiting on the user, working, idle, and exited.
- **FR-008**: Each column header MUST show a status icon, a text label, and the number of cards in that column.
- **FR-009**: A column with no cards MUST draw nothing in its body — no placeholder text and no empty-state artwork. A board with no cards **at all** is a different case and MUST NOT be left as bare column headers: it MUST offer one line of explanation and one action.
- **FR-010**: The exited column MUST be presented as history: drawn at lower contrast than the active columns, and hidden entirely while empty.
- **FR-011**: A card MUST move to the column matching its terminal's state when that state changes, without user action and without a reload. The move MUST be animated over roughly 180ms, affecting only position and opacity, and only on the card that changed. Where the viewer has asked for reduced motion, the card MUST appear in its new column without animating.
- **FR-012**: A card MUST identify its terminal, the branch it belongs to, and the repo that branch is in, and MUST show when the terminal was last active.
- **FR-013**: A card MUST omit the line for any optional fact it does not have, rather than drawing an empty one.
- **FR-014**: Clicking a card MUST make that terminal the active terminal.
- **FR-015**: The board MUST be one of two layouts on the same surface, alongside the existing flat arrangement, and MUST be the default.
- **FR-016**: Column visibility MUST be controllable by the user, and that choice MUST NOT affect what the sidebar shows.
- **FR-017**: A column MUST scroll within itself when it holds more cards than fit, without forcing the board to scroll horizontally to reach another column.
- **FR-018**: A terminal's state MUST agree everywhere it is shown — board card, tab, and the aggregate on its branch row.
- **FR-019**: Card anatomy MUST follow the same restraint as the sidebar: colour is used only where it carries meaning, and hierarchy is carried by type weight, dimming, and spacing.
- **FR-020**: The live terminal preview the current tile draws MUST be preserved on the card.

**Re-homing what the terminal rows carried**

- **FR-021**: Each tab in the tab bar MUST show its terminal's state, distinguishable by shape and not by colour alone.
- **FR-022**: Each tab MUST show its terminal's unread bell count when there is one.
- **FR-023**: A terminal's note MUST remain readable and editable from the tab bar. It MUST NOT be drawn on the tab itself — it is revealed on hover. No tab may carry more than four elements at once, so that re-homing this information does not reproduce on the tab bar the density this feature removes from the sidebar.
- **FR-024**: Every command that acted on a terminal through its sidebar row — rename, note, close, move to another branch — MUST remain available from the tab bar or the terminal's context menu.
- **FR-025**: Any capability that depended on terminal rows and cannot be re-homed to the tab bar or the board MUST be removed together with its controls and its tests, and its removal MUST be stated in the pull request. It MUST NOT be left reachable but inoperable.

**Branch row anatomy**

- **FR-026**: A branch row at rest MUST draw no more than six distinct elements.
- **FR-027**: A repo header at rest MUST draw no more than three distinct elements.
- **FR-028**: A branch's kind — worktree or plain checkout — MUST be conveyed by exactly one element, not by a glyph and a separate word chip.
- **FR-029**: A linked issue's key MUST be shown as plain text without a surrounding badge, border, or state dot.
- **FR-030**: A repo's folder path MUST NOT be drawn at rest; it MUST be available on hover.
- **FR-031**: The collapse control, the add-terminal control, and any registered per-repo action icons MUST be revealed on hover, and revealing them MUST NOT shift the position of the row's resting facts.
- **FR-032**: Added and removed line counts MUST continue to appear on a branch row when they are known, and their absence MUST NOT delay the row from being drawn.

**Chrome**

- **FR-033**: At most two bands of chrome MUST sit above the first row of work in the sidebar.
- **FR-034**: All view, grouping, sorting and staleness controls MUST be reachable from exactly two menus in a single control row.
- **FR-035**: The standalone filter notice strip MUST be removed; when a filter is hiding rows, the filter control MUST carry a count and MUST offer clearing the filter.
- **FR-036**: The app-level surface band MUST render as a single compact row of icons without text labels. Every icon MUST have an accessible name and a tooltip.
- **FR-037**: The contribution contracts by which extensions register app-level surfaces and per-repo actions MUST be unchanged. Only where and how densely they are drawn may change.
- **FR-038**: Grouping options that only made sense for terminals MUST be removed, leaving grouping by repo and no grouping.
- **FR-039**: Every count displayed in the control row and on every board column header MUST equal the number of rows or cards actually drawn.

**Colour**

- **FR-040**: A repo's colour MUST appear only as a single coloured edge on the rows belonging to it, and on board cards only as the same single edge. That edge belongs to the repo alone: no other signal may claim it. In particular, the emphasis that marks a branch as waiting on the user MUST live in the state indicator rather than on the row's edge, where it would otherwise overwrite the repo's identity.
- **FR-041**: No row, header, section, or card MUST use the repo colour as a background tint at rest, on hover, or when selected.
- **FR-042**: Hover and selection surfaces MUST be neutral and identical for every repo.
- **FR-043**: A repo header's name MUST be drawn in a standard text colour, not in the repo's colour.
- **FR-044**: Every text-on-surface pairing in the sidebar and on the board MUST meet the contrast standard the current build already guarantees, for all preset repo colours, in both themes.
- **FR-045**: A row or card with no repo MUST draw no coloured edge and MUST otherwise be laid out identically to one that has a repo.

**Behaviour preserved**

- **FR-046**: The sidebar, the tab bar and the board MUST all be operable by keyboard, and every control MUST have an accessible name.
- **FR-047**: Selecting a branch MUST resolve to exactly one terminal, chosen in this order: one that is waiting on the user, else the one last active on that branch, else the most recently active. Selecting a branch with no terminals MUST offer a clear way to start one.
- **FR-048**: On launch, the previously active branch MUST be active again with its terminals present in the tab bar.
- **FR-049**: The width at which a branch row drops facts MUST be re-derived for the new anatomy. A row MUST never drop its branch name or its state.

**Presentation**

- **FR-050**: Machine facts — branch names, change counts, issue keys, paths — MUST be set in the monospaced face. Human language — repo names, terminal titles, labels and chrome — MUST be set in the proportional face. The two faces carry the hierarchy that the removed borders, badges and tints used to carry.
- **FR-051**: Board columns MUST be distinguishable from one another without colour, by position, label and count. Their state indicators MUST be flat and MUST differentiate by shape and opacity only, never by hue.

### Key Entities

- **Repo**: A checked-out repository. Has a name, a folder path, an identity colour, and holds branches. Drawn as a section header in the sidebar.
- **Branch**: The unit of work — a branch, usually backed by its own working copy. Has a name, a kind (worktree or plain checkout), an optional linked issue, added and removed line counts, and holds terminals. Drawn as one sidebar row. This is the item the sidebar is a list of.
- **Terminal**: A running session inside a branch. Has a title, a state, an unread bell count, an optional note, a last-active time, and a live preview. No longer drawn in the sidebar; drawn as a tab and as a board card.
- **Terminal state**: One of waiting on the user, working, idle, or exited. It determines which board column a terminal's card sits in, and feeds the aggregate shown on its branch row.
- **Branch state**: The single state a branch row shows, derived from its terminals by fixed precedence.
- **Board column**: A state, its icon, its label, its cards, its count, and whether it is currently visible.
- **Scratch terminal**: A terminal belonging to no branch. Listed in its own sidebar section, because nothing else can represent it, and carded on the board like any other terminal.
- **View**: A named selection over the sidebar list — which branches are shown, how they are grouped, how they are sorted.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For a setup of three repos, twelve branches and thirty terminals, the sidebar draws fifteen rows rather than forty-five — a reduction of at least 60% in rows drawn for the same amount of work.
- **SC-002**: The vertical distance from the top of the sidebar to the first row of work is reduced by at least 40% against the current build.
- **SC-003**: No branch row draws more than six elements at rest, and no repo header draws more than three, verified by counting on a screenshot of a fully populated sidebar.
- **SC-004**: Given a screenshot of a sidebar containing one branch in each of the four states, a person who has not used the app names all four correctly. (Carried forward from 032; it must survive the move to branch-level state.)
- **SC-005**: Given a screenshot of a board holding eight terminals spread across all four states, a person who has not used the app assigns every terminal to the right state without being told what the columns mean.
- **SC-006**: A user asked "which terminals need me right now?" answers correctly from the board in under five seconds, for a fleet of at least ten terminals across at least three branches.
- **SC-007**: When an agent transitions from working to waiting on the user, its card is in the waiting column within the same interval the app already guarantees for its other state indicators, with no user action.
- **SC-008**: Given a screenshot of a branch with four terminals in four different states, a person who has not used the app names all four correctly from the tab bar.
- **SC-009**: On a board where three of four columns are empty, nothing is drawn in those columns' bodies.
- **SC-010**: No surface in the sidebar or on a board card is tinted with a repo colour, verified by inspecting the rendered result rather than by reading the stylesheet.
- **SC-011**: With five repos of different colours on screen, a person correctly assigns every row to its repo.
- **SC-012**: Every count shown in the control row and on every board column header equals the number of rows or cards drawn.
- **SC-013**: Every capability the terminal rows carried is either demonstrably reachable from the tab bar or the board, or explicitly listed as removed; none is reachable but inoperable.
- **SC-014**: The sidebar, tab bar and board are operable by keyboard, and every control has an accessible name.
- **SC-015**: Text contrast in the sidebar and on the board meets the standard the current build guarantees, for all preset repo colours in both themes.

## Assumptions

- The underlying repo → branch → terminal model is unchanged. Only its representation changes; no data migration is implied.
- The tab bar above the terminal is the home for the active branch's terminals and already lists them. No new host surface is introduced for them.
- The board is a layout on the existing app-level overview surface, which already draws every terminal as a tile with a live preview. It is not a new window or a new navigation destination, and the existing flat arrangement is kept as the alternative layout.
- The board's columns are the four terminal states the app already computes. Columns describing review or merge state, which the reference product also shows, are not introduced here because the app does not compute them for a terminal.
- The published contribution contracts for app-level surfaces, per-repo actions and sidebar panels stay as they are; this feature retargets and compresses how they are drawn, which the codebase has done once before without a contract change.
- The contrast guarantees introduced with the colour system are retargeted to the coloured edge rather than deleted, so the guarantee survives the removal of the washes.
- "Six elements" and "three elements" count what is drawn at rest, excluding the coloured edge itself and excluding controls revealed on hover.
- The four built-in views are retained and re-expressed at branch level. Whether users keep custom saved views is unaffected.
- Removing terminal rows removes the surface that multi-select and bulk close operated on. This spec requires that capability to be re-homed or removed outright, and treats "removed outright" as an acceptable outcome to be stated in the pull request.
- The reference product informs the direction only. No visual asset, string, or layout is copied from it.

## Out of Scope

- The diff viewer. The reference product's three-pane diff surface is a separate, larger feature; this spec only preserves the existing added/removed counts on a branch row.
- Board columns for pull-request or review state, and any pull-request data the app does not already hold.
- Dragging a card between columns to change a terminal's state. State is observed, not assigned.
- Pinning, drag-to-reorder of branches, or user-defined groups within a repo.
- Any change to the terminal pane itself, or to the extension panels the sidebar hosts.
- Renaming the stored entities. The product says "branch" and "repo"; the code's names are unchanged.
