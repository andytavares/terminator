# ADR 056: A file count is not a budget

**Status**: Accepted

**Date**: 2026-09-17

**Supersedes**: the `filesTouched` parts of [ADR 052](052-budgets-are-the-operators.md), and the `budgets` compile check of [ADR 049](049-an-accidental-question-costs-five-minutes.md).

## Context

An order carried three enforced budgets: agents at once, minutes, and files touched. The files budget did two things, and the operator found both of them useless:

- **At the Forge**, the `budgets` check refused a plan that declared more files than the budget, or that filled the budget without a quarter's headroom. The check refused a plan that was honest about its size, and the architect was told to cut it.
- **On the Line**, the run halted once its working copies had changed more files than the budget. Foundry knows the count only once the work is done. So it halted runs that had already done the work. "Make all text red" stopped at 48 files against a budget of 42 after fifty-three minutes and shipped nothing.

A person can reason about agents at once and minutes before a run starts. A person cannot reason about a file count the same way. How many files a change needs is a fact about the change. It is not a cost to cap.

## Decision

**There is no files budget. An order's budgets are agents at once and minutes.**

- `filesTouched` is gone from the order schema, the settings, the Forge's budget form, the rendered order, and the architect's prompt. An order written before this still opens, and Foundry drops the files limit that it carried when it reads the order.
- The `budgets` compile check is gone. It checked only the file count, so there are five checks.
- `budgetBreach` checks the wall clock and the agents. Suppose a `budget.exceeded` gate saved before this change names `files_touched`. Foundry drops its breach when it reads the gate, so "Raise the budget" resumes the run, as it does for a gate that never recorded a breach.
- Foundry still measures how wide a change went. The regrade reads the working copies at the end, and a file outside the blast radius still raises `outside_blast_radius`. That is a risk signal with a reason attached. It is not a count.

## Alternatives considered

- **Keep the budget and default it to no limit.** The check, the setting and the form would still be there, set to nothing, for a budget that nobody should set.
- **Keep the Line's halt but drop the Forge check.** The halt is the half that cost fifty-three minutes. It fires after the work is done, when stopping protects nothing.

## Consequences

- Foundry never refuses a plan for its size. The architect's prompt no longer tells it to budget files with room.
- A run no longer runs `git diff` on every budget poll. Foundry reads the observed change once, for the regrade.
