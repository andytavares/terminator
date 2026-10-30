# ADR 046: A refused intake turn is a state, not a ledger line

**Status**: Accepted

**Date**: 2026-09-09

## Context

ADR 043 gave the architect a proposal to write and gave Foundry a schema to validate it against. It listed this among its accepted costs:

> The architect can write a proposal the merge then refuses because the result
> would not be a valid order. That is reported and the turn is wasted.

Foundry did not report it. It recorded it, which is a different thing, and the difference cost an operator an afternoon.

`WO-0909-6db` was an order to make the application's text red. The architect proposed six acceptance criteria and one unit. `AC-6` was judged, and its `verify.evidence` carried three file paths. But `evidence` is a closed set of artifact _kinds_, and a path is not one of them. Zod refused the document, so all six criteria and the only unit in the plan went with it. At 19:33:21 Foundry appended a `converge.refused` line to `ledger.jsonl`.

Nothing read it.

The Forge polls `foundry:order.compile`, which hands back the order document and its six checks. A refusal changes neither. There is no redraft to save, so `order.json` is byte-for-byte what it was. The surface's stop condition was `provenance.decisions` growing, and only a successful merge appends to that field. So the button read **The architect is working…** over a turn that had ended forty minutes earlier, and the three-second poll ran until the window closed. The order list was no better. A draft's standing knew nothing about intake, so it said _Foundry is still shaping this_ about an order that nothing had touched.

The operator's report was two sentences: _No way to recover from this._ _There's also zero indication anything has even gone wrong._ Both were exactly right.

Three separate things were wrong, and they had one shape: the outcome of an intake turn went somewhere that no surface looked.

## Decision

**The ledger is the record of an intake turn, and Foundry reads it back.**

`src/forge/intake-outcome.ts` is one pure function over a ledger. It walks backwards to the newest of the three lines that a turn can leave: `converge.started`, `converge.refused`, `order.redrafted`. It answers `none`, `running`, `refused` or `redrafted`. `OrderStore` gains `entries(orderId)`, so the store that appends the ledger can also read it. A store that could only append was a store that nothing could ask what had happened.

Three consequences follow. All three are the same decision applied.

**A turn is running exactly while the ledger says so.** The Forge's `drafting` flag is gone. A click set it, and a field that a refusal does not touch cleared it. So it was wrong in both directions: it survived a turn that had ended, and it could not survive leaving the screen. Derived from the record, it is right in both.

**A refused draft is your move.** `standingOf` takes `intakeRefused`, ahead of the open-questions branch. The order is deliberate. Suppose you answer a question that the architect asked before it was refused. The answer lands on a document that no architect is reading. A screen that led with the questions would point at the one move that does not help.

**The refusal is on the screen, with a control.** A band above everything else on the Forge carries the validator's own words verbatim: the field path and the values it would have accepted. The band has two buttons. The first sends the reason back to the architect as the next turn's instruction. This is not a convenience. The architect **cannot** read its own refusal, because its turn ended before the validation ran. On the run where we found this, it also could not have parsed its own JSON, because `node -e`, `python3 -c` and shell redirects are all off intake's read-only allowlist. Told what was wrong, it fixes the problem in one turn.

**And the enum is in the brief.** The refusal itself was avoidable. The output contract spelled out the closed set for `risk.triggers`. We added that after `WO-0907-3c1` was refused for writing prose into it. For a judge, the contract said only that it needs "a non-empty `evidence` list". `EVIDENCE_KINDS` is now exported beside `RISK_TRIGGERS` and rendered from the schema constant. The brief states the distinction that caused the failure in as many words: these are kinds of artifact, not paths, and the rubric names a file that the judge should read.

## Consequences

**Good.**

- A wasted turn is visible, and the operator can recover from it in one click.
- The stop condition is the event that actually ends the turn, so the poll cannot outlive the turn or give up before it ends.
- Every surface reads one derivation, so the list and the Forge cannot disagree about whether an architect is working. This applies ADR 045's rule to the one state that it had no input for.
- An intake turn interrupted by the application closing is now legible: the record says a turn started and never ended.

**Bad, and accepted.**

- `foundry:order.compile` reads a second file. It is polled every three seconds while a turn is in flight. `ledger.jsonl` is small, but this is a read that was not there before. The order list reads one ledger per **draft** row and skips every other status, because reading the ledger of a running order to be told "not refused" is a file read for nothing.
- A `converge.started` line with no terminal line after it reads as `running` forever if the application died mid-turn. An agent does not outlive the process that spawned it, but the ledger line does. The recovery control is the answer, not a timeout: the same band always offers a way to start the turn over, whatever the record says.
- Two closed sets have now been refused for the same reason. The third closed set added to the order schema will be too, unless naming it in the output contract becomes part of adding it.

## References

- `extensions/foundry/src/forge/intake-outcome.ts`, `src/order/standing.ts`,
  `src/components/Forge.tsx`
- ADR 043 (an agent proposes the order and never writes it) — the cost this
  amends
- ADR 045 (one standing, read by every surface)
