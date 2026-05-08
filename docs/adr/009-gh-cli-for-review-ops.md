# ADR-009: Use `gh` CLI for all GitHub PR Review operations

**Date**: 2026-05-07
**Status**: Accepted
**Branch**: `003-pr-review`

## Decision

All GitHub API calls for the PR review feature (list PRs, fetch file diffs, read/write inline comments, submit reviews) will be executed via `gh api` subcommands, shelled out through the existing sandboxed `execShell` function in the main process, exposed to the renderer via new `github:*` IPC channels.

## Motivation

1. **Auth is already solved.** The `gh` CLI handles OAuth token storage, refresh, and scoping. Introducing a separate authentication path (Octokit + token management in the renderer) would create a second, divergent auth mechanism.

2. **Existing sandbox enforces allowed commands.** `src/main/shell/shell-executor.ts` already permits `git` and `gh`. The new channels add `gh api` invocations without requiring any sandbox changes.

3. **No new native dependencies.** Octokit would add ~120 KB of JS + its own release cadence. The `gh` binary is already required for the existing PR creation feature.

4. **Consistent with the established pattern.** `GhService` in the git-integration extension already calls `gh pr view` and `gh pr create` this way. Diverging from it for review operations would create two divergent patterns in the same extension.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| `@octokit/rest` (REST SDK) | Second auth mechanism; new pinned dependency; no benefit over `gh api` for our access patterns |
| GitHub GraphQL API via `gh api graphql` | More efficient batching but adds query complexity; can be adopted in v2 if REST proves too slow |
| Direct `fetch` from renderer via Electron `net` module | Bypasses sandbox entirely; requires managing tokens in renderer process; against established project pattern |

## Consequences

- All GitHub API calls are observable as shell executions (logged by `execShell`).
- Rate-limit errors surface as `gh` exit code 1 with detectable stderr text; mapped to `{ error: 'RATE_LIMITED', resetAt: number }` in IPC response.
- Pagination is handled via `gh api --paginate` flag.
- Each `gh api` invocation spawns a subprocess; for large PRs with many files, requests must be batched or sequenced rather than made in parallel (respect `gh`'s own rate-limit handling).
