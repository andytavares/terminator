# ADR 090: Foundry never stops without saying why

**Status**: Accepted

**Date**: 2026-10-07

Amends ADR 078 (hand-off is always the operator's) and ADR 045 (one standing
read by every surface).

Numbered 090 because order WO-1008-287 adds an ADR 089 on its own branch.

## Context

Order WO-1008-287 was handed off at 21:55. At 22:04 the inspector raised
`forge-defect`, which sent the order back to `draft`. The operator pressed
**Answer** and the architect amended the plan at 22:05. Every check passed,
and nothing happened after that. The only notice was a toast. Both tab badges
read 0, and the Inbox said "Nothing needs you".

Five separate places let an order stop without telling anyone:

1. The standing of a passing draft said "It starts on its own". Since ADR 078,
   nothing starts a draft on its own.
2. A draft whose architect had finished with checks still failing said "still
   shaping".
3. A refused red-team round writes `red-team.refused`. The ledger reader looked
   for `review.refused`, which nothing writes, so the Forge showed the red team
   working for ever.
4. Answering `forge-defect` started an architect turn without recording
   `converge.started`, so the turn showed up nowhere.
5. The badge and the Inbox counted only gates, questions and held tool calls.

## Decision

1. **A released order restarts after an amendment.** `forge/release-again.ts`:
   when a draft passes every check and its ledger already has `order.agreed`,
   Foundry agrees it again as `rule:forge` (with `automatic: true` on
   `foundry:order.compile`) and starts the run on the shape the operator chose.
   If either step fails, it records `run.refused` with the reason and shows a
   toast. A draft that was never agreed still waits for **Hand off**.
2. **The standing knows when nothing is shaping a draft.** `shapingFor` is true
   while an architect, red-team or scout session is live, or while Foundry is
   choosing what to start after a turn (`whileDeciding` in `index.ts`). When
   nothing is shaping the draft, it is the operator's move: **Ready to hand
   off**, or **Shaping stopped**, which names the first check that still fails.
3. **An agreed order whose run refused to start** reads **The run did not
   start**, with the reason (`run.refused` in `line/run-outcome.ts`).
4. **Every order waiting on the operator is counted and listed.**
   `ordersWaiting` (`gates/attention.ts`) takes every order whose turn is the
   operator's and that no gate, question or held tool call already counts. Each
   one adds to the Inbox badge and gets an Inbox row with its headline, its
   reason and **Open**. All three surfaces build their standings from
   `order/order-standing-sources.ts`.
5. The ledger readers use the actions that are actually written:
   `red-team.refused`, and `converge.started` when **Answer** starts a turn.

## Consequences

- `tests/hand-off.spec.ts` now allows two `runs.start` calls: the operator's
  channel, and the restart inside `handOffWhenReady`.
- An order can only sit still in one of two places: under a counted Inbox row,
  or under a live session.
