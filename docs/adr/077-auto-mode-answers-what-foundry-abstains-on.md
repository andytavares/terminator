# ADR 077: Auto mode answers what Foundry's policy abstains on

**Status**: Accepted

**Date**: 2026-09-28

Builds on ADR 049 (an accidental question costs five minutes).

## Context

Foundry launches every agent with `--permission-mode auto`, but auto mode never
decided anything. Every tool call goes through Foundry's `PreToolUse` hook
first. A call `decideTool` abstained on was held for the operator for
`DEFAULT_ASK_AFTER_MS` (five minutes). The hook then answered `ask`, and Claude
Code puts up a confirmation for `ask` whatever the permission mode.

Verified with claude 2.1.284, `claude -p` and `--permission-mode auto`, asking
the agent to run `touch marker.txt`:

| `PreToolUse` hook answer    | Result                                                               |
| --------------------------- | -------------------------------------------------------------------- |
| none (exit 0, empty stdout) | the command ran                                                      |
| `permissionDecision: "ask"` | refused: "Hook PreToolUse:Bash asked for confirmation for this tool" |
| no hook                     | the command ran                                                      |

## Decision

- `ToolRequest.letModeDecide`, fed from the setting
  `terminator.foundry.letAutoModeDecide` (default on), makes `decideTool`
  return `mode` where it would have returned `null`.
- The exceptions: a destructive action (held as before, refused at
  `lights-out`) and the `escorted` setting, whose meaning is "ask me".
- The bridge answers `defer` without raising a request. The hook script prints
  nothing for `defer`, so Claude Code's permission mode decides.
- The read-only roles and the architect are unchanged; their policy never
  abstains.

## Consequences

- At `standard`, a write outside the worktree, which used to cost five minutes
  and a terminal prompt, is decided by the auto mode classifier.
- At `lights-out`, the same calls go to auto mode instead of being refused.
- Turning the setting off restores the hold.
