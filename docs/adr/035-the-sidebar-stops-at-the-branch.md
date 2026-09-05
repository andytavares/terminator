# ADR 035: The sidebar stops at the branch

**Status**: Accepted

**Date**: 2026-09-05

## Context

Feature 032 was written as an addition. Its stated input was "put on the row everything the other four surfaces already know", answering an audit finding that the sidebar row "carries the least: a name and an age". Feature 033 then ran each repo's identity colour down the whole column as background washes and edge rails.

Both did what they set out to do. Together they produced a list that is hard to read. Measured on the build this replaces:

- **Four stacked bands of chrome** sat above the first row of work — the app band, the search row, the view bar, and the filter notice — taking 165px before a single piece of work appeared.
- **A branch group header could carry thirteen elements** in a 28px strip; a terminal row **ten** in a 24px strip.
- **Repo colour was spent on every surface**: 10% on a header, 5% on a row, 14% on hover, 22% on selection, plus 70%/30% edge rails and the header's own text colour.
- **Every terminal was listed twice** — once as a sidebar row, and again as a tab in the tab bar above the terminal it belongs to.

The last point is the one that mattered. `TabBar` already lists every terminal of the active branch, so the sidebar's terminal rows were a second rendering of the same set, and they were what made the list a three-level tree in which the leaves outnumbered the work by a factor of two or three.

## Decision

**The sidebar lists repos and branches only.** A terminal is not a sidebar row.

Each branch is one row carrying a single state folded from its terminals, by fixed precedence: waiting on the user, then working, then idle, then exited. A branch with no terminals reads as idle — a branch you have not opened yet is not a finished one.

The one exception is a scratch terminal, which belongs to no branch. Nothing else can represent it, so it keeps its own section, drawn with the same row component: in that section a scratch terminal _is_ the unit of work.

Three things make the removal safe rather than lossy:

1. **The tab bar** carries per-terminal state, bell counts and notes for the branch you are in (see the four-element cap below).
2. **The board** (ADR 036) answers "which terminal is in what state" across every repo at once.
3. **Everything a terminal row could do** — rename, note, close, move to another branch — is reachable from the tab.

## Consequences

**What this buys.** For three repos, twelve branches and thirty terminals the sidebar draws fifteen rows rather than forty-five. Chrome above the first row falls from 165px to 98px, measured against the running app.

**What it costs.** Stale multi-select and bulk close operated on terminal rows and their checkboxes. They had no surface left, and neither re-homing option was good — the board's job is "what is happening now", and checkboxes on cards would re-import the density this feature removes. They are deleted, with `BulkCloseDialog` and their tests. The `Stale` view survives as a filter: it still answers "which branches have gone quiet", it just no longer offers a multi-select.

**Grouping options narrow.** Grouping by branch, by branch name or by status were choices about how to bucket _terminals_. With branches as the item, only grouping by repo and not grouping remain. `GroupKey` narrows to `'workspace' | 'none'`, and a stored preference naming a retired key degrades to the view's own default rather than emptying the sidebar.

**`buildGroups` is deleted.** `buildBranchRows` was written beside it rather than replacing it in place, so the switch landed under a passing suite; `buildGroups` came out in one commit at the end, once nothing imported it. The difference that matters is that a branch is a row **unconditionally** — `buildGroups` seeded empty project buckets only while the view was un-narrowed, whereas a branch is the unit of work and exists in its own right.

## Alternatives considered

**Keep terminal rows but strip them to a glyph and a title.** The smallest change, and it was on the table. Rejected because it leaves the three-level tree and its row count intact — the complaint was the number of rows as much as what was on them.

**Collapse branches by default so their terminals are hidden until expanded.** Preserves the model exactly, and matches how the reference product collapses a project. Rejected because the density returns the moment you expand, and the information the expansion reveals is the same information the tab bar already shows for the branch you are actually in.

**Keep the rows and remove the tab bar instead.** Rejected outright: the tab bar is where you switch terminals while working, and moving that into a sidebar you have to travel to would be worse for the common case.
