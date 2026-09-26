# ADR 067: The refinery restacks, it never merges

**Status**: Accepted

**Date**: 2026-09-26

## Context

Every order is cut from its base branch and knows nothing of the others. Two
orders that change the same files both open drafts against the same base;
when the operator merges the first, the second is now behind, and whether it
still applies is found out by hand. The software factory pattern handles this
with a refinery: a queue that restacks later work onto what landed.

## Decision

- `queue()` groups running and shipped orders by repository and base, orders
  them by agreement, and marks which earlier orders each one overlaps, by the
  files their lanes changed (the plan's `touches` before any work exists).
  Orders against different bases never queue together.
- At agreement the Forge says, as an advisory and never a failing check,
  which orders a new one will queue behind.
- A 60-second tick while the application is open asks GitHub whether each
  shipped draft merged (`gh pr view --json state,mergedAt`). When one has, each
  later overlapping order is restacked lane by lane: fetch, rebase onto the base,
  push the lane's own branch **with lease**. Its CI is then watched again, one
  round (ADR-064), and it gets its ready gate or `ci.red` anew.
- A rebase that conflicts is aborted, leaving the checkout as it was, and
  raises `refinery.conflict` with the files. It offers taking it over or
  holding, and is live at every autonomy level.
- `refinery.json` per order records when it merged and which merges it was
  restacked after, so each merge is acted on once. Ledger: `refinery.merged`,
  `refinery.rebased`, `refinery.conflict`, `refinery.failed`.

## Alternatives

- **Foundry merges in queue order.** Rejected: merging stays the operator's
  (the ready gate never merges anything).
- **Raise `destructive` for the force-push.** Rejected: the branch is
  Foundry's own draft branch and the push is `--force-with-lease`, so it cannot
  overwrite work it has not seen.
- **Restack every later order, overlapping or not.** Rejected: an order that
  shares no files with what merged gains nothing from a rebase and pays a CI
  round for it.

## Consequences

- A merge while the application is closed is noticed on the next tick after it
  opens.
- Overlap is by path. Two orders that touch different files but conflict
  semantically are not queued; CI after the merge is where that shows.
