# ADR 053: A stopped run is a state, with a move

**Status**: Accepted

**Date**: 2026-09-13

**Builds on**: [ADR 045](045-one-standing-read-by-every-surface.md) (one
standing, read by every surface) and [ADR 046](046-a-refused-turn-is-a-state-not-a-ledger-line.md)
(the same fix, one phase earlier, for a refused intake turn)

## Context

`WO-0913-0bd`. Every node in the run graph `passed`. `order.json` still said
`"status": "running"`. The ledger's tail read:

```
run.complete — 4 verdicts
run.failed — Opening the pull request for terminator failed:
```

`gh` had exited non-zero with nothing on stderr, so the reason was itself
empty — a second defect, fixed alongside this one (`integrate.ts` now falls
back to stdout, then `exit code <n>`, rather than reporting nothing).

Nothing on any surface said the run had stopped. `standingOf` reads the graph
and the gates, and both said the same thing they say for a run that finished
its last wave a second ago: no node running, none failed, nothing holding a
gate. The Floor read **Between steps. Nothing is running right now.** — true
of a run mid-schedule and true of one that will never move again, in the same
words. The operator's report was the ADR 046 report again, one phase later:
the outcome of a run attempt was written to one place — a ledger line — that
no standing looked at.

## Decision

**The ledger is the record of how a run attempt ended, and `standingOf` reads
it back, exactly as it already does for intake.**

`src/line/run-outcome.ts` exports `runFailure`, a pure function over a run's
ledger entries. It scans backwards for the newest of the lines that decide the
answer: `run.failed` or `ship.refused` means the latest attempt stopped there,
and the reason is the entry's own; `run.started`, `run.resumed`,
`run.complete` or `run.halted` with nothing after it means the latest attempt
did not fail. `standingOf` takes `runFailure` as an input, checked after
`stalled` and before `failed` — after every condition that names something
concrete an agent is doing right now, and ahead of the graph-only checks that
would otherwise read a finished-and-failed run as freshly idle.

A new `StandingKind`, `'stopped'`, turn `you`. Two headlines from one branch,
distinguished by whether the graph is done: **The run stopped on an error**
for a run that failed mid-flight, **Finished, but not shipped** for
`WO-0913-0bd`'s case — every node passed and the tail still threw. The detail
is the ledger's own reason, verbatim, the way ADR 046 puts the validator's own
words on screen rather than a paraphrase of them.

**Resuming re-enters the executor, not a special "retry ship" path.** `Floor`
offers **Try again**, calling the same `foundry:run.resume` channel `adrift`
already used. Resuming a run whose graph is entirely `passed` reclaims nothing
and retries nothing — every node stays finished — and hands the unchanged
graph back to the executor. The executor's scheduler offers no ready node, so
the wave ends immediately and the tail runs: it regrades the actual diff and
tries to ship again. This is not a special case written for this ADR; it is
what resuming has always done, and it works here because a `ready-for-review`
gate node is marked `passed` the moment the recipe reaches it — "shipping
happens here" is the tail's decision to make, not a pause for the operator —
so nothing in the graph is left to re-ask before the tail's own logic decides,
again, whether to push and open the pull request.

**`resume` clears the failure it is answering.** Before calling `execute`
again it records `run.resumed`, so a resumed run that goes on to succeed is
not read as `stopped` forever — `runFailure`'s backward scan stops at
`run.resumed` before it ever reaches the old `run.failed`.

## Consequences

**Good.**

- A run that finishes and does not ship is indistinguishable, on every
  surface, from a run mid-schedule for exactly as long as it takes someone to
  look — which is the same defect ADR 045 named for a halted run and ADR 046
  named for a refused draft, closed for the third state that had it.
- `Try again` costs nothing new: it is `run.resume` with no reclaim and no
  retry list, exercising the same code every recovered run already exercises.
- The reason on screen is the reason `gh` or the push gave, not a summary of
  it — the same discipline `integrate.ts`'s stderr-then-stdout-then-exit-code
  fallback exists to guarantee has something to say.

**Bad, and accepted.**

- Trying again re-climbs the whole verification ladder and regrades the diff
  from scratch, even when only the push failed and every check already
  passed. Cheaper than the alternative of a second code path that ships
  without re-verifying a working copy nothing has touched since the failure —
  and no run has yet been slow enough here to make the cost worth spending on.
- A retry that succeeds posts a second "ready to review" feed entry and, if a
  review row was already opened against the first (refused) attempt, a
  duplicate one. Nothing here de-duplicates that; it is a real gap and out of
  this ADR's scope.
- `runFailure` is read for every `running` order on every `order.list` poll,
  same as `intakeRefused` is read for every `draft`. One more small ledger
  read per row per poll, accepted for the same reason ADR 046 accepted its
  first one.

## References

- `extensions/foundry/src/line/run-outcome.ts`, `src/order/standing.ts`,
  `src/components/Floor.tsx`, `src/line/integrate.ts`
- ADR 045 (one standing, read by every surface) — the ordering this slots into
- ADR 046 (a refused intake turn is a state, not a ledger line) — the same
  decision, one turn earlier in an order's life
