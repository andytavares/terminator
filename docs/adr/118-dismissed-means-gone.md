# ADR 118: Dismissed means gone

**Status**: Accepted

**Date**: 2026-10-19

**Relates to**: [ADR 117](117-extensions-send-home-data-core-draws-it.md)

## Context

Dismissing an In flight row on Home hid the row only until the work showed new activity. The git extension stamped every open pull request facet with the time of its fetch, which runs every two minutes. So every dismissed pull request row came back within two minutes. The rule of the operator is that a dismissed row stays gone.

## Decision

- The app keeps a dismissal by work key. It hides the row until the operator undoes the dismissal. Activity on the work does not bring the row back (`isDismissed` in `src/renderer/components/home/dismissed-threads.ts`).
- The toast that confirms a dismissal offers **Undo**. Starting that ticket or branch from Start work also restores the row (`restoreStarted` in `start-work.ts`). So work that the operator just launched is never hidden.
- The `updatedAt` of a facet is when the work last changed, not when the extension read it. The git extension takes the value from `PullRequest.updatedAt` of GitHub.

## Consequences

- A dismissed row stays hidden even when its checks fail. Asks raised for the row, such as a failed check, are separate items on the Desk.
- The app stores dismissals in the `localStorage` of the renderer (`terminator.home.dismissed-threads`), one set per app profile. It forgets a dismissal 30 days after the work itself is gone.
- "Last" on a pull request row is now the own last update of the pull request.
