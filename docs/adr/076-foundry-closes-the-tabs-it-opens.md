# ADR 076: Foundry closes the terminal tabs it opens

**Status**: Accepted

**Date**: 2026-09-28

Builds on ADR 026 (supervised runs in a terminal) and ADR 059 (checks run in a
terminal tab of their own).

## Context

Every Foundry agent turn and every check opened a tab, and none was ever
closed. An agent sat at its prompt after its turn ended, because only a later
node resuming its conversation ended it. After `/exit` the launch script
returned to an interactive shell, so the tab stayed with a live shell in it. A
check's tab stayed open, exited, by design. Every agent tab was titled with the
branch name, so a project held a row of identical tabs.

The Extension API could not remove a tab: `pty.kill` ends the process, and the
renderer then marks the tab `[exited]` and keeps it.

## Decision

- Extension API v2.6.0 adds `pty.closeTerminalTab(sessionId)`. The main process
  broadcasts `terminal:close-tab`; the renderer closes the tab the way a person
  would (`closeSession`), which ends the process and marks the session record
  closed. With no window, it ends the process.
- `SupervisedRunner` closes an agent's tab when its conversation ends cleanly
  (`session_end`, or the terminal exiting 0), and a check's tab when the check
  passes. A failure keeps its tab.
- Foundry stops an agent once its turn's output is collected: the architect
  when its proposal is in, a red-team or scout round when its file is in, a Line
  node when its turn ends. Resuming a conversation later is unaffected;
  `claude --resume` reads the transcript, not the process.
- A tab is titled for its agent, from the role id (`red-team` is "Red team"),
  or for its check.

## Consequences

- One tab per lane at a time, plus any failure the operator has not closed.
- "Watch" on a finished node finds no terminal. The session record and
  transcript remain.

## Addendum: an installed host older than v2.6.0

Foundry loads from the checkout, but the host is whatever app is installed. On
an app built before `closeTerminalTab` existed, the call threw inside the exit
listener before the check's verdict resolved. A passing check never reported,
and the run stayed on lint indefinitely. `SupervisedRunner` now resolves the
verdict and releases the run first, and calls `closeTerminalTab?.()` last.
