# ADR 076: Foundry closes the terminal tabs it opens

**Status**: Accepted

**Date**: 2026-09-28

Builds on ADR 026 (supervised runs in a terminal) and ADR 059 (checks run in a
terminal tab of their own).

## Context

Every Foundry agent turn and every check opened a tab, and nothing closed it.
An agent sat at its prompt after its turn ended, because only a later node that
resumed its conversation ended it. After `/exit` the launch script returned to
an interactive shell, so the tab stayed with a live shell in it. The tab of a
check stayed open, exited, by design. Every agent tab was titled with the
branch name, so a project held a row of identical tabs.

The Extension API could not remove a tab. `pty.kill` ends the process. The
renderer then marks the tab `[exited]` and keeps it.

## Decision

- Extension API v2.6.0 adds `pty.closeTerminalTab(sessionId)`. The main process
  broadcasts `terminal:close-tab`. The renderer closes the tab the way a person
  would (`closeSession`), which ends the process and marks the session record
  closed. With no window, the call ends the process.
- `SupervisedRunner` closes the tab of an agent when its conversation ends
  cleanly (`session_end`, or the terminal exiting 0). It closes the tab of a
  check when the check passes. A failure keeps its tab.
- Foundry stops an agent once the output of its turn is collected. The
  architect stops when its proposal is in. A red-team or scout round stops when
  its file is in. A Line node stops when its turn ends. Resuming a conversation
  later is unaffected, because `claude --resume` reads the transcript, not the
  process.
- A tab is titled for its agent, from the role id (`red-team` is "Red team"),
  or for its check.

## Consequences

- One tab per lane at a time, plus any failure that the operator has not
  closed.
- "Watch" on a finished node finds no terminal. The session record and
  transcript remain.

## Addendum: an installed host older than v2.6.0

Foundry loads from the checkout, but the host is whatever app is installed. On
an app built before `closeTerminalTab` existed, the call threw inside the exit
listener before the verdict of the check resolved. A passing check never
reported, and the run stayed on lint indefinitely. `SupervisedRunner` now
resolves the verdict and releases the run first. It calls `closeTerminalTab?.()`
last.
