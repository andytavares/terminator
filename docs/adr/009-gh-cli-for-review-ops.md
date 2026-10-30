# ADR-009: Use `gh` CLI for all GitHub PR Review operations

**Date**: 2026-05-07
**Status**: Accepted
**Branch**: `003-pr-review`

## Decision

The PR review feature makes all GitHub API calls (list PRs, fetch file diffs, read/write inline comments, submit reviews) via `gh api` subcommands. The main process runs them through the existing sandboxed `execShell` function and exposes them to the renderer via new `github:*` IPC channels.

## Motivation

1. **Auth is already solved.** The `gh` CLI handles OAuth token storage, refresh, and scoping. A separate authentication path (Octokit + token management in the renderer) would create a second, divergent auth mechanism.

2. **The existing sandbox enforces allowed commands.** `src/main/shell/shell-executor.ts` already permits `git` and `gh`. The new channels add `gh api` invocations and need no sandbox changes.

3. **No new native dependencies.** Octokit would add ~120 KB of JS and its own release cadence. The existing PR creation feature already requires the `gh` binary.

4. **Consistent with the established pattern.** `GhService` in the git-integration extension already calls `gh pr view` and `gh pr create` this way. If review operations diverged from it, the same extension would have two patterns.

## Alternatives Considered

| Alternative                                            | Why Rejected                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `@octokit/rest` (REST SDK)                             | Second auth mechanism; new pinned dependency; no benefit over `gh api` for our access patterns               |
| GitHub GraphQL API via `gh api graphql`                | More efficient batching but adds query complexity; can be adopted in v2 if REST proves too slow              |
| Direct `fetch` from renderer via Electron `net` module | Bypasses sandbox entirely; requires managing tokens in renderer process; against established project pattern |

## Consequences

- `execShell` logs all GitHub API calls, so they are observable as shell executions.
- Rate-limit errors surface as `gh` exit code 1 with detectable stderr text. The IPC response maps them to `{ error: 'RATE_LIMITED', resetAt: number }`.
- The `gh api --paginate` flag handles pagination.
- Each `gh api` invocation spawns a subprocess. For large PRs with many files, the app must batch or sequence requests and not make them in parallel (respect `gh`'s own rate-limit handling).
