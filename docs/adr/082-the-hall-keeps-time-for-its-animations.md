# ADR 082: The hall keeps time for its animations

**Status**: Accepted

**Date**: 2026-10-05

Amends ADR 060 (a factory is a projection) and ADR 079 (a station shows its
own work).

## Context

Three things made the hall hard to read in a real run
(`WO-1006-6b5`).

- A replay spent 168s of 547s showing nothing. `momentsOf` counted every tool
  call, including about 108 from shaping sessions (scout, architect, red team)
  that map to no step. The clock began long before any step moved.
- Document, integrate and ship passed within 2ms. `direct` applies a whole diff
  at once, so a gate was drawn open before the crate reached it. A crate rides a
  belt in about 0.94s, a verdict flashes for 1.6s and the arm of a gate swings
  in 0.4s.
- Once a crew member sat down in the breakroom, nothing moved them again. A hall
  full of finished steps was a still photograph.

## Decision

- The clock of a replay counts only moments that show something. Tool calls
  from a session that no step carried in any recorded frame add no moments. The
  clock starts one second before the first frame in which a step is past
  `waiting`.
- `factory/beats.ts` sits between `diffObservation` and `direct`, live and in a
  replay.
  - An event for a step is released no sooner than the minimum dwell (crate
    ride plus verdict flash, 2.54s) after the last passed or failed event of a
    step that it depends on. The own events of a step keep their order.
  - Lag is capped at 10s. Past that, the remaining beats release together, in
    order, so the scene catches up.
  - The node states that the scene draws come from released events, not the raw
    observation. The heads-up display, the interruption list and the replay
    time still show the observation and real time.
  - A hand-off is released with the pass of its feeder. It says that its target
    has started only if the scene is already showing it started.
  - A join that passes without ever being seen running is released running for
    one stroke first (0.7s), because the press animates only while its step is
    running. The real pass causes that event. It is the only event that the
    scheduler invents.
  - The scheduler is pure: the same events at the same times release the same
    beats. A seek rebuilds it settled. The end of a replay releases whatever is
    still held.
- An idle crew member walks. Every 20 to 40s a crew member resting in the
  breakroom walks to a loiter point (beside the coffee bar, the vending machine
  or a belt, reachable from the breakroom door). The crew member lingers 3 to 6s
  and walks back to the same seat, which stays reserved throughout. The timings
  and the point are seeded from the node id and the world clock with
  `mulberry32`. Nothing reads `Math.random` or `Date`. A real node-state event
  sent through `sendTo` clears the stroll and always wins.

## Amendments

- ADR 060: the breakroom is still the one place where crew idle. Idling now
  includes ambient strolls. They are the one motion that has no event as its
  cause. They are seeded and deterministic, they leave no mark on the run, and
  they never take a crew member from a seat that something real has assigned.
- ADR 079: the beat scheduler may delay an animation, and never skips it. Every
  event that a diff produces is released, in order. The single synthesised press
  stroke exists only to draw a pass that was never seen running.

## Consequences

- A scene can lag the run by up to 10s while a burst of steps plays out.
- A replay is shorter than before. A seek to a moment before the first movement
  lands on the first frame.
- A resting crew member may be away from their seat when someone takes a
  screenshot.
