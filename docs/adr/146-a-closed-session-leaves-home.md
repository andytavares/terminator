# ADR 146: A closed session leaves Home, and Dismiss deletes it

**Status**: Accepted, amended by [ADR 157](157-settle-is-the-one-word.md) (Dismiss became Settle and deletes nothing)

**Date**: 2026-11-07

**Amends**: [ADR 118](118-dismissed-means-gone.md)

## Context

Dismiss on Home only hid a row by its work key in `localStorage`. The session records behind the row stayed on disk. A closed session also stayed on Home, and its record was kept for 30 days. The operator's rule is that dismissed means gone, and that a session closed in the terminal views is no longer Home's to show.

## Decision

- Home builds its rows from open sessions only (`buildWorkThreads` in `src/renderer/home/work-threads.ts`). A closed session leaves Tasks, Needs you and the threads at once. `allWorkThreads` still joins closed sessions, so the app knows which ended sessions a row holds.
- Dismiss still hides the row by its work key (ADR 118). For a row that holds Terminator sessions, the app also deletes, through `sessionRecords.forget`, the record of each session on it that has ended. A session still running on a dismissed row is deleted as soon as it ends (`endedSessionsOfDismissed` in `dismissed-threads.ts`, run by `useWorkThreads`). `forget` refuses an open record, so a running terminal never loses its record.
- A row that only an extension shows, such as a GitHub pull request, is not Terminator's to delete. Dismiss only hides it, as before.
- The toast keeps **Undo**. Undo brings the row back. It cannot bring back a deleted record, and it does not need to: an ended session is never on Home.
- **Delete closed sessions after** (`sessions.deleteClosedAfterHours`, Settings → Appearance & Terminal) sets how long a closed record stays for resume: 24 hours by default, 1 hour to 720 hours (30 days). Main reads it at each prune (`configureRetention` in `session-record-store.ts`), purges at startup and every hour (`startPurging`), and announces each purged record to the renderer.
- `RETENTION_MS` (30 days) is now the top of the setting. The store uses it until main reads the setting, so no record goes early. The agent log keeps pruning at 30 days, the longest a record can live.

## Consequences

- An ended conversation is resumed from its Overview tile, or with **Resume a conversation…** in Quick actions, which now reopens the conversation that ended most recently at once instead of opening a Home drawer.
- Insights does not read session records. It reads the attention log (90 days) and extension facets, so the shorter retention does not change it.
- A record deleted by Dismiss or by the purge also deletes the session's agent context (`deleteSessionContext`).
