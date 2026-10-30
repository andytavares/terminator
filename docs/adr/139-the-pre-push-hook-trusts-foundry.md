# ADR 139: The pre-push hook trusts Foundry's pushes

**Status**: Accepted

**Date**: 2026-10-30

**Amends**: [ADR 136](136-a-real-order-runs-before-foundry-changes-ship.md)

## Context

Order `WO-1030-4b9` stopped with "Pushing terminator was refused, so no pull request was opened: ci:local has not passed on the commit of HEAD". The pre-push hook (`scripts/ci-local.mjs`, `checkPush`) refuses any commit without a recorded `ci:local` pass. Foundry pushes the branch of an order from the checkout of the order, where nobody runs `ci:local`. **Try again** pushed again and the hook refused it the same way, every time.

## Decision

- Foundry pushes with `git -c foundry.push=true push …` (`FOUNDRY_PUSH` in `extensions/foundry/src/line/integrate.ts`). Git hands `-c` settings to the hooks that it runs.
- `checksPushes` skips a push whose `git config foundry.push` is `true`, the same way it skips a push where `CI` is set. That skips both the `ci:local` record and the canary record.

## Consequences

- An order on this repository opens its draft. The final check of Foundry ran on it, and GitHub CI runs on the draft before anyone merges it.
- A person can pass the same setting by hand. This is no new way around the hook, because `git push --no-verify` already skips it.
