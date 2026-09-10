# ADR 046: A refused intake turn is a state, not a ledger line

**Status**: Accepted

**Date**: 2026-09-09

## Context

ADR 043 gave the architect a proposal to write and Foundry a schema to validate
it against, and listed among its accepted costs:

> The architect can write a proposal the merge then refuses because the result
> would not be a valid order. That is reported and the turn is wasted.

It was not reported. It was recorded, which is a different thing, and the
difference cost an operator an afternoon.

`WO-0909-6db`, an order to make the application's text red. The architect
proposed six acceptance criteria and one unit. `AC-6` was judged, and its
`verify.evidence` carried three file paths — but `evidence` is a closed set of
artifact _kinds_, and a path is not one of them. Zod refused the document, so
all six criteria and the only unit in the plan went with it. At 19:33:21 a
`converge.refused` line was appended to `ledger.jsonl`.

Nothing read it.

The Forge polls `foundry:order.compile`, which hands back the order document
and its six checks. A refusal changes neither: there is no redraft to save, so
`order.json` is byte-for-byte what it was. The surface's stop condition was
`provenance.decisions` growing — a field only a successful merge appends to —
so the button read **The architect is working…** over a turn that had ended
forty minutes earlier, and the three-second poll ran until the window closed.
The order list was no better: a draft's standing knew nothing about intake, so
it said _Foundry is still shaping this_ about an order nothing had touched.

The operator's report was two sentences. _No way to recover from this._ _There's
also zero indication anything has even gone wrong._ Both were exactly right.

Three separate things were wrong and they had one shape: the outcome of an
intake turn was written somewhere no surface looked.

## Decision

**The ledger is the record of an intake turn, and it is read back.**

`src/forge/intake-outcome.ts` is one pure function over a ledger. It walks
backwards to the newest of the three lines a turn can leave — `converge.started`,
`converge.refused`, `order.redrafted` — and answers `none`, `running`,
`refused` or `redrafted`. `OrderStore` gains `entries(orderId)` so the store
that appends the ledger can also read it; a store that could only append was a
store nothing could ask what had happened.

Three consequences follow, and all three are the same decision applied.

**A turn is running exactly while the ledger says so.** The Forge's `drafting`
flag is gone. It was set by a click and cleared by a field that a refusal does
not touch, so it was wrong in both directions: it survived a turn that had
ended, and it could not survive leaving the screen. Derived from the record it
is right in both.

**A refused draft is your move.** `standingOf` takes `intakeRefused`, ahead of
the open-questions branch. Ahead deliberately: answering a question the
architect asked before it was refused writes an answer onto a document no
architect is reading, so a screen that led with the questions would be pointing
at the one move that does not help.

**The refusal is on the screen, with a control.** A band above everything else
on the Forge, carrying the validator's own words verbatim — the field path and
the values it would have accepted — and two buttons. The first sends the reason
back to the architect as the next turn's instruction. That is not a
convenience: the architect **cannot** read its own refusal, because its turn
ended before the validation ran, and on the run this was found on it could not
have parsed its own JSON either, since `node -e`, `python3 -c` and shell
redirects are all off intake's read-only allowlist. Told what was wrong, it
fixes it in one turn.

**And the enum is in the brief.** The refusal itself was avoidable. The output
contract spelled out the closed set for `risk.triggers` — added after
`WO-0907-3c1` was refused for writing prose into it — and said of a judge only
that it needs "a non-empty `evidence` list". `EVIDENCE_KINDS` is now exported
beside `RISK_TRIGGERS` and rendered from the schema constant, with the
distinction that caused the failure stated in as many words: these are kinds of
artifact, not paths, and a file the judge should read is named in the rubric.

## Consequences

**Good.**

- A wasted turn is visible, recoverable, and recoverable in one click.
- The stop condition is the thing that actually ends the turn, so the poll
  cannot outlive it or give up before it.
- Every surface reads one derivation, so the list and the Forge cannot disagree
  about whether an architect is working — which is ADR 045's rule applied to
  the one state it had no input for.
- An intake turn interrupted by the application closing is now legible: the
  record says a turn started and never ended.

**Bad, and accepted.**

- `foundry:order.compile` reads a second file. It is polled every three seconds
  while a turn is in flight, and `ledger.jsonl` is small, but it is a read that
  was not there before. The order list reads one per **draft** row and skips
  every other status, because reading the ledger of a running order to be told
  "not refused" is a file read for nothing.
- A `converge.started` with no terminal line after it reads as `running`
  forever if the application died mid-turn — an agent does not outlive the
  process that spawned it, but the ledger line does. The recovery control is
  the answer rather than a timeout: starting the turn over is reachable from
  the same band whatever the record says.
- Two closed sets have now been refused for the same reason. The third one
  added to the order schema will be too, unless naming it in the output
  contract becomes part of adding it.

## References

- `extensions/foundry/src/forge/intake-outcome.ts`, `src/order/standing.ts`,
  `src/components/Forge.tsx`
- ADR 043 (an agent proposes the order and never writes it) — the cost this
  amends
- ADR 045 (one standing, read by every surface)
