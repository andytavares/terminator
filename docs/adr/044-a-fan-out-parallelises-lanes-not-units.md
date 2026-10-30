# ADR 044: A fan-out parallelises lanes, not units

**Status**: Accepted

**Date**: 2026-09-09

**Supersedes the shape decisions in**: [ADR 043](043-an-agent-proposes-the-order-and-never-writes-it.md)
(which established that the architect proposes the order; this records what the
Line then does with it)

## Context

`WO-0907-3c1` was a one-sentence ask: "Make all text in the application red". We seeded it at 2026-09-07T13:59. It had not finished 48 hours later, when its wall-clock budget stopped it at 113 minutes against 105. At that point it had started two of seven builders and finished none.

Its own records show what it cost:

| From             |                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `order.json`     | 12 acceptance criteria, 7 plan units, **all in one lane**, 21 files, risk P2              |
| `run-graph.json` | 21 nodes, **18 of them separate `claude` sessions**                                       |
| `budgets.agents` | 3, so 18 sessions is six sequential waves                                                 |
| Node durations   | `scout` 1.6m, `plan` 8.2m, `challenge` 7.0m — **16.8 minutes before one line was edited** |

Four separate mechanisms produced that number. None of them is about model quality.

**Nobody showed the architect an enum that it had to write.** The intake output contract in `converge.ts` spelled out the four values of `risk.grade`. It said nothing about `risk.triggers`, which is an equally closed set in `order/schema.ts`. The architect wrote five sentences into it, and Foundry refused the entire proposal on `Invalid enum value`. That discarded nine minutes of deep-tier work. The order needed three converge round-trips to agree.

**The run re-ran the architect after the order was agreed.** The Forge's `converge` _is_ the architect, and the plan it produced is the plan that the six compile checks agreed. Both `standard` and `direct` then opened with a `plan` step, which is also the architect, over an order it is not permitted to change. `applyRungOutput` flatly refuses a `plan` from a rung and raises _"it would rewrite the plan of an order this run is already building from"_. The step had two possible outcomes: silence, or halting the run. It cost 8.2 minutes and did neither.

**A fan-out spent a process per unit, on units that share a checkout.** All seven units were in lane 1, which is one worktree and one branch. They were also dependency-chained, with `U-6` waiting on four of the others. `over: plan.units` made one node per unit. The run paid seven cold `claude` starts, each re-reading the same repository, for work that was serial in a single checkout.

**`verify` fanned out too.** This doubled the agent count of every order that has ever run: seven units bought fourteen sessions.

Two things were _not_ causes, and we say so here. The six compile checks demand a minimum: one picture of a UI change, coverage in both directions, and a blast radius that contains the plan. This order failed none of them. The twelve criteria and seven units were the architect over-delivering. They were not a floor that the gate imposed. And `budgets.agents: 3` was not the constraint. The fix for eighteen sessions is not more concurrency.

## Decision

**A fan-out is a claim that work can happen at the same time, and only a lane can make that claim.** A lane is a worktree and a branch. Units inside one lane cannot run concurrently, however many nodes point at them.

So `over:` gains one form, `plan.units[role=builder] by lane`. It produces one node per lane, and the node carries that lane's units in dependency order. `RunNode` carries `unitIds` instead of `unitId`. `brief` lists every unit that the node covers, with its own files and criteria. A three-repository order still gets three parallel builders. A one-lane order gets one.

Four decisions follow from the same reasoning:

1. **The plan's units stay exactly as they are.** They are the builder's task list and the currency of the coverage matrix. What changes is that they cost one session instead of one each.
2. **`verify` is a single fresh-context agent.** Fresh context is what makes verification independent of the work. Fresh context _per unit_ adds nothing on top of that.
3. **No recipe re-plans an agreed order.** `direct` and `standard` lose their `plan` step.
4. **Lanes and risk choose the shape. Unit count never does.** Pricing a shape off units charged for parallelism that never existed. The ladder is `quick` (one lane, P3, nothing flagged) → `direct` (one lane, P2 or a trigger fired) → `standard` (more than one lane, or above P2). A proposal walks the ladder to the first shape that this repository can actually run. Foundry honours or refuses an operator's explicit choice. It never swaps the choice quietly.

`quick` means build, check, ship. It requires a `test` command, because it has no verifier and no inspector, and the suite is its only check. A repository without a `test` command is offered `direct` instead.

Also, we now tell the architect the trigger enum, and we tell it to write the smallest plan that covers the ask.

## Consequences

Replayed, `WO-0907-3c1` is proposed `direct` and produces **8 nodes, 4 of them agent sessions**: `build:lane-1`, `verify`, `inspect`, `document`. Before, it had 21 nodes and 18 sessions. Under `standard` it would be 6 sessions, not 18. `extensions/foundry/tests/line/order-shape.spec.ts` holds those numbers as the regression.

What we give up:

- **Per-unit verification context isolation.** One verifier now holds the whole order in one conversation. Suppose a large order's verifier starts losing units. The answer is a smaller order. It is not a fan-out that costs a session per unit on every order, to protect the rare one.
- **Per-unit retry granularity.** When a lane node fails, it takes its whole lane's work with it on retry. The retry ladder is unchanged and still counts attempts per node. A node is now simply bigger. Where a unit must fail independently, it belongs in its own lane. The plan already says the same about worktrees.
- **`direct`'s old meaning.** It was "one unit, P3". It is now "one lane, notable enough to want an inspector". `quick` took the bottom of its range.

Old run graphs on disk carry `unitId`. `readRunGraph` converts at the boundary. A run left in flight when the application closed is picked back up by reading exactly that file (feature 042).

## Alternatives considered

**Leave intake alone, only shrink the run.** This is the cheapest change, and it would not have helped. This order spent roughly 92 minutes between seeding and agreement, across three converge round-trips. The enum defect and the duplicate `plan` step are both intake problems that show up as a run-time cost.

**A size control at intake, or a classifier over the typed text.** Both put a guess in front of the plan. The plan already states its lanes and its risk, and those two facts decide what a shape can do. Deriving the shape from what the architect actually produced needs no new input and no new model call.

**Skip the Forge entirely for small asks.** This goes straight from typed text to one builder, with no criteria and no compile gate. It is the fastest possible path, and it deletes the property that makes Foundry worth running: nothing verifiable comes out of the other end. `quick` keeps the criteria and the gate. It drops the scout, the adversarial pass, the inspector and the scribe, which a one-lane P3 change does not earn.

**Raise `budgets.agents` so eighteen sessions run in fewer waves.** This treats the symptom, and the run pays for eighteen cold starts either way.

**Keep the `plan` step as a second opinion on the agreed order.** The role for that already exists and is called `challenge`. Having both the architect and the red team re-review after agreement is the duplication, and only one of the two can apply what it finds.
