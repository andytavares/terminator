# ADR 087: The hall labels what it draws

**Status**: Accepted

**Date**: 2026-10-05

Amends ADR 060 (a factory is a projection), ADR 079 (a station shows its own
work) and ADR 081 (a station opens into its monitor).

## Context

A live run (`WO-1006-6b5`) showed signs nobody could read.

- The scoreboard drew "25 0 0" on a fixture one tile wide. The zeros spilled
  onto the wall beside it and nothing said which number was lead time, which
  was reworks and which was CI fix rounds.
- The queue plate drew its digit two pixels past the plate.
- The split junction was an amber square and the merge a steel one. Neither
  said where it led.
- The CI tower drew one lamp per check. Nineteen checks ran about four tiles
  down the wall, and a pending check raised nothing at all, so waiting on CI
  looked like a hall with nothing happening. A replay recorded no CI, so it
  could not show the wait either.
- A gate or a join opened a monitor reading "DONE ATTEMPT 0", "NOTHING YET."
  and an ATTACH key that could only fail.

## Decision

- Every fixture that encodes a value has a label in the scene. `factory/signs.ts`
  derives one sentence per fixture, purely. The hall shows it as a tip on hover
  or focus over the fixture and gives the fixture the same words as its
  accessible name.
  - Scoreboard: "Lead time 25 min · 0 reworks · 0 CI fix rounds" (a lead time
    the order has not earned yet reads "Lead time not known yet").
  - Queue plate: "1st in the merge queue".
  - Split junction: "Splits to Inspector and Scribe". Merge junction: "Merges
    into Integrate". Names come from the station labels.
  - CI tower: "Waiting on checks · 12 of 19 done", or "Checks · 17 passed · 2
    failed" once nothing is pending.
- A fixture draws an aggregate, not one mark per item. The tower has three
  lamps (passed, pending, failed) each with its count in one-pixel digits, so
  its size does not depend on how many checks a repository has. A skipped check
  counts with the passed and a cancelled one with the failed (`ci-tally.ts`).
  A count above 99 draws as 99; the hover sentence carries the real one.
- Art stays inside its fixture. `art/fixtures.ts` is the one place that says
  how big a sign is: the scoreboard is three tiles (one cell per figure, an icon
  above each number), the queue plate is sixteen pixels square with a
  one-pixel digit on whole pixels, the tower is its tile less a pixel each side.
  The art specs paint into a recording buffer and fail on any pixel outside.
- The progress bar is gone from the scoreboard. The heads-up display already
  shows it.
- A junction shows its job. A split is a hub with an arm into each outgoing
  belt; a merge is a funnel narrowing into the outgoing belt.
- Waiting on CI is visible, live and in a replay.
  - While any check is pending the tower's amber beacon blinks (it burns steady
    under reduced motion), a crate waits at the exit, and a callout stays
    pinned to the tower until the last check lands.
  - The timeline gains a `ci` line, written whenever the status, the round or
    any check's bucket changes, and `observationAt` rebuilds it, so a replay
    shows the wait and the hall draws a tower for it.
  - A ship step that stays `running` through the final check and CI shows its
    gate with a steady cyan beacon: busy, neither idle grey nor open green.
- A monitor on a step with no agent says so. A gate or join shows "Automatic
  step · no agent", no attempt count, and what the step decided
  (`step-facts.ts`): "Draft opened · #233", "Checks · 12 of 19 passed", "Waiting
  on you · mark ready?", "Joined Inspector and Scribe". It has no ATTACH key.
  A finished agent keeps its transcript and its key is disabled and reads
  "AGENT CLOSED".

## Consequences

- The scoreboard fixture is now three tiles wide, so the layout's golden
  output changed for the scoreboard's `x` and `w`, and the baked vending
  machine is placed by `vendingDecorX` to clear every wall fixture.
- `Timeline` gains an optional `ci`, so recordings made before this change
  still replay, with no tower.
- `writeCiState` appends the timeline line, best effort, as `writeRunGraph`
  does.
- A new fixture that encodes a value adds a sign in `signs.ts` and a bounds
  test beside the others, or it is not finished.
