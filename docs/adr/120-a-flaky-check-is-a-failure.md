# ADR 120: A flaky check is a failure

**Status**: Amended by ADR 123

**Date**: 2026-10-21

Amends ADR 080 (a final check asks whose failure it is): the final check no longer ships a run whose check failed once and passed on a re-run.

## Context

ADR 080 made the final check climb again after a failure. If the second climb passed, Foundry recorded `verify.flaky` in the ledger and carried on, so the draft opened green. A flake was hidden in a green draft and nobody was asked.

ADR 070 rejected the same bargain for end-to-end tests: a retry is a policy of accepting non-determinism, and the build fails on the first failure. A check that gives two answers on one commit has told us nothing about the change, and a draft that says it passed claims more than was measured.

## Decision

- A new gate rule, `verify.flaky` ("a check that failed and passed on the same commit"), stops the order. It is asked at `standard` and `escorted`, silenced at `lights-out` like the other verification rules. At `lights-out` the final check still counts as failed, so nothing ships.
- It offers three moves:
  - **Fix the flaky test in this order** (`send_back`): the builder gets both logs and is told to make the check deterministic, not to retry it. The checks then run again. Two send-backs are the limit, as for `verify.repeat-fail`.
  - **Ship with it named** (`accept_debt`): the draft opens and its description lists a "Known flaky" item naming the check, its command and both logs.
  - **Hold**, which is the default if ignored.
- The retry after a failure is kept, but a retry that passes now raises `verify.flaky` instead of recording and carrying on. A retry that fails goes on to the base-branch check and `verify.repeat-fail` or `verify.base-fail`, as before.
- Burn-in: the setting `terminator.foundry.finalRuns` (default 2, minimum 1) runs each test and end-to-end step that many times on the same commit. Runs that disagree raise `verify.flaky` directly with the two disagreeing logs, without a second climb. All failing is an ordinary failure; all passing is a pass. The repeats never come from the pass cache, which would only repeat the first answer.

## Consequences

- The final check's test and end-to-end steps take twice as long with the default. Setting `finalRuns` to 1 turns the burn-in off; the retry rule stays.
- A repository with a known flaky test now asks the operator once per order, and the answer is carried in the draft instead of being lost in the ledger.
- A resumed order that was shipped with a check named does not ask again about that check.

## Amendment (ADR 123)

Foundry no longer reruns a check. A check that fails once is a failure: the first result stands, whatever a rerun on the same commit would have said.

- Gone: the `verify.flaky` rule, the setting `terminator.foundry.finalRuns`, the burn-in, the retry after a failure, and the "Known flaky" lines in a draft's description. A gate an earlier build raised under `verify.flaky` still loads, read as `verify.repeat-fail`, which offers the same moves.
- Kept, because each runs something different from the failed run: the base-branch comparison (a different commit) and the preparation again of a lane (a re-prepared checkout, ADR 122). The preparation now runs straight after the first failure, as there is no retry before it.
