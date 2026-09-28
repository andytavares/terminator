# ADR 069: The red team argues before agreement

**Status**: Accepted, amended by ADR 075 (one pass unless the red team asks for another)

**Date**: 2026-09-26

Supersedes the part of ADR 062 that kept high-severity findings the operator's,
and the `challenge` step of the `standard` and `design-doc` recipes.

## Context

TAV-15 (order WO-0927-4fd) is a one-line filter. In 26 minutes it went through
five red-team rounds and 30 findings, stopped the operator five times, grew from
2 files to 13, and never reached a builder. The research is in
`docs/research/foundry-red-team-loop.md`. The causes were mechanical:

- The agent red team ran on the Line, after agreement, and any finding of any
  severity raised `forge-defect` and sent the order back to draft.
- The gate's "Answer" called `resume` on a draft, which refused, and nothing
  read the refusal.
- The operator could clear one finding per architect turn, and every clearance
  meant re-agreeing and re-running the red team from nothing.
- The red team saw only open findings, so it raised settled ones again in new
  words.
- Nothing separated "this change is wrong" from "a doc or an ADR is missing".

## Decision

- A finding carries a `category`. Only `wrong-outcome`, `regression` and
  `unprovable` block (`BLOCKING_CATEGORIES`, `isBlocking`). `scope`, `process`,
  `pre-existing` and `infra` are notes the builder sees, and the `redTeam`
  compile check ignores them.
- The red team reads every earlier finding and how it was settled. It may reopen
  one only with `reopens` and `newEvidence`. A near-duplicate headline is dropped
  when read back.
- The review runs in the Forge (`src/forge/review-loop.ts`). Once a redraft
  passes every other check, a red-team round runs. The architect gets every
  blocking finding in one turn, on the draft model, and the next round attacks
  only what changed. After `MAX_REVIEW_ROUNDS` (3) rounds the order goes to the
  operator.
- A clean round hands off on its own. `terminator.foundry.autoHandOff` defaults
  to on. `ready-for-review` stays unconditional.
- The scout reads the repository before the first draft.
- The architect may dismiss a finding of any severity at the confidence bar,
  because the bar for blocking now sits in `category`.
- The Forge's "Needs you" band collects answers, fixes and accepts, and sends
  them as one settle. It stays usable while a turn runs and queues until the
  turn ends.
- On the Line, "Answer" on `forge-defect` starts that one architect turn.
  `resume` refuses while the run is already executing, and a refused resume
  becomes `gate.action_failed`.
- A lane checkout symlinks the origin's `node_modules`, only where the
  repository already ignores it.

## Alternatives

- **Prompt-only tuning.** Leaves the one-at-a-time loop and the no-op Answer in
  place.
- **Let the architect dismiss everything without a bar.** Moves the strictness
  problem into a confidence number.
- **Drop the red team.** Loses the one finding on TAV-15 that mattered: the
  filter keyed on a field list results don't have.

## Consequences

- An order reaches the operator only when three rounds could not settle it, or
  when a question is below the confidence bar.
- The Forge takes up to three red-team sessions longer before hand-off, and the
  Line takes one fewer.
- A red team that files a real defect as `process` gets past the bar. The
  verifier and inspector still run on the Line, and `review.round` records the
  blocking and note counts, so the calibration can be audited.
