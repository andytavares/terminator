# ADR 080: A final check asks whose failure it is

**Status**: Accepted; "Fix it first" replaced by ADR 088

**Date**: 2026-09-28

Amends ADR 063 (a failed check sends the work back) for the final check.

## Context

Order WO-0928-e4a changed the Linear provider and its docs. Its final check,
`npm run test:e2e`, failed one of 191 tests: `session-home.spec.ts:47`, which
never touches Linear and passed 124 of 124 times on a clean `main`. The only
gate offered was `verify.repeat-fail`, whose Send back hands the failure to the
builder and re-runs everything. The builder had nothing to fix, the suite ran
again, and the same gate came back. Nothing told a flaky test or a check that
already fails on the base branch apart from one the change broke, and every
send-back was recorded as attempt 1, so nothing capped the loop.

## Decision

When the final ladder fails, `line/executor.ts` asks three questions in order.

1. **Is it flaky?** The ladder is climbed once more in the lane. Passes on the
   same commit are cached, so only the failed rung and those after it run. If
   it passes, `verify.flaky` is recorded with both logs and the run carries on.
2. **Does it fail without this change?** The rungs up to the failing one are
   climbed in a detached checkout of the base branch (`ensureBaseCheckout`,
   removed afterwards). If the base fails too, a new gate, `verify.base-fail`,
   offers **Fix it first**, **Accept the debt** or **Hold**. Send back is not
   offered, because the builder cannot fix what its change did not cause.
3. **Otherwise the change caused it.** `verify.repeat-fail` is raised as
   before, saying it passes on the base branch. After two send-backs Send back
   is no longer offered, and the builder's feedback carries the real attempt
   number.

**Fix it first** opens a draft order in the Forge to fix the check on the base
branch, seeded with the command, the base log and where it was found. The
blocked order records `waitingOn` in its refinery state, and its standing
says it is waiting for that order to merge. When the fix merges, the refinery
restacks the waiting order onto the new base and resumes it, which runs its
final check again. A restack conflict is raised as today, and a transient
failure leaves it waiting for the next tick.

If the base checkout cannot be made or the runner is missing, the result is
"could not check", never "passes", and `verify.repeat-fail` is raised with that
note.

## Consequences

- A failing final check now costs up to two more climbs: one retry, and the
  base up to the failing rung.
- The fix order goes through the Forge like any other. Hand-off stays the
  operator's (ADR 078).
- Evidence gained optional `step` and `command`, so the fix order reads them
  instead of parsing the gate's wording.
