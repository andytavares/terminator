# ADR 144: A scheduled run needs nobody

**Status**: Accepted

**Date**: 2026-11-06

## Context

A scheduled run starts Claude in a tab while the operator is away. Claude then stopped at its first permission prompt or clarifying question, and the run waited until someone came back. A scheduled run must finish with no input. Only a destructive command may wait for the operator. The run must also be able to alert the operator, on Home or as a notification, when its prompt asks for that.

## Decision

At startup, `src/main/home/unattended-run.ts` writes two files into `<userData>/scheduled-runs/`. The `schedules:run` event carries their paths and the prompt text (`DueSchedule.unattended`).

- `settings.json` sets `permissions.defaultMode` to `auto`. Auto mode runs routine calls with no prompt, and its classifier blocks risky ones. It also holds `ask` rules for destructive commands and a `deny` rule for `AskUserQuestion`. Explicit ask rules still prompt in auto mode ([permission modes](https://code.claude.com/docs/en/permission-modes#eliminate-prompts-with-auto-mode)), so a destructive command still asks. (Until 2026-11-07 this was a `PreToolUse` hook that allowed every call; the operator asked for auto mode.)
- `system-prompt.md` tells Claude that nobody is watching, and to alert through the `alert` tool of the `terminator` MCP server (`mcp__terminator__alert`).
- Claude in a terminal starts as `claude --settings <file> --append-system-prompt-file <file> '<prompt>'`. An agent tab sends the same settings path and prompt text as `session/new` `_meta` (`claudeCode.options.settings`, `systemPrompt.append`).
- The agent calls `mcp__terminator__alert` (`src/main/mcp/alert-tool.ts`, ADR 145). Terminator shows the alert as a Home ask with **Dismiss**, and sends a `claudeAlert` notification. The ask rules also hold every destructive Terminator MCP tool, so those still ask in auto mode.

## Alternatives

- **`bypassPermissions` mode with ask rules.** Ask rules still prompt in it, but the interactive CLI shows a one-time warning dialog before the mode starts. That dialog is the input this decision removes. Skipping it needs `skipDangerousModePermissionPrompt` in the operator's own settings.
- **`acceptEdits` mode with allow rules.** An allow rule cannot match every MCP tool (`mcp__*` is ignored as an allow rule), so MCP calls still prompt.
- **A `PreToolUse` hook that allows every call, with the same ask rules.** This was the first decision. It approved everything the ask rules missed, with no check at all. Auto mode keeps the ask rules and adds a classifier, and the operator asked for it.
- **A file drop into `scheduled-runs/alerts/`.** This was the first mechanism. It reached only runs that Terminator started. The Terminator MCP server (ADR 145) reaches every Claude Code session, so the folder was removed.

## Consequences

- A scheduled run never takes the screen. Its tab opens in the background, and **Home → Scheduled** shows **Running** or **Needs you** with **View** while its session is open.

- An ACP agent other than Claude ignores the Claude settings, and keeps its own permission rules.
- A run-as an extension registers (for example Foundry) is not changed.
- Home alerts live in memory. They are gone after the app quits; a notification is not.
- The two flags and their paths count against the 1,024-byte typed line, so a scheduled prompt for Claude in a terminal must be shorter than a typed one.
