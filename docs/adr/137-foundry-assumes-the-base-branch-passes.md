# ADR 137: Foundry assumes the base branch passes

**Status**: Accepted

**Date**: 2026-10-29

Supersedes ADR 111 decisions 1, 3 and 4, and decision 2 of ADR 080. Amends ADR 121 ("Proof on the base").

## Context

Order `WO-1030-81e` (TAV-20, a research order) never finished. Shaping spent 4 minutes 51 seconds running prepare, format, lint, tests, coverage, build and end-to-end on `main` (`environment.checking` at 01:20:21, `environment.proven` at 01:25:12), and Hand off waited for it. The run then raised "work that keeps failing its checks" three times: each **Accept the debt** resumed the run, the final check climbed again, and a new gate was raised, because only an **Approve** was remembered (`Execution.stopAtGate`). Every gate said "It passes on main without this change", answered from the shaping results.

The operator's position: the base branch is assumed to pass. Running its suite while a plan is evaluated costs minutes and machine load on every order, and comparing a failure on the base answers a question the operator does not ask.

## Decision

1. **No automatic base-branch runs.** An order is not checked on its base while it is shaped, and a failed final check is not climbed again on a checkout of the base. `proveEnvironment`, the Hand off row "The base branch builds and passes its checks", its **Check again** and **Skip this check**, the `@base` checkout and `verify.base-fail` raising are removed.
2. **A failed final check is the order's failure.** It raises `verify.repeat-fail` with its log. The operator decides.
3. **An accepted debt is final.** A decision of `accept_debt` on a final-check gate settles it: the run records `verify.debt_accepted`, does not ask again, ships as a draft, and the pull request's "What's left for you" names the failed step.
4. **Scout commands are not run on the base.** A scout proposal fills a check that has no command, with source `scout`, unproven.
5. **The operator's Prove stays.** **Prove** on the Checks step still runs one command on a fresh `@baseline` checkout, because a person asked for it. That checkout's sidebar project is removed with it.

## Consequences

- An order can be handed off as soon as its plan checks pass.
- A check that already fails on the base reads as this order's failure. The gate shows the log; **Accept the debt** ends it in one answer.
- The sidebar no longer shows a `main` checkout for an order.
- Profile entries from `hint` or `scout` are trusted without a run. A wrong command shows up as a failed final check.
