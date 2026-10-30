# ADR 111: The base branch is proven while the order is shaped

**Status**: Accepted; Amended by ADR 121, ADR 122; decisions 1, 3 and 4 superseded by ADR 137

**Date**: 2026-10-14

Amends ADR 080 (a final check asks whose failure it is) and ADR 088 (Foundry
mends broken installs).

## Context

Foundry found out that a repository could not build or pass its own checks only
at the end of a run. Before PR #218, every order on this repository halted at
the final check, because e2e ran in an unbuilt checkout. ADR 088 then taught the
final check to mend a broken install. But the mend still came only after the
builders had spent a whole run.

Blitzy, an enterprise autonomous-development platform, gates every project on
an environment test. The test builds and runs the repository before any code is
generated ([Environment Testing](https://docs.blitzy.com/project-lifecycle/environment-testing)).
The design document that led to this ADR holds the comparison.

## Decision

1. **A new order proves its base branch while it is shaped.** When the Forge
   creates an order, `proveEnvironment` (`extensions/foundry/src/line/baseline.ts`)
   checks out the base branch into its own fresh worktree (`<repo>@baseline`,
   never the `@base` of the line). It runs format, lint, tests and build, each in
   its own terminal tab, while the architect and red team work. Each step runs
   even when an earlier step fails, so the record says everything that is
   wrong. The proof mends a broken install once, as in ADR 088. One proof runs per
   order at a time. A second request while one runs joins it.
2. **The result is a record, not a guess.** The proof writes it to `baseline.json`
   beside the order, with the commit of the checkout, and to the ledger as
   `environment.checking`, then `environment.proven` or `environment.failing`.
   Proven needs at least one passing step. A base where nothing could be
   measured is not proven (rule 2 of the extension: "not measured" is never a
   pass). A check that was still running when the application quit reads as stopped.
   You can run it again.
3. **Hand-off waits for it, and names its moves.** The Hand off step gains a
   seventh row, "The base branch builds and passes its checks". While the base is not
   passing, the row offers **Check again** and **Skip this check**. Skipping
   records `environment.waived`. A later check that fails again needs a new
   decision. A bug fix whose only failure on base is its tests passes the row,
   because a failing test is where a bug fix starts. The backend refuses to
   agree an order that the row holds, so the automatic hand-off waits too.
4. **The final check does not run a passing command twice on the same base.**
   The final check climbs the base branch to ask whose failure it is
   (ADR 080). A step that the baseline saw pass on the same base commit returns that
   pass instead of running again. A recorded failure always runs again. A
   failure on base excuses the change, so it must be fresh.
5. **The pull request says what is left.** The body gains "What's left for
   you". It lists the criteria that did not pass, the checks not measured, the checks
   that fail on base, accepted red-team findings, assumptions nobody struck,
   and open questions. Every item comes from a record. Nothing is estimated.

## Consequences

- Foundry knows that a repository cannot build before Hand off, not after a run.
- Shaping now runs up to four commands on the machine of the operator. They run in
  visible terminal tabs, beside the agents.
- Orders created before this ADR, and orders that a sensor seeds, have no baseline. Their
  row reads "Not checked for this order yet" and offers the same two moves.
- The repo brief of the scout, from the same design, was not built. Measured over the
  four orders with both scout lines, the scout took 0.8 to 1.4 minutes of
  shaping. So a cache could save at most that much per order.
