# ADR 092: Foundry asks a risk question once

**Status**: Accepted

**Date**: 2026-10-08

Amends ADR 056 (a file count is not a budget) and ADR 085 (the draft opens
before the final check).

Numbered 092 because order WO-1008-58d adds an ADR 091 on its own branch.

## Context

Order WO-1008-58d added `rehype-raw` and `rehype-sanitize` to git-integration.
The plan declared `new_dependency` and was released at low risk. The
`ledger.jsonl` and `gates.json` of the order show:

| At    | What happened                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| 18:49 | "Riskier than planned" raised: `415 changed lines Triggered by new_dependency, outside_blast_radius`. Approved 12 seconds later |
| 18:52 | The run resumed and the push gate was raised: "Push and open a draft pull request?" at elevated risk                            |
| 20:28 | The push gate was approved, 96 minutes later                                                                                    |

The operator had already settled each of the three reasons:

- **`new_dependency`** was in the risk triggers of the agreed plan. The operator
  weighed it when releasing the order.
- **`outside_blast_radius`** came from the root `CHANGELOG.md` and `README.md`.
  The scribe writes these on every order, because Constitution Principle VIII
  requires them.
- **415 changed lines** included 198 lines of `package-lock.json`. That moved the
  grade to elevated risk, which raised the push gate. So the operator got the
  same question a second time.

The ledger entry of the push gate also read `answered "hold"`, but nobody
answered hold. The gate had only just been raised.

## Decision

1. **Only an unplanned trigger stops after the work.** `inspectionFor` returns
   `unplanned`, the triggers that are not in `order.risk.triggers`. The executor
   raises "riskier than planned" only when that list is not empty. The
   inspection itself still runs on every trigger, and its blocking findings
   still halt.
2. **Documentation is never outside the blast radius.** The test is
   `isDocumentationRelative`, the same rule that the write policy of the scribe
   uses.
3. **Lockfile lines are not weighed.** `readDiffSummary` takes a `weighLines`
   predicate. The observed change of the run passes `!isLockfile`. A lockfile
   still counts as a changed file, but its lines do not count toward the
   300-line rule.
4. **An approval answers its rule for the whole order.** `askOnce` returns
   `approve` when any gate on the same order with the same rule was approved.
5. **A held push says it is waiting.** The ledger entry now reads "is waiting on
   you, so nothing was pushed yet".

## Consequences

- An unplanned trigger still stops for the operator. This includes
  authentication, secrets, migrations, a critical path, and code outside the
  declared scope.
- Foundry does not ask again before the push about a change that grows a lot
  after the operator approves its risk. CI and the draft review come after this
  point and still apply.
