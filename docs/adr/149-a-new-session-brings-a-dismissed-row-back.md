# ADR 149: A new session brings a dismissed row back

**Status**: Superseded by [ADR 157](157-settle-is-the-one-word.md)

**Date**: 2026-11-07

**Amends**: [ADR 118](118-dismissed-means-gone.md)

## Context

ADR 118 keeps a dismissal by work key until the operator undoes it. A branch row's key is its repo and branch, for example `/Users/atavares/repos/terminator#main`. After the operator dismissed the `main` row once, every later terminal or Claude session on `main` joined that row, and Home never showed it. Only Start work restored a row (`restoreStarted`), so a session opened with ⌘T or from a shell stayed hidden. Nothing on screen listed the dismissed rows, so the operator could not bring one back after the Undo toast closed.

## Decision

- A dismissed row comes back when a session on it started after the dismissal (`isDismissed` in `src/renderer/components/home/dismissed-threads.ts`). What a session prints still does not bring it back, so the reason for ADR 118 stays.
- The Home footer has **Dismissed (N)**, beside **Archived tasks**. It lists every row Home would show but the operator dismissed, each with **Restore** (`DismissedTasks.tsx`).

## Alternatives

- **Key a dismissal by session instead of by row.** A row also holds pull requests and tickets, which ADR 118 hides by key; a session key alone would bring every dismissed pull request row back.
- **Restore the row only from Start work and ⌘T.** Sessions also start from a shell, a scheduled run and the Terminator MCP server; each would need its own call.

## Consequences

- A row the operator dismissed while its session ran stays hidden while that session runs; a new session on the same branch shows it again.
- Dismissed keys whose work is gone are not listed, because there is nothing left to restore; they are forgotten after 30 days as before.
