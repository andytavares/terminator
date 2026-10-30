# ADR 052: Budgets are the operator's

**Status**: Accepted. The files budget is superseded by [ADR 056](056-a-file-count-is-not-a-budget.md).

**Date**: 2026-09-13

## Context

A run halted with "Make all text in the application red has gone past its
files touched budget. The order budgets 10 and this run is at 1447." The operator could not tell what that meant. We looked into it and found four problems with how budgets worked:

- **The architect set them.** New orders start with the budgets in Settings (3 agents, 45 minutes, 25 files). But a proposal's `budgets` replaced the order's whole budget object (`applyProposal`). The architect's output contract showed an example of 12 files. This order's 25 became 10, and the operator never saw it happen.
- **No one could change an order's budgets.** The Forge showed budgets only as a pass/fail check. The only remedy of that check asked the architect to "propose budgets this plan fits".
- **"Raise the budget" did not raise anything.** The gate option only resumed the run (`act` in `index.ts`). The budget was unchanged, so the run went past it again and stopped at the next poll.
- **No one could switch a budget off.** `tokens` was the only nullable budget.

(The 1,447 itself was not the agent's work. Test fixtures that ran inside a pre-commit hook had written commits into that checkout. That is a separate defect, and this ADR does not cover it.)

## Decision

**The operator sets budgets, and the architect never does. The operator can switch off every enforced budget.**

- `agents`, `wallClockMinutes` and `filesTouched` are each a whole number ≥ 1 or `null`. `null` means no limit. `budgetBreach` never fires on a null budget. `readyNodes` starts everything that is ready when `agents` is null. The `budgets` compile check passes when `filesTouched` is null.
- In Settings, `0` means no limit (`budgetFromSetting`), because the settings surface has only a number field.
- `applyProposal` never touches `budgets`. The proposal schema still accepts the key. If it refused the key, a whole turn would be lost over a field that an architect may still write. The output contract no longer shows budgets, and it tells the architect to cut a plan that does not fit.
- The Forge's Plan step shows a draft order's three budgets. Each is a number with a "No limit" checkbox, and `foundry:order.budgets` saves it. An order that is no longer a draft shows its budgets as text. The `budgets` check now offers "Change the budget", which goes to those fields, and "Ask it to cut the plan".
- A `budget.exceeded` gate now carries its `breach` (`kind`, `limit`, `actual`). On the Floor and in the Inbox, "Raise the budget" opens a field for the new limit. The field starts about a quarter above where the run already is, and it refuses anything lower than that point. `foundry:inbox.decide` takes the limit and does these things in order:
  1. It refuses a limit that the run is already past, and decides nothing.
  2. It writes the limit to the order.
  3. It records `budget.raised`.
  4. It resumes the run.
- A gate raised before this change has no `breach`. For those gates, "Raise the budget" resumes the run as it did before. The run then hits the limit again and raises a new gate that has the breach.

## Alternatives considered

- **Let the architect propose budgets and have the operator approve them.** This keeps a second source of truth and adds an approval step to every draft. The operator would still need a way to set budgets directly.
- **Refuse `budgets` in a proposal.** A strict refusal loses the whole turn, and ADR 048's rendered order puts budgets in front of the architect.
- **Raise by a fixed step (for example, double it).** The operator cannot see or choose the new number, and a doubled 10 is still below 1,447.
- **Let the Forge edit a running order's budgets.** Executors read budgets when a run launches. The budget gate is the moment when a running order's budget matters, and resuming there makes the new limit take effect.

## Consequences

- Raising a budget at its gate is the one change that an operator makes to the `order.json` of a running order. The Line still never mutates the order. The change is the operator's decision, and the ledger records it (`gate.decided`, then `budget.raised`).
- Foundry measures the wall-clock budget from when the current run launched. Resuming starts that clock again, so a raised minute limit is generous, not exact.
- Nothing enforces `tokens`, so it has no control.
