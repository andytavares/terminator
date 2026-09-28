# ADR 079: A station shows its own work

**Status**: Accepted

**Date**: 2026-09-28

Amends ADR 060 (a factory is a projection): station nameplates are replaced by
floor stencils, and stations animate from what their step is doing.

## Context

In the factory hall a running station looked the same as an idle one.

- Every tool call that closed sent the crew member back to their seat with
  `idle` (`factory/director.ts` `applyTool`, the stale drop in
  `applyOpenCallWalks`, and `applyStranded`). A desk lights its screens only
  for a typing crew member, so a step went dark after its first tool call and
  stayed dark while it kept working.
- The integrate press strokes only for a typing crew member, but a join step
  has no role and is not a crewed kind, so no crew member ever sat there. No
  shipped recipe gives a join a role.
- Desk tool calls were dropped before they reached `World.openCalls`, so the
  art could not tell editing from reading from running a command.
- Nameplates were HTML boxes up to 4.6 tiles wide and two lines tall, 10px
  above the station. The row above a station is the head row or the band
  above's belt row, so plates covered belts and neighbouring stations.

## Decision

- A crew member back from a tool call, a dropped stale call or a stranded
  pause returns with their station's work animation (`workAnimFor`). A resting
  or slumped crew member is left alone, since a close can arrive after the
  step itself finished.
- Desk calls are remembered in `openCalls` and never walked for. The scene
  reads the newest open call per node as `SceneContext.tools`.
- A step that moves to passed or failed leaves a `Verdict` on the world for
  1.6s. The rig shows a tick or cross, the bench a stamp, and a passing gate
  swings its arm.
- Each animation has one cause. Desk screens show the open call (a terminal,
  a page being read, code being edited) or a typing crew member. The rig and
  bench animate while scanned. The press animates while its step is running or
  verifying, with no crew. The rack and shelves animate while a crew member
  stands at them reaching. Decor keeps its clock.
- Station names are baked into the floor in a 3×5 stencil font
  (`factory/art/glyphs.ts`), above a desk, rig or bench and below a press or
  gate. Belts and crew draw over them, so a name never covers anything. The
  text is built from the node (`signText`): the role or step, then the unit id
  when there is exactly one, capped at the station's width. The full label
  stays in the station button's tooltip and accessible name.

## Consequences

- A belt crossing the row above a station hides part of its stencil. That is
  the price of never covering anything.
- The stencil font has A–Z, 0–9, `-`, `.` and space. Any other character in a
  role or step id is drawn as `-`.
- Callouts no longer stack around nameplates, since there are none.
