# ADR 074: The Forge reads one readiness

**Status**: Accepted

**Date**: 2026-09-28

Builds on ADR 045 (one standing) and ADR 069 (the red team argues before
agreement). The research is in `docs/research/forge-shaping-redesign.md`.

## Context

On WO-0928-9c6 the Forge showed five green checks over a disabled "Compile &
hand off" and gave no reason. The red team was reviewing the plan while the
header said the architect was working. Twenty-four seconds later the order
handed itself off with the proposed shape, and the ledger recorded the
agreement as the operator's. The causes:

- The header, the step marks, the "Needs you" band and the hand-off button each
  derived the order's state from different inputs.
- The red-team loop's fix turn wrote no ledger line, so the Forge read the
  order as idle and asked the operator to decide findings already being fixed.
- A turn the operator started reset the loop to round 1, and the round summary
  counted findings that were already resolved.
- The shape the operator picked was React state that nothing saved, so
  automatic hand-off ran the proposal.
- Every disabled control used the native `disabled` attribute and gave no
  reason.

## Decision

- `src/forge/readiness.ts` is the one derivation for a draft order. It returns
  who holds the order, the status strip, the six hand-off rows (the five
  compile checks plus "Nobody is changing the plan"), each step's state word,
  the red-team findings grouped by who acts, and the reason each lockable
  control is locked. The Forge draws what it returns and decides nothing.
- A failing check that a running machine turn may close is "in progress", never
  red. Red means the operator has to fix it. Orange means only the operator can
  decide it.
- Every turn writes a start line. The loop's fix turn records
  `converge.started` with reason `red team round N fix`. `lastIntake` reports
  the actor, the trigger, the round and the automatic turn number.
- Operator turns continue the loop's round count. `review.round` counts only
  open findings.
- The operator can hold the loop (`review.held`) and let it continue
  (`review.released`, which resumes the next automatic step).
- Automatic hand-off records the agreement with actor `rule:forge`. The Forge
  shows the `autoHandOff` toggle and says in advance which shape it will use.
- The shape pick is saved to `order.recipe` through `foundry:order.recipe` and
  recorded as `recipe.chosen`. `recipeLadder` already reads `order.recipe`
  first, so both hand-off paths run the pick. The proposal is computed without
  the pick.
- A control that cannot be used is a `ReasonButton`. It renders
  `aria-disabled` with `aria-describedby`, so it stays focusable and its reason
  is reachable by hover, keyboard and screen reader. Clicking it shows the
  reason inline.

## Alternatives

- **Patch each surface.** Leaves four derivations to drift apart again.
- **One approval screen with no steps.** Removes the shape override and the
  other controls the operator needs.
- **Native `title` on disabled buttons.** A disabled button cannot be focused,
  so keyboard users never reach the reason.
