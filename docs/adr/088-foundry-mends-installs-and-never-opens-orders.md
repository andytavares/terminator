# ADR 088: Foundry mends broken installs and never opens an order itself

**Status**: Accepted; Amended by ADR 122

**Date**: 2026-10-07

Amends ADR 080 (a final check asks whose failure it is).

## Context

The final check of order WO-1008-6fe failed `npm run test:e2e` twice. Neither
failure had anything to do with the code:

- In the checkout of the order, Electron was half downloaded:
  `Library not loaded: @rpath/Electron Framework.framework/Electron Framework`.
- In the base checkout, which borrows the `node_modules` of the origin, a
  package added to `package.json` had never been installed:
  `Cannot find package '@axe-core/playwright'`.

ADR 080 read the second failure as "the check already fails on main" and
offered **Fix it first**. Taking it opened WO-1008-05e, an order that the
operator never started, to fix a main branch that was not broken.

## Decision

1. **A broken install is mended, not asked about.** `verify/broken-install.ts`
   reads the log of a failed step for a missing package or a library that cannot
   load. When the checkout of the order shows one, the executor reinstalls with
   the own command of the lockfile (`installCommandFor`: `npm ci`,
   `pnpm install --frozen-lockfile` or `yarn install --frozen-lockfile`) in a
   visible terminal tab. It records `verify.reinstalled` and climbs the ladder
   again. The base checkout gets the same treatment before the executor believes
   its result. Borrowed `node_modules` links are removed first
   (`unlinkBorrowedDependencies`), so an install never writes into the origin.
2. **A broken install is never blamed on the base branch.** If reinstalling does
   not mend it, the gate is `verify.repeat-fail`. It says that the installed
   dependencies are broken and what is missing. A base checkout that cannot be
   mended reads as "could not be checked".
3. **Foundry never opens an order.** Only the operator starts one. The first
   move of the `verify.base-fail` gate is now **Fix it in this order**. The
   failure goes back to the builders of this order, like the own Send back of
   the final check, and the checks run again. `baseFixOrderText`, the `waitingOn`
   state of the refinery and the `waiting` standing are deleted.

## Consequences

- A broken install costs one reinstall and one more climb instead of a question.
- A check that genuinely fails on main is fixed on the own branch of the order.
  So the pull request carries a fix beyond what was asked. The operator chose
  this.
- Orders written before this change with `waitingOn` in `refinery.json` are no
  longer held by it. The field is ignored.
