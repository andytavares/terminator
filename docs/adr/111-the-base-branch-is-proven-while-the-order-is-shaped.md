# ADR 111: The base branch is proven while the order is shaped

**Status**: Accepted

**Date**: 2026-10-14

Amends ADR 080 (a final check asks whose failure it is) and ADR 088 (Foundry
mends broken installs).

## Context

Foundry found out that a repository could not build or pass its own checks only
at the end of a run. Before PR #218, every order on this repository halted at
the final check because e2e ran in an unbuilt checkout. ADR 088 then taught the
final check to mend a broken install, but still only after the builders had
spent a whole run.

Blitzy, an enterprise autonomous-development platform, gates every project on
an environment test that builds and runs the repository before any code is
generated ([Environment Testing](https://docs.blitzy.com/project-lifecycle/environment-testing)).
The comparison is in the design document that led to this ADR.

## Decision

1. **A new order proves its base branch while it is shaped.** When the Forge
   creates an order, `proveEnvironment` (`extensions/foundry/src/line/baseline.ts`)
   checks out the base branch and runs format, lint, tests and build, each in
   its own terminal tab, while the architect and red team work. Each step runs
   even when an earlier one fails, so the record says everything that is
   wrong. A broken install is mended once, as in ADR 088.
2. **The result is a record, not a guess.** It is written to `baseline.json`
   beside the order, with the base commit, and to the ledger as
   `environment.checking`, then `environment.proven` or `environment.failing`.
3. **Hand-off waits for it, and names its moves.** The Hand off step gains a
   seventh row, "The base branch builds and passes its checks". While it is not
   passing, the row offers **Check again** and **Hand off anyway**. Handing off
   anyway records `environment.waived`. A bug fix whose only failure on base is
   its tests passes the row, because a failing test is where a bug fix starts.
4. **The final check does not run a command twice on the same base.** When the
   final check climbs the base branch to ask whose failure it is (ADR 080), a
   step the baseline already ran on the same base commit returns its recorded
   exit code instead of running again.
5. **The pull request says what is left.** The body gains "What's left for
   you": the criteria that did not pass, the checks not measured, the checks
   that fail on base, accepted red-team findings, assumptions nobody struck,
   and open questions. Every item comes from a record; nothing is estimated.

## Consequences

- A repository that cannot build is known before Hand off, not after a run.
- Shaping now runs up to four commands on the operator's machine. They run in
  visible terminal tabs, beside the agents.
- Orders created before this, and orders a sensor seeds, have no baseline. Their
  row reads "Not checked for this order yet" and offers the same two moves.
- The scout's repo brief from the same design was not built. Measured over the
  four orders with both scout lines, the scout took 0.8 to 1.4 minutes of
  shaping, so a cache could save at most that much per order.
