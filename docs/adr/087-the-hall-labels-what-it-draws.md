# ADR 087: The hall labels what it draws

**Status**: Accepted

**Date**: 2026-10-05

Amends ADR 060 (a factory is a projection), ADR 079 (a station shows its own
work) and ADR 081 (a station opens into its monitor).

## Context

A live run (`WO-1006-6b5`) showed signs that nobody could read.

- The scoreboard drew "25 0 0" on a fixture one tile wide. The zeros spilled
  onto the wall beside it. Nothing said which number was lead time, which was
  reworks and which was CI fix rounds.
- The queue plate drew its digit two pixels past the plate.
- The split junction was an amber square and the merge a steel one. Neither
  said where it led.
- The CI tower drew one lamp per check. Nineteen checks ran about four tiles
  down the wall. A pending check raised nothing at all, so waiting on CI looked
  like a hall with nothing happening. A replay recorded no CI, so it could not
  show the wait either.
- A gate or a join opened a monitor that read "DONE ATTEMPT 0", "NOTHING YET."
  and an ATTACH key that could only fail.

## Decision

- Every fixture that encodes a value has a label in the scene.
  `factory/signs.ts` derives one sentence per fixture, purely. The hall shows
  the sentence as a tip on hover or focus over the fixture. It gives the fixture
  the same words as its accessible name.
  - Scoreboard: "Lead time 25 min · 0 reworks · 0 CI fix rounds" (a lead time
    that the order has not earned yet reads "Lead time not known yet").
  - Queue plate: "1st in the merge queue".
  - Split junction: "Splits to Inspector and Scribe". Merge junction: "Merges
    into Integrate". Names come from the station labels.
  - CI tower: "Waiting on checks · 12 of 19 done", or "Checks · 17 passed · 2
    failed" once nothing is pending.
- A fixture draws an aggregate, not one mark per item. The tower has three lamps
  (passed, pending, failed). Each lamp shows its count in one-pixel digits, so
  the size of the tower does not depend on how many checks a repository has. A
  skipped check counts with the passed, and a cancelled check with the failed
  (`ci-tally.ts`). A count above 99 draws as 99. The hover sentence carries the
  real count.
- Art stays inside its fixture. `art/fixtures.ts` is the one place that says how
  big a sign is. The scoreboard is three tiles (one cell per figure, an icon
  above each number). The queue plate is sixteen pixels square with a one-pixel
  digit on whole pixels. The tower is its tile less a pixel each side. The art
  specs paint into a recording buffer and fail on any pixel outside.
- The progress bar is gone from the scoreboard. The heads-up display already
  shows it.
- A junction shows its job. A split is a hub with an arm into each outgoing
  belt. A merge is a funnel that narrows into the outgoing belt.
- Waiting on CI is visible, live and in a replay.
  - While any check is pending, the amber beacon of the tower blinks (it burns
    steady under reduced motion), a crate waits at the exit, and a callout stays
    pinned to the tower until the last check lands.
  - The timeline gains a `ci` line. The app writes it whenever the status, the
    round or the bucket of any check changes. `observationAt` rebuilds it, so a
    replay shows the wait and the hall draws a tower for it.
  - A ship step that stays `running` through the final check and CI shows its
    gate with a steady cyan beacon: busy, neither idle grey nor open green.
- A monitor on a step with no agent says so. A gate or join shows "Automatic
  step · no agent", no attempt count, and what the step decided
  (`step-facts.ts`): "Draft opened · #233", "Checks · 12 of 19 passed", "Waiting
  on you · mark ready?", "Joined Inspector and Scribe". It has no ATTACH key. A
  finished agent keeps its transcript. Its key is disabled and reads "AGENT
  CLOSED".

## Consequences

- The scoreboard fixture is now three tiles wide. So the golden output of the
  layout changed for the `x` and `w` of the scoreboard. `vendingDecorX` places
  the baked vending machine to clear every wall fixture.
- `Timeline` gains an optional `ci`, so recordings made before this change
  still replay, with no tower.
- `writeCiState` appends the timeline line, best effort, as `writeRunGraph`
  does.
- A new fixture that encodes a value adds a sign in `signs.ts` and a bounds test
  beside the others. If not, it is not finished.
