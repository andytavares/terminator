# ADR 136: A real order runs before Foundry changes ship

**Status**: Accepted

**Date**: 2026-10-29

**Relates to**: [ADR 123](123-tests-run-once-sealed-and-selected.md), [ADR 133](133-paved-path-cleanup.md)

## Context

Foundry's tests fake Claude, `gh`, the remote and Linear. No check proves that one real order goes from a ticket to an open draft pull request. A change to how Foundry talks to Claude, git, GitHub or Linear can pass every test and still break every order.

## Decision

`npm run canary` (`scripts/foundry-canary.mjs`) runs one real order on this repository (`andytavares/terminator`), on the operator's Mac, with the real `claude`, `gh`, `git`, HOME and PATH.

- **The run.** It creates a Linear ticket in team `TAV`, labelled `canary` and unassigned. It starts the app on a fresh `--user-data-dir` with the operator's `integrations.json`, creates the order from the ticket (`foundry:order.create` with `canary: true`), converges it, compiles it with `commit: true` and starts the run. It passes when the ledger has `run.complete`, an open draft pull request exists on the order's branch, no write-back failed, and the ticket shows a comment and a started state.
- **The branch name.** `canary: true` changes one thing: the order works on `canary/<order id>` (`onCanaryBranch` in `extensions/foundry/src/ipc/forge-channels.ts`). A leftover is found by that name, on the remote, locally and in `order.json`.
- **Local only.** It never runs in CI and gates no workflow. CI skips pull requests from `canary/**` branches (`if` on every job in `ci.yml` and `fill-pr-description.yml`).
- **Required before a push** that changes the paths in `CANARY_PATHS` (`scripts/foundry-canary.mjs`), or the locked version of `@agentclientprotocol/claude-agent-acp` or `@anthropic-ai/claude-code`. A pass is recorded for `HEAD` (`git rev-parse --git-path foundry-canary-passed`). The pre-push hook (`scripts/ci-local.mjs`, `checkPush`) refuses a push whose commit has no pass.
- **Cleanup.** At the start it removes what an earlier run left. In `finally` it quits the app, closes the pull request, deletes the remote and local branches, removes the order worktrees and folder, and cancels the ticket. It then looks again and fails if anything is left, or if the app log gained an `ERROR` line during the run. On failure it prints the stage reached, the last 20 ledger entries and the agent's reason.

## Alternatives considered

- **Another repository.** It needs its own remote and upkeep. Foundry has no repository-specific code, so any one real repository exercises every integration point; this one is always on the machine and its CI is under our control.
- **A CI or nightly job.** Principle XIV: outside services never gate, and specs connect only to loopback. A run selected by the diff on the operator's machine covers the same changes without that.
- **Every push.** A real run takes many minutes and uses a Claude session. Only the integration paths need it.

## Consequences

- A push that changes those paths costs one real run first.
- A canary run creates and cancels one Linear ticket and one pull request each time.
- A crash of the canary itself can leave a ticket or branch; the next run's sweep removes them.
