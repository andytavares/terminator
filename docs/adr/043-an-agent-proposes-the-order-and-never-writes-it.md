# ADR 043: An agent proposes the order; it never writes it

**Status**: Accepted

**Date**: 2026-09-06

## Context

Feature 037 built a Forge that seeds a work order from an idea or a tracker issue. It also built six compile checks that refuse to hand off an order until it is complete. It did not build the part that makes an order complete.

`seedOrder` filled in a problem statement and read the repository. Nothing wrote acceptance criteria, plan units, a risk grade or budgets. Free text typed into the Forge reached nothing. The code said it "goes to the agent session", but there was no agent session. So the six checks could never pass, no order could ever be agreed, and nobody could start the Line from the interface at all.

The only route to a runnable order was to write `order.json` by hand. The feature's own end-to-end test did this, beneath a comment that asserted the Forge "has its own cover".

The gap was circular, which made it easy to miss. The `architect` role that writes the plan _does_ exist, and every shipped recipe has a `plan` step that runs it. But recipes run only after an order is agreed, and an order cannot be agreed without a plan.

## Decision

**An agent runs during intake, before agreement, and it proposes. It does not write.**

The architect runs in a supervised session over the seeded draft. It hands back a _proposal_: a strictly-validated object that carries only `intent`, `acceptance`, `risk`, `budgets`, `plan`, `assumptions`, `openQuestions` and a one-line note.

Four properties carry the decision.

**An agent cannot write the order.** A proposal cannot reach `status`, `id`, `source`, `provenance` or `redTeam`. An agent that could set `status` could agree its own work. An agent that could rewrite `provenance` could erase how the order got that way. And `redTeam` belongs to a reader that is not allowed to fix what it finds.

`context` is split, because its two halves have different owners. What Foundry **measured** is unreachable. This covers the repositories, the probed toolchain and the house documents it found. An agent that could rewrite the toolchain could tell the verification ladder that a command exists when it does not. What the agent **read** is reachable as `findings`. This covers entry points, the conventions the surrounding code keeps, and prior art. It is a finding, not a measurement, and nothing else fills it: Scout runs after agreement, which is too late to inform one.

**A refused field is refused. It is not dropped.** The schema is `strict()`, so a proposal that carries `status: "agreed"` fails and says so. If Foundry silently discarded the field, an agent that tried it would be free to try again, with nobody the wiser.

**Merging is an edit. It is not a replacement.** A struck assumption stays struck and an answered question stays answered, however the architect restates them. Otherwise every redraft would quietly undo the operator's decisions.

**It travels through a file, not a return value.** The agent runs in a terminal and writes one path. Foundry reads the file, validates it, and deletes it. The alternative is to parse a proposal out of a transcript. That makes the boundary a guess about text, not a check on a value.

The architect runs **read-only**. The `PreToolUse` hook enforces this, not the prompt, with a single exception at the proposal's own path. Intake changes no code, so it gets no worktree either. Cutting a branch for a plan that may never be agreed is a branch for nothing.

## Consequences

**Good.**

- The loop closes. An idea becomes an order that compiles, and nobody edits JSON.
- The boundary is a schema, not a convention. Every turn checks it, so it cannot drift.
- Intake is read-only, so the Forge cannot damage a repository that it only reads, whatever the agent decides to try.

**Bad, and accepted.**

- A proposal is one more shape to keep in step with the order. When someone adds a field to `WorkOrderSchema`, someone must decide whether an agent may propose it. The schemas derive from the order's own field schemas, so the shapes cannot disagree, but the _decision_ is manual.
- The architect can write a proposal that the merge then refuses, because the result would not be a valid order. Foundry reports this, and the turn is wasted.
- Intake is a whole agent turn. "Draft the plan" costs minutes, not the instant redraw that an operator might expect from a form.

## References

- `extensions/foundry/src/order/proposal.ts`, `src/forge/converge.ts`
- ADR 040 (the work order is the contract)
