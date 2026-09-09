# ADR 044: A fan-out parallelises lanes, not units

**Status**: Accepted

**Date**: 2026-09-09

**Supersedes the shape decisions in**: [ADR 043](043-an-agent-proposes-the-order-and-never-writes-it.md)
(which established that the architect proposes the order; this records what the
Line then does with it)

## Context

`WO-0907-3c1` — the ask was one sentence, "Make all text in the application
red" — was seeded at 2026-09-07T13:59 and had not finished 48 hours later, when
its wall-clock budget stopped it at 113 minutes against 105. At that point it
had started two of seven builders and finished none.

Its own records say what it cost:

| From             |                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `order.json`     | 12 acceptance criteria, 7 plan units, **all in one lane**, 21 files, risk P2              |
| `run-graph.json` | 21 nodes, **18 of them separate `claude` sessions**                                       |
| `budgets.agents` | 3, so 18 sessions is six sequential waves                                                 |
| Node durations   | `scout` 1.6m, `plan` 8.2m, `challenge` 7.0m — **16.8 minutes before one line was edited** |

Four separate mechanisms produced that number, and none of them is about model
quality.

**The architect was never shown an enum it was required to write.** The intake
output contract in `converge.ts` spelled out `risk.grade`'s four values and
said nothing about `risk.triggers`, which is an equally closed set in
`order/schema.ts`. The architect wrote five sentences into it and the entire
proposal was refused on `Invalid enum value` — nine minutes of deep-tier work,
discarded. The order needed three converge round-trips to agree.

**The run re-ran the architect after the order was agreed.** The Forge's
`converge` _is_ the architect, and the plan it produced is the one the six
compile checks agreed. Both `standard` and `direct` then opened with a `plan`
step that is also the architect, over an order it is not permitted to change:
`applyRungOutput` refuses a `plan` from a rung outright, raising _"it would
rewrite the plan of an order this run is already building from"_. The step's
only two possible outcomes were silence and halting the run. It cost 8.2
minutes and did neither.

**A fan-out spent a process per unit, on units that share a checkout.** All
seven units were in lane 1 — one worktree, one branch — and dependency-chained,
with `U-6` waiting on four of the others. `over: plan.units` made one node per
unit, so the run paid seven cold `claude` starts, each re-reading the same
repository, for work that was serial in a single checkout.

**`verify` fanned out too**, doubling the agent count of every order that has
ever run: seven units bought fourteen sessions.

Two things were _not_ causes, and it is worth saying so. The six compile checks
demand a minimum — one picture of a UI change, coverage in both directions, a
blast radius that contains the plan — and this order failed none of them. The
twelve criteria and seven units were the architect over-delivering, not a floor
the gate imposed. And `budgets.agents: 3` was not the constraint; the fix for
eighteen sessions is not more concurrency.

## Decision

**A fan-out is a claim that work can happen at the same time, and only a lane
can make that claim.** A lane is a worktree and a branch. Units inside one
cannot run concurrently no matter how many nodes point at them.

So `over:` gains one form — `plan.units[role=builder] by lane` — which produces
one node per lane carrying that lane's units in dependency order. `RunNode`
carries `unitIds` rather than `unitId`; `brief` lists every unit the node
covers, with its own files and criteria. A three-repository order still gets
three parallel builders. A one-lane order gets one.

Four decisions follow from the same reasoning:

1. **The plan's units stay exactly as they are.** They are the builder's task
   list and the coverage matrix's currency. What changes is that they cost one
   session instead of one each.
2. **`verify` is a single fresh-context agent.** Fresh context is what makes
   verification independent of the work. Fresh context _per unit_ adds nothing
   on top of that.
3. **No recipe re-plans an agreed order.** `direct` and `standard` lose their
   `plan` step.
4. **The shape is chosen from lanes and risk, never from unit count.** Pricing
   a shape off units charged for parallelism that never existed. The ladder is
   `quick` (one lane, P3, nothing flagged) → `direct` (one lane, P2 or a
   trigger fired) → `standard` (more than one lane, or above P2). A proposal
   walks the ladder to the first shape this repository can actually run; an
   operator's explicit choice is honoured or refused, never quietly swapped.

`quick` — build, check, ship — requires a `test` command, because it has no
verifier and no inspector and the suite is its only check. A repository without
one is offered `direct` instead.

And the architect is now told the trigger enum, and told to write the smallest
plan that covers the ask.

## Consequences

`WO-0907-3c1`, replayed, is proposed `direct` and produces **8 nodes, 4 of them
agent sessions** — `build:lane-1`, `verify`, `inspect`, `document` — against 21
nodes and 18 sessions. Under `standard` it would be 6 sessions rather than 18.
`extensions/foundry/tests/line/order-shape.spec.ts` holds those numbers as the
regression.

What is given up:

- **Per-unit verification context isolation.** One verifier now holds the whole
  order in one conversation. If a large order's verifier starts losing units,
  the answer is a smaller order, not a fan-out that costs a session per unit on
  every order to protect the rare one.
- **A per-unit retry granularity.** A lane node that fails takes its whole
  lane's work with it on retry. The retry ladder is unchanged and still counts
  attempts per node; a node is now simply bigger. Where a unit genuinely must
  fail independently, it belongs in its own lane, which is the same statement
  the plan already makes about worktrees.
- **`direct`'s old meaning.** It was "one unit, P3" and is now "one lane,
  notable enough to want an inspector". `quick` took the bottom of its range.

Old run graphs on disk carry `unitId`. `readRunGraph` converts at the boundary,
because a run left in flight when the application closed is picked back up by
reading exactly that file (feature 042).

## Alternatives considered

**Leave intake alone, only shrink the run.** The cheapest change, and it would
not have helped: this order spent roughly 92 minutes between seeding and
agreement, across three converge round-trips. The enum defect and the
`plan`-step duplication are both intake problems wearing a run-time cost.

**A size control at intake, or a classifier over the typed text.** Both put a
guess in front of the plan. The plan already states its lanes and its risk, and
those are the two things that decide what a shape can do — deriving the shape
from what the architect actually produced needs no new input and no new model
call.

**Skip the Forge entirely for small asks** — straight from typed text to one
builder, no criteria, no compile gate. The fastest possible path, and it
deletes the property that makes Foundry worth running: nothing verifiable comes
out the other end. `quick` keeps the criteria and the gate; it drops the scout,
the adversarial pass, the inspector and the scribe, which are the parts a
one-lane P3 change does not earn.

**Raise `budgets.agents` so eighteen sessions run in fewer waves.** Treats the
symptom, and pays eighteen cold starts either way.

**Keep the `plan` step as a second opinion on the agreed order.** That role
already exists and is called `challenge`. Having both the architect and the red
team re-review after agreement is the duplication, and only one of the two can
apply what it finds.
