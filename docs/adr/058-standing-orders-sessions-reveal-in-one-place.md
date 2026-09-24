# ADR 058: Standing orders sessions, and a session is revealed in one place

**Status**: Accepted

**Date**: 2026-09-23

**Amends**: ADR 054. Home and the wall keep their surfaces, the one-grid invariant and the two link levels. What changes is how sessions are ordered, how state is coloured, and that a session link now reaches the agent.

## Context

Four problems with Home and the wall were reported and traced (`docs/research/session-surface-repairs.md`):

- **Home was monochrome.** State was drawn by glyph shape and opacity only, so a session waiting on the operator looked like any other.
- **Busy sessions swapped places.** Every sort keyed on `lastActivityAt`, which `session-controller` restamps once a second for any session producing output. A live probe measured 10 swaps in 10 s on Home and 8 on the wall.
- **Opening a session didn't always focus it.** There were seven separate "go to session" paths. Quick Actions left Home on screen with focus on the body. Focus was only a side effect of remounting a terminal, so re-selecting the active session never focused it. A macOS banner click ran nothing unless the notification had action buttons.
- **A session link didn't travel.** A ticket linked to a terminal on Home or the wall never showed on that terminal in the sidebar or tab bar, and never reached the agent. Only a branch link wrote SessionStart context.

## Decision

**A session's position follows its standing, not its output.**

- Standing ranks are: needs you, then running (working and idle together), then exited. Within a rank, sessions order by start time.
- "Recent" means recently _opened_ (`lastAttendedAt`).
- On Home, needs-you sessions are lifted into a first group. The Logbook folds Working and Idle into Running.
- A session also stays Working until 5 s of quiet (the screen is still read at 1.5 s), so a short pause no longer flips its state.

**State is coloured on fills and edges, never on the glyph or the words.**

- `StateChip` draws a label on a tinted fill with a coloured edge: amber for needs you, green for working, neutral otherwise.
- The glyph keeps `currentColor` and opacity (Constitution XII), and the label stays in the text colour. `--warning` and `--accent` fail AA as text but clear 3:1 as fills and edges.
- The sidebar gutter uses the compact chip.

**Every path to a session goes through `revealSession`.**

- It leaves Home, the wall and any tab; switches workspace or scratch; activates the session; and stamps a focus request.
- The pane focuses on the request's nonce, so re-selecting the active session still focuses it.
- A notification may name a session, and clicking it reveals that session.
- A native banner click runs `onClick`, falling back to the first action.

**One reader for a session's work item, one writer per level.**

- Every surface reads `SessionFacts.workItem` (own link, else branch link).
- A terminal's own link is shown on its sidebar row and its tab. Link, Change and Remove go through `SessionLinkDialog` everywhere.
- Quick Actions "Link issue" links the focused terminal; "Link issue to branch" links the branch.
- A session link writes a per-session context file. The user-level SessionStart hook prints it for the terminal named by `TERMINATOR_SESSION_ID`, and the project hook stays silent for that session, so the session link wins.

## Alternatives considered

- **Colour the state glyphs.** Violates XII, and the accent fails AA.
- **Sticky or hysteresis ordering.** Carries state between renders, breaks the pure `sidebar/` layer, and still moves rows, only later.
- **Focus on every active-session change.** Misses re-selecting the active session and the paths that never leave Home.
- **Patch each navigation call site.** Fixes today; the next path added misses it again.
- **Collapse to one link level.** Session-only loses the branch default; branch-only loses two tickets on one branch. Either way it reverses ADR 054.

## Consequences

- A session that just printed no longer jumps up. The age column and the chip still show activity.
- An agent is shown Working for up to 5 s after it goes quiet. A choice prompt is still caught at 1.5 s, because awaiting-input outranks busy.
- The user-level hook now prints context for app-launched sessions that carry a session link. With no session context file it prints nothing, as before.
- The session context file goes when the link, the session or its record goes.
- Quick Actions "View linked issue" still opens the branch's issue drawer, which takes only a project. When a session's own link differs from its branch's, View shows the branch ticket while Copy and Open follow the session's.
