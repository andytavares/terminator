# ADR 053: A stopped run is a state, with a move

**Status**: Accepted

**Date**: 2026-09-13

**Builds on**: [ADR 045](045-one-standing-read-by-every-surface.md) (one
standing, read by every surface) and [ADR 046](046-a-refused-turn-is-a-state-not-a-ledger-line.md)
(the same fix, one phase earlier, for a refused intake turn)

## Context

In `WO-0913-0bd`, every node in the run graph `passed`. `order.json` still said `"status": "running"`. The ledger's tail read:

```
run.complete — 4 verdicts
run.failed — Opening the pull request for terminator failed:
```

`gh` had exited non-zero with nothing on stderr, so the reason was itself empty. This is a second defect, and we fixed it alongside this one. `integrate.ts` now falls back to stdout, then to `exit code <n>`, and no longer reports nothing.

Nothing on any surface said the run had stopped. `standingOf` reads the graph and the gates, and both said what they say for a run that finished its last wave a second ago: no node running, none failed, nothing holding a gate. The Floor read **Between steps. Nothing is running right now.** That is true of a run mid-schedule, and it is true of a run that will never move again, in the same words. The operator's report was the ADR 046 report again, one phase later. The outcome of a run attempt went to one place, a ledger line, and no standing looked there.

## Decision

**The ledger is the record of how a run attempt ended, and `standingOf` reads it back, exactly as it already does for intake.**

`src/line/run-outcome.ts` exports `runFailure`, a pure function over a run's ledger entries. It scans backwards for the newest of the lines that decide the answer:

- `run.failed` or `ship.refused` means the latest attempt stopped there, and the reason is the entry's own.
- `run.started`, `run.resumed`, `run.complete` or `run.halted`, with nothing after it, means the latest attempt did not fail.

`standingOf` takes `runFailure` as an input. It checks the input after `stalled` and before `failed`. That is after every condition that names something concrete an agent is doing right now. It is ahead of the graph-only checks that would otherwise read a finished-and-failed run as freshly idle.

A new `StandingKind`, `'stopped'`, has turn `you`. One branch gives two headlines, distinguished by whether the graph is done. **The run stopped on an error** is for a run that failed mid-flight. **Finished, but not shipped** is for `WO-0913-0bd`'s case: every node passed and the tail still threw. The detail is the ledger's own reason, verbatim. This is the way ADR 046 puts the validator's own words on screen and not a paraphrase of them.

**Resuming re-enters the executor. It is not a special "retry ship" path.** `Floor` offers **Try again**, which calls the same `foundry:run.resume` channel that `adrift` already used. Resuming a run whose graph is entirely `passed` reclaims nothing and retries nothing. Every node stays finished, and Foundry hands the unchanged graph back to the executor. The executor's scheduler offers no ready node, so the wave ends immediately and the tail runs. The tail regrades the actual diff and tries to ship again. This is not a special case written for this ADR. It is what resuming has always done. It works here because a `ready-for-review` gate node is marked `passed` the moment the recipe reaches it. "Shipping happens here" is the tail's decision to make, not a pause for the operator. So the graph has nothing left to re-ask before the tail's own logic decides, again, whether to push and open the pull request.

**`resume` clears the failure it is answering.** Before it calls `execute` again, it records `run.resumed`. So a resumed run that goes on to succeed is not read as `stopped` for ever. The backward scan of `runFailure` stops at `run.resumed` before it ever reaches the old `run.failed`.

## Consequences

**Good.**

- A run that finishes and does not ship was indistinguishable, on every surface, from a run mid-schedule, for as long as it took someone to look. ADR 045 named this defect for a halted run, and ADR 046 named it for a refused draft. This ADR closes it for the third state that had it.
- `Try again` costs nothing new. It is `run.resume` with no reclaim and no retry list, and it exercises the same code that every recovered run already exercises.
- The reason on screen is the reason that `gh` or the push gave, not a summary of it. The fallback in `integrate.ts` (stderr, then stdout, then exit code) exists to guarantee that the reason has something to say, and the same discipline applies.

**Bad, and accepted.**

- Trying again re-climbs the whole verification ladder and regrades the diff from scratch, even when only the push failed and every check already passed. The alternative is a second code path that ships without re-verifying a working copy that nothing has touched since the failure. Trying again is cheaper than that alternative. No run has yet been slow enough here to make the cost worth spending on.
- A retry that succeeds posts a second "ready to review" feed entry. If a review row was already opened against the first (refused) attempt, the retry also posts a duplicate one. Nothing here de-duplicates that. It is a real gap, and it is out of scope for this ADR.
- Foundry reads `runFailure` for every `running` order on every `order.list` poll, as it reads `intakeRefused` for every `draft`. This is one more small ledger read per row per poll. We accepted it for the same reason that ADR 046 accepted its first one.

## References

- `extensions/foundry/src/line/run-outcome.ts`, `src/order/standing.ts`,
  `src/components/Floor.tsx`, `src/line/integrate.ts`
- ADR 045 (one standing, read by every surface) — the ordering this slots into
- ADR 046 (a refused intake turn is a state, not a ledger line) — the same
  decision, one turn earlier in an order's life
