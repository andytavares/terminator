# ADR 088: Foundry mends broken installs and never opens an order itself

**Status**: Accepted

**Date**: 2026-10-07

Amends ADR 080 (a final check asks whose failure it is).

## Context

Order WO-1008-6fe's final check failed `npm run test:e2e` twice, and neither
failure had anything to do with the code:

- in the order's checkout, Electron was half downloaded:
  `Library not loaded: @rpath/Electron Framework.framework/Electron Framework`;
- in the base checkout, which borrows the origin's `node_modules`, a package
  added to `package.json` had never been installed:
  `Cannot find package '@axe-core/playwright'`.

ADR 080 read the second one as "the check already fails on main" and offered
**Fix it first**. Taking it opened WO-1008-05e, an order the operator never
started, to fix a main branch that was not broken.

## Decision

1. **A broken install is mended, not asked about.** `verify/broken-install.ts`
   reads a failed step's log for a missing package or a library that cannot
   load. When the order's checkout shows one, the executor reinstalls with the
   lockfile's own command (`installCommandFor`: `npm ci`, `pnpm install
--frozen-lockfile` or `yarn install --frozen-lockfile`) in a visible
   terminal tab, records `verify.reinstalled`, and climbs the ladder again. The
   base checkout gets the same treatment before its result is believed.
   Borrowed `node_modules` links are removed first
   (`unlinkBorrowedDependencies`), so an install never writes into the origin.
2. **A broken install is never blamed on the base branch.** If reinstalling
   does not mend it, the gate is `verify.repeat-fail` and says the installed
   dependencies are broken and what is missing; a base checkout that cannot be
   mended reads as "could not be checked".
3. **Foundry never opens an order.** Only the operator starts one. The
   `verify.base-fail` gate's first move is now **Fix it in this order**: the
   failure goes back to the builders of this order, like the final check's own
   Send back, and the checks run again. `baseFixOrderText`, the refinery's
   `waitingOn` state and the `waiting` standing are deleted.

## Consequences

- A broken install costs one reinstall and one more climb instead of a
  question.
- A check that genuinely fails on main is fixed on the order's own branch, so
  the pull request carries a fix beyond what was asked; the operator chose it.
- Orders written before this with `waitingOn` in `refinery.json` are no longer
  held by it: the field is ignored.
