# ADR 052: Budgets are the operator's

**Status**: Accepted

**Date**: 2026-09-13

## Context

A run halted with "Make all text in the application red has gone past its
files touched budget. The order budgets 10 and this run is at 1447." The
operator could not tell what that meant, and looking into it showed four
problems with how budgets worked:

- **The architect set them.** New orders start with the budgets in Settings
  (3 agents, 45 minutes, 25 files), but a proposal's `budgets` replaced the
  order's whole budget object (`applyProposal`). The architect's output contract
  showed an example of 12 files. This order's 25 became 10, and the operator
  never saw it happen.
- **No order's budgets could be changed.** The Forge showed budgets only as a
  pass/fail check. That check's only remedy asked the architect to "propose
  budgets this plan fits".
- **"Raise the budget" did not raise anything.** The gate option only resumed
  the run (`act` in `index.ts`). The budget was unchanged, so the run went past
  it again and stopped at the next poll.
- **A budget could not be switched off.** `tokens` was the only nullable
  budget.

(The 1,447 itself was not the agent's work. Test fixtures running inside a
pre-commit hook had written commits into that checkout. That is a separate
defect, not covered here.)

## Decision

**Budgets are set by the operator, never by the architect, and every enforced
budget can be switched off.**

- `agents`, `wallClockMinutes` and `filesTouched` are each a whole number ≥ 1
  or `null`, and `null` means no limit. `budgetBreach` never fires on a null
  budget, `readyNodes` starts everything ready when `agents` is null, and the
  `budgets` compile check passes when `filesTouched` is null.
- In Settings, `0` means no limit (`budgetFromSetting`), because the settings
  surface only has a number field.
- `applyProposal` never touches `budgets`. The proposal schema still accepts
  the key, because refusing it would throw away a whole turn over a field an
  architect may still write. The output contract no longer shows budgets, and
  it tells the architect to cut a plan that does not fit.
- The Forge's Plan step shows a draft order's three budgets, each as a number
  with a "No limit" checkbox, saved through `foundry:order.budgets`. An order
  that is no longer a draft shows its budgets as text. The `budgets` check now
  offers "Change the budget", which goes to those fields, and "Ask it to cut
  the plan".
- A `budget.exceeded` gate now carries its `breach` (`kind`, `limit`,
  `actual`). On the Floor and in the Inbox, "Raise the budget" opens a field
  for the new limit. It starts about a quarter above where the run already is
  and refuses anything lower than that point. `foundry:inbox.decide` takes the
  limit, refuses one the run is already past without deciding anything,
  writes the limit to the order, records `budget.raised`, and then resumes the
  run.
- A gate raised before this change has no `breach`. For those, "Raise the
  budget" resumes the run as it did before. The run then hits the limit again
  and raises a new gate that has the breach.

## Alternatives considered

- **Let the architect propose budgets and have the operator approve them.**
  This keeps a second source of truth, adds an approval step to every draft,
  and the operator would still need a way to set budgets directly.
- **Refuse `budgets` in a proposal.** A strict refusal loses the whole turn,
  and ADR 048's rendered order puts budgets in front of the architect.
- **Raise by a fixed step (for example, double it).** The operator cannot see
  or choose the new number, and a doubled 10 is still below 1,447.
- **Let the Forge edit a running order's budgets.** Executors read budgets
  when a run launches. The budget gate is the moment a running order's budget
  matters, and resuming there is what makes the new limit take effect.

## Consequences

- Raising a budget at its gate is the one change an operator makes to the
  `order.json` of a running order. The Line still never mutates the order. The
  change is the operator's decision, and the ledger records it (`gate.decided`,
  then `budget.raised`).
- The wall-clock budget is measured from when the current run launched.
  Resuming starts that clock again, so a raised minute limit is generous
  rather than exact.
- `tokens` is still enforced by nothing, so it has no control.
