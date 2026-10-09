# ADR 092: Foundry asks a risk question once

**Status**: Accepted

**Date**: 2026-10-08

Amends ADR 056 (a file count is not a budget) and ADR 085 (the draft opens
before the final check).

Numbered 092 because order WO-1008-58d adds an ADR 091 on its own branch.

## Context

Order WO-1008-58d added `rehype-raw` and `rehype-sanitize` to git-integration.
The plan declared `new_dependency` and was released at low risk. From the
order's own `ledger.jsonl` and `gates.json`:

| At    | What happened                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| 18:49 | "Riskier than planned" raised: `415 changed lines Triggered by new_dependency, outside_blast_radius`. Approved 12 seconds later |
| 18:52 | The run resumed and the push gate was raised: "Push and open a draft pull request?" at elevated risk                            |
| 20:28 | The push gate was approved, 96 minutes later                                                                                    |

Each of the three reasons was already settled:

- **`new_dependency`** was in the agreed plan's risk triggers. The operator
  weighed it when releasing the order.
- **`outside_blast_radius`** came from the root `CHANGELOG.md` and `README.md`.
  The scribe writes these on every order, because Constitution Principle VIII
  requires them.
- **415 changed lines** included 198 lines of `package-lock.json`. That moved
  the grade to elevated risk, which raised the push gate, so the operator was
  asked the same question a second time.

The push gate's ledger entry also read `answered "hold"`, but nobody answered
hold. The gate had only just been raised.

## Decision

1. **Only an unplanned trigger stops after the work.** `inspectionFor` returns
   `unplanned`, the triggers not in `order.risk.triggers`. The executor raises
   "riskier than planned" only when that list is not empty. The inspection
   itself still runs on every trigger, and its blocking findings still halt.
2. **Documentation is never outside the blast radius.** The test is
   `isDocumentationRelative`, the same rule the scribe's write policy uses.
3. **Lockfile lines are not weighed.** `readDiffSummary` takes a `weighLines`
   predicate. The run's observed change passes `!isLockfile`, so a lockfile
   still counts as a changed file but its lines do not count toward the
   300-line rule.
4. **An approval answers its rule for the whole order.** `askOnce` returns
   `approve` when any gate on the same order with the same rule was approved.
5. **A held push says it is waiting.** The ledger entry now reads "is waiting
   on you, so nothing was pushed yet".

## Consequences

- An unplanned trigger still stops for the operator. That includes
  authentication, secrets, migrations, a critical path, and code outside the
  declared scope.
- A change that grows a lot after the operator approves its risk is not asked
  about again before the push. CI and the draft review come after this point
  and still apply.
