# 062 — The Forge stops only for show-stoppers

**Status:** ratified 2026-09-26, from the operator's request: "it should only
stop for actual show stopping events … if the option they come up with is
greater than a 90% confidence level just go with that, do not bother me."

## Requirements

- **FR-1** Each open question carries the architect's `confidence` (0–1) in its
  recommended option. At 0.9 or above the Forge takes that option itself and
  records it as a strikeable assumption (`A-<question id>`).
- **FR-2** The architect's brief names every open red-team finding. It may
  dismiss a low or medium finding it is at least 90% sure does not apply, with
  a reason; high-severity findings are fixed or left for the operator.
- **FR-3** When a turn ends with checks the architect can close still failing,
  the Forge sends it back on its own, up to two times, before stopping. Open
  questions are never sent back — they are the operator's.
- **FR-4** A follow-up turn ends the previous architect process before it
  resumes the conversation.

## Acceptance

- **AC-1** A question proposed at confidence ≥ 0.9 arrives answered, with an
  assumption saying what was decided.
- **AC-2** A dismissed high-severity finding stays open.
- **AC-3** A proposal that still fails coverage starts a follow-up turn without
  anyone clicking; after two follow-ups it stops.
