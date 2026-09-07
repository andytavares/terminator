# ADR 043: An agent proposes the order; it never writes it

**Status**: Accepted

**Date**: 2026-09-06

## Context

Feature 037 built a Forge that seeds a work order from an idea or a tracker
issue, and six compile checks that refuse to hand one off until it is complete.
It did not build the thing that makes an order complete.

`seedOrder` filled in a problem statement and read the repository. Nothing
anywhere wrote acceptance criteria, plan units, a risk grade or budgets. Free
text typed into the Forge reached nothing — the code said it "goes to the agent
session"; there was no agent session. So the six checks could never pass, no
order could ever be agreed, and the Line could never be started from the
interface at all.

The only route to a runnable order was writing `order.json` by hand, which is
what the feature's own end-to-end test did — beneath a comment asserting that
the Forge "has its own cover".

The gap was circular in a way that made it easy to miss: the `architect` role
that writes the plan _does_ exist, and every shipped recipe has a `plan` step
that runs it. But recipes only run after an order is agreed, and an order
cannot be agreed without a plan.

## Decision

**An agent runs during intake, before agreement, and it proposes rather than
writes.**

The architect runs in a supervised session over the seeded draft, and hands
back a _proposal_: a strictly-validated object carrying only `intent`,
`acceptance`, `risk`, `budgets`, `plan`, `assumptions`, `openQuestions` and a
one-line note.

Four properties carry the decision.

**The order is not writable by an agent.** `status`, `id`, `source`,
`provenance` and `redTeam` are unreachable from a proposal. An agent that could
set `status` could agree its own work; one that could rewrite `provenance`
could erase how the order got that way; and `redTeam` belongs to a reader that
is not allowed to fix what it finds.

`context` is split, because the two halves have different owners. What Foundry
**measured** — the repositories, the probed toolchain, the house documents it
found — is unreachable: an agent that could rewrite the toolchain could tell
the verification ladder a command exists that does not. What the agent **read**
— entry points, the conventions the surrounding code keeps, prior art — is
reachable as `findings`, because it is a finding rather than a measurement and
nothing else fills it: Scout runs after agreement, which is too late to inform
one.

**A refused field is refused, not dropped.** The schema is `strict()`, so a
proposal carrying `status: "agreed"` fails and says so. Silently discarding it
would leave an agent that tried it free to try again, with nobody the wiser.

**Merging is an edit, not a replacement.** A struck assumption stays struck and
an answered question stays answered, however the architect restates them —
otherwise every redraft would quietly undo the operator's decisions.

**It travels through a file, not a return value.** The agent runs in a terminal
and writes one path; Foundry reads it, validates it, and deletes it. The
alternative — parsing a proposal out of a transcript — makes the boundary a
guess about text rather than a check on a value.

The architect runs **read-only**, enforced by the `PreToolUse` hook rather than
by its prompt, with a single exception at the proposal's own path. Intake
changes no code, so it is not given a worktree either: cutting a branch for a
plan that may never be agreed is a branch for nothing.

## Consequences

**Good.**

- The loop closes. An idea becomes an order that compiles, without anybody
  editing JSON.
- The boundary is a schema rather than a convention, so it is checked on every
  turn and cannot drift.
- Read-only intake means the Forge cannot damage a repository it is only
  reading, whatever the agent decides to try.

**Bad, and accepted.**

- A proposal is one more shape to keep in step with the order. When a field is
  added to `WorkOrderSchema`, a decision has to be taken about whether an agent
  may propose it — the schemas are derived from the order's own field schemas,
  so the shapes cannot disagree, but the _decision_ is manual.
- The architect can write a proposal the merge then refuses because the result
  would not be a valid order. That is reported and the turn is wasted.
- Intake is a whole agent turn, so "draft the plan" costs minutes rather than
  the instant redraw an operator might expect from a form.

## References

- `extensions/foundry/src/order/proposal.ts`, `src/forge/converge.ts`
- ADR 040 (the work order is the contract)
