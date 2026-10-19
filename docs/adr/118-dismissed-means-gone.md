# ADR 118: Dismissed means gone

**Status**: Accepted

**Date**: 2026-10-19

**Relates to**: [ADR 117](117-extensions-send-home-data-core-draws-it.md)

## Context

Dismissing an In flight row on Home hid it only until the work showed new activity. The git extension stamped every open pull request facet with the time of its fetch, which runs every two minutes, so every dismissed pull request row came back within two minutes. The operator's rule is that a dismissed row stays gone.

## Decision

- A dismissal is kept by work key and hides the row until the operator undoes it. Activity on the work does not bring it back (`isDismissed` in `src/renderer/components/home/dismissed-threads.ts`).
- The toast that confirms a dismissal offers **Undo**. Starting that ticket or branch from Start work also restores it (`restoreStarted` in `start-work.ts`), so work the operator just launched is never hidden.
- A facet's `updatedAt` is when the work last changed, not when it was read. The git extension takes it from GitHub's `PullRequest.updatedAt`.

## Consequences

- A dismissed row stays hidden even when its checks fail. Asks raised for it, such as a failed check, are separate items on the Desk.
- Dismissals are stored in the renderer's `localStorage` (`terminator.home.dismissed-threads`), one set per app profile, and are forgotten 30 days after the work itself is gone.
- "Last" on a pull request row is now the pull request's own last update.
