# 043 — Foundry runs in minutes, not hours

## The problem, measured

`WO-0907-3c1` — "Make all text in the application red" — was seeded at
2026-09-07T13:59 and had not finished 48 hours later, when its wall-clock
budget stopped it at 113 minutes against a 105 minute allowance. At that point
it had started 2 of 7 builders and finished none.

The order it produced, from a one-sentence ask:

|                     |                                                 |
| ------------------- | ----------------------------------------------- |
| Acceptance criteria | 12                                              |
| Plan units          | 7, in **one lane**, touching 21 files           |
| Run graph           | 21 nodes, 18 of them separate `claude` sessions |
| Concurrency         | 3 (`budgets.agents`)                            |

Measured node durations from `run-graph.json`:

```
scout       1.6m
plan        8.2m
challenge   7.0m
            ─────
            16.8m before one line of code was edited
```

Four defects produced that number. None of them are about model quality, and
none of them get better with a faster model.

### D1 — The architect is never told the enum, so its work is thrown away

`forge/converge.ts` renders the output contract the architect writes against.
It spells out the legal values for `risk.grade` (`"P0|P1|P2|P3"`) and does not
spell them out for `risk.triggers`, which is an equally closed enum in
`order/schema.ts`. The architect wrote prose into it and the whole proposal was
refused:

```
risk.triggers.0: Invalid enum value.
Expected 'authentication'|'payments'|'secrets'|'migration'|'public_interface'|…
received 'Raised from P3: the change edits the main process…'
```

Nine minutes of deep-tier work, discarded, at 14:08:32. The order needed three
converge round-trips to agree.

### D2 — `standard` re-runs the architect after the order is agreed, and discards the result

The Forge's `converge` is the architect. It produces the plan the compile gate
agrees. `standard` then opens with a `plan` step that is _also_ the architect,
over an already-agreed order.

`applyRungOutput` cannot apply what it writes:

> it would rewrite the plan of an order this run is already building from

So the node's only two outcomes are silence or halting the run. It cost 8.2
minutes on this order and cannot, by construction, improve one.

### D3 — Fanout spends a process per unit, on units that share a checkout

Fanout exists to parallelise across lanes and repositories. `over: plan.units`
makes one node per _unit_. All 7 of this order's units were in lane 1 — one
worktree, one branch — and dependency-chained (`U-6` waits on four others). So
the run paid seven cold `claude` starts, each re-reading the repository, for
work that was serial in a single checkout.

The plan's units are a useful task list. They are the wrong unit of
parallelism.

### D4 — `verify` fans out too, doubling the agent count on every order

`build` × N and `verify` × N. Seven units bought fourteen sessions.

## What changes

1. **The converge contract names every enum it expects.** Derived from the
   schema so it cannot drift.
2. **`plan` is removed from `standard` and `direct`.** The Forge already
   planned; the run node could only discard or halt.
3. **Fanout groups by lane.** New `over:` form — `plan.units[role=builder] by
lane` — produces one node per lane carrying that lane's units in dependency
   order. A three-repository order still gets three parallel builders. A
   one-lane order gets one.
4. **`verify` is a single fresh-context agent** over the whole order, in every
   recipe.
5. **A `quick` recipe** — build → check → ship. No scout, no adversarial pass,
   no inspector, no scribe.
6. **`proposeRecipe` routes to it from the plan**, on lanes and risk and never
   on unit count: `quick` (one lane, P3, nothing flagged) → `direct` (one lane,
   P2 or a trigger fired) → `standard` (more than one lane, or above P2). A
   proposal walks that ladder to the first shape the repository can actually
   run, since `quick` needs a `test` command; an operator's explicit choice is
   honoured or refused, never quietly swapped.
7. **The architect is told to write the smallest plan that covers the ask.**
   Units separate work that genuinely cannot share a checkout, or that must be
   ordered. Not work that touches different files.

## What does not change

The six compile checks keep their teeth. They demand a _minimum_ — one picture,
full coverage both ways, a blast radius that contains the plan — and this order
failed none of them. The 12 criteria and 7 units were over-delivery by the
architect, not a floor the gate imposed. Nothing here weakens a check.

## Acceptance

|      | Criterion                                                                                                                      | Proof                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| AC-1 | The converge output contract contains every `RiskTrigger` value                                                                | Unit test, derived from the schema so a new trigger fails it                  |
| AC-2 | `standard` and `direct` contain no `plan` step                                                                                 | Unit test over the shipped recipe files                                       |
| AC-3 | 7 builder units in 1 lane produce 1 build node; 4 units across 3 lanes produce 3                                               | Unit test on `buildRunGraph`                                                  |
| AC-4 | A lane node's brief names every unit it covers, in dependency order                                                            | Unit test on `brief`                                                          |
| AC-5 | `standard` produces exactly one `verify` node regardless of unit count                                                         | Unit test on `buildRunGraph`                                                  |
| AC-6 | `quick` produces 3 nodes and exactly 1 agent session                                                                           | Unit test on the shipped recipe                                               |
| AC-7 | The ladder returns `quick`, `direct` and `standard` at the right rungs, says why, and steps down where a shape cannot run here | Unit test                                                                     |
| AC-8 | `WO-0907-3c1`'s own order, replayed, produces ≤ 8 nodes and 4 agent sessions                                                   | `tests/line/order-shape.spec.ts`, verified red against the pre-change recipes |
| AC-9 | The decision is recorded                                                                                                       | ADR under `docs/adr/`                                                         |

## Not doing

- Weakening or removing any compile check.
- A size control at intake, or a classifier. The shape stays derived from the
  plan.
- Touching `bugfix`, `refactor` or `speckit`'s own stage sequence beyond the
  `verify` collapse.
