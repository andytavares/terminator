# ADR 067: The refinery restacks, it never merges

**Status**: Accepted

**Date**: 2026-09-26

## Context

Every order is cut from its base branch and knows nothing of the others. Two
orders that change the same files both open drafts against the same base. When
the operator merges the first, the second is behind. The operator finds out by
hand whether it still applies. The software factory pattern handles this with a
refinery: a queue that restacks later work onto what landed.

## Decision

- `queue()` groups running and shipped orders by repository and base, and
  orders them by agreement. It marks which earlier orders each one overlaps, by
  the files that their lanes changed (the `touches` of the plan before any work
  exists). Orders against different bases never queue together.
- At agreement the Forge says which orders a new one will queue behind. This is
  an advisory and never a failing check.
- A 60-second tick while the application is open asks GitHub whether each
  shipped draft merged (`gh pr view --json state,mergedAt`). When one has
  merged, each later overlapping order is restacked lane by lane: fetch, rebase
  onto the base, push the own branch of the lane **with lease**. Its CI is then
  watched again for one round (ADR-064). It gets its ready gate or `ci.red`
  anew.
- A rebase that conflicts is aborted and leaves the checkout as it was. It
  raises `refinery.conflict` with the files. It offers taking it over or
  holding, and is live at every autonomy level.
- `refinery.json` per order records when the order merged and after which
  merges it was restacked, so each merge is acted on once. Ledger:
  `refinery.merged`, `refinery.rebased`, `refinery.conflict`,
  `refinery.failed`.

## Alternatives

- **Foundry merges in queue order.** Rejected. Merging stays the operator's
  (the ready gate never merges anything).
- **Raise `destructive` for the force-push.** Rejected. The branch is the own
  draft branch of Foundry, and the push is `--force-with-lease`. It cannot
  overwrite work that Foundry has not seen.
- **Restack every later order, overlapping or not.** Rejected. An order that
  shares no files with what merged gains nothing from a rebase and pays a CI
  round for it.

## Consequences

- A merge while the application is closed is noticed on the next tick after
  the application opens.
- Overlap is by path. Two orders that touch different files but conflict
  semantically are not queued. CI after the merge is where that shows.
