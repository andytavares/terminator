# ADR 120: A flaky check is a failure

**Status**: Amended by ADR 123

**Date**: 2026-10-21

Amends ADR 080 (a final check asks whose failure it is): the final check no longer ships a run whose check failed once and passed on a re-run.

## Context

ADR 080 made the final check climb again after a failure. If the second climb passed, Foundry recorded `verify.flaky` in the ledger and carried on, so the draft opened green. The draft hid the flake in green, and nobody was asked.

ADR 070 rejected the same bargain for end-to-end tests. A retry is a policy of accepting non-determinism, and the build fails on the first failure. A check that gives two answers on one commit has told us nothing about the change. A draft that says it passed claims more than was measured.

## Decision

- A new gate rule, `verify.flaky` ("a check that failed and passed on the same commit"), stops the order. The gate asks at `standard` and `escorted`. It is silenced at `lights-out`, like the other verification rules. At `lights-out` the final check still counts as failed, so nothing ships.
- The gate offers three moves:
  - **Fix the flaky test in this order** (`send_back`): the builder gets both logs and must make the check deterministic, not retry it. The checks then run again. The limit is two send-backs, as for `verify.repeat-fail`.
  - **Ship with it named** (`accept_debt`): the draft opens, and its description lists a "Known flaky" item that names the check, its command and both logs.
  - **Hold**, which is the default if the operator ignores the gate.
- The retry after a failure stays. A retry that passes now raises `verify.flaky`. Before, it recorded the result and carried on. A retry that fails goes on to the base-branch check and `verify.repeat-fail` or `verify.base-fail`, as before.
- Burn-in: the setting `terminator.foundry.finalRuns` (default 2, minimum 1) runs each test and end-to-end step that many times on the same commit. If the runs disagree, they raise `verify.flaky` directly with the two disagreeing logs, without a second climb. If all runs fail, the failure is ordinary. If all runs pass, the check passes. The repeats never come from the pass cache, which would only repeat the first answer.

## Consequences

- With the default, the test and end-to-end steps of the final check take twice as long. Setting `finalRuns` to 1 turns the burn-in off. The retry rule stays.
- A repository with a known flaky test now asks the operator once per order. The draft carries the answer instead of the ledger losing it.
- A resumed order that shipped with a check named does not ask again about that check.

## Amendment (ADR 123)

Foundry no longer reruns a check. A check that fails once is a failure. The first result stands, whatever a rerun on the same commit would have said.

- Gone: the `verify.flaky` rule, the setting `terminator.foundry.finalRuns`, the burn-in, the retry after a failure, and the "Known flaky" lines in the description of a draft. A gate that an earlier build raised under `verify.flaky` still loads. It reads as `verify.repeat-fail`, which offers the same moves.
- Kept, because each one runs something different from the failed run: the base-branch comparison (a different commit) and the preparation again of a lane (a re-prepared checkout, ADR 122). The preparation now runs straight after the first failure, as there is no retry before it.
