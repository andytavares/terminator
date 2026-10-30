# ADR 077: Auto mode answers what Foundry's policy abstains on

**Status**: Superseded by ADR 131

**Date**: 2026-09-28

Builds on ADR 049 (an accidental question costs five minutes).

Amended by ADR 130: there is no hook any more. Auto mode is the permission mode of roles that may write anywhere in their checkout. Inside an ask, a person holds an abstention.

## Context

Foundry launches every agent with `--permission-mode auto`, but auto mode never
decided anything. Every tool call goes through the `PreToolUse` hook of Foundry
first. When `decideTool` abstained on a call, the call was held for the
operator for `DEFAULT_ASK_AFTER_MS` (five minutes). The hook then answered
`ask`. Claude Code puts up a confirmation for `ask` whatever the permission
mode.

Verified with claude 2.1.284, `claude -p` and `--permission-mode auto`, asking
the agent to run `touch marker.txt`:

| `PreToolUse` hook answer    | Result                                                               |
| --------------------------- | -------------------------------------------------------------------- |
| none (exit 0, empty stdout) | the command ran                                                      |
| `permissionDecision: "ask"` | refused: "Hook PreToolUse:Bash asked for confirmation for this tool" |
| no hook                     | the command ran                                                      |

## Decision

- `ToolRequest.letModeDecide` is fed from the setting
  `terminator.foundry.letAutoModeDecide` (default on). It makes `decideTool`
  return `mode` where it would have returned `null`.
- There are two exceptions. One is a destructive action (held as before,
  refused at `lights-out`). The other is the `escorted` setting, whose meaning
  is "ask me".
- The bridge answers `defer` without raising a request. The hook script prints
  nothing for `defer`, so the permission mode of Claude Code decides.
- The read-only roles and the architect are unchanged. Their policy never
  abstains.

## Consequences

- At `standard`, the auto mode classifier decides a write outside the
  worktree. It used to cost five minutes and a terminal prompt.
- At `lights-out`, the same calls go to auto mode instead of being refused.
- Turning the setting off restores the hold.

## Addendum: destructive actions go to auto mode too

The destructive exception is removed. On TAV-15 the builder waited on the
operator five times. Every wait was a destructive call inside its own checkout:
`git reset -q` after a coverage check, and `rm -rf node_modules/electron/dist`
four times while repairing an Electron install. Auto mode is meant to behave
exactly as it does in any Claude Code session, and its classifier already
judges destructive actions.

- With `letAutoModeDecide` on, `decideTool` returns `mode` for a destructive
  call at `standard` and `lights-out`. At `lights-out` the call is no longer
  refused.
- `escorted` still holds everything. Turning the setting off restores the hold
  for destructive calls and the `lights-out` refusal.
