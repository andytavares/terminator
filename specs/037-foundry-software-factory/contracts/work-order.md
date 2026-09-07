# Contract: the work order

**Feature**: `037-foundry-software-factory` | **Date**: 2026-09-06

The work order is the only object that crosses from the Forge to the Line. This document states the obligations on each side. Field-level shapes are in [data-model.md](../data-model.md).

## Files

Under `<dataRoot>/orders/<id>/`:

| File           | Format              | Written by                 | Read by                         |
| -------------- | ------------------- | -------------------------- | ------------------------------- |
| `order.json`   | JSON, zod-validated | Forge only                 | Everything                      |
| `order.md`     | Markdown            | Rendered from `order.json` | Humans, and the tracker comment |
| `context.json` | JSON                | Scout only                 | Architect, verifier, ladder     |
| `ledger.jsonl` | JSONL, append-only  | Everything                 | Curator, Ledger surface         |

`order.json` is the truth. `order.md` is a rendering and is regenerated on every change — **never hand-edited**, and the Forge overwrites it without asking. Anything an operator wants to change is changed through intake, so it lands in the truth.

## Producer obligations — the Forge

1. **Never hand off an order that does not compile.** The six checks are the whole gate. `status` may only become `agreed` through `foundry:order.compile`, and only when `CompileResult.ok` is true.
2. **Never ask what the repository answers.** A question that `context.json` already contains is a defect in intake, not a question (FR-005).
3. **State every decision made on the operator's behalf as a strikeable assumption** (FR-004). An assumption the operator cannot see is a guess.
4. **Fill `context.toolchain` before any criterion's `verify` is written.** A criterion whose proof names a command the project does not have is not executable, and check 2 will refuse it. This ordering is the reason the probe belongs to intake and not to execution.
5. **Every identifier is stable for the life of the order.** Amendment adds and removes; it never renumbers. Ledger entries, verdicts and gates all reference these ids.

## Consumer obligations — the Line

1. **Read the order; do not negotiate with it.** The Line has no path back into the intake conversation. If it needs something the order does not carry, that is a `forge-defect` gate (FR-083) — answered by the operator _and_ recorded against intake, so the schema can grow.
2. **Never mutate `order.json`.** Execution state lives in the run graph and the ledger. The order is what was agreed; a record you can rewrite is not a record of an agreement.
3. **Satisfy every criterion or fail loudly.** `not_measured` is not a pass. An order cannot reach `shipped` with an unmeasured `P0` criterion.
4. **Honour the budgets.** They are part of the agreement, not advice (FR-030).
5. **Stay inside the blast radius.** Writing outside it is a risk trigger, not a warning (FR-043).

## Amendment

An amendment sets `status` back to `draft`, re-runs all six checks, and appends a `provenance.amendments` entry with what changed and why. Running units pause rather than abandon: work already done against an order that has changed may still be valid, and throwing it away because a sentence moved is expensive. Resuming requires the order to compile again.

A red-team finding raised after agreement is an amendment (Edge Cases). It does not get a quieter path because it arrived late.

## Versioning

`order.json` carries `schemaVersion`. A reader that meets a higher version than it knows **refuses the order and says so** rather than reading what it recognises. Half-understood agreements are worse than unreadable ones; the failure mode of partial reads is a plan executed against terms nobody agreed to.

Migration of older orders is by explicit upgrade, recorded in the ledger.

## What the order is not

- **Not a transcript.** The intake conversation is recoverable through the session, but nothing in execution reads it. The order is what was agreed; the conversation is how it was reached.
- **Not a status board.** Progress lives in the run graph. Anything in the order that changed while work ran would mean the agreement moved under the work.
- **Not repository-local.** It lives under the data root, never inside a target repository (FR-070). A multi-repository order belongs to no single repository, which is the same reason the data root is configurable.
