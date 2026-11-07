# ADR 144: A scheduled run needs nobody

**Status**: Accepted

**Date**: 2026-11-06

## Context

A scheduled run starts Claude in a tab while the operator is away. Claude then stopped at its first permission prompt or clarifying question, and the run waited until someone came back. A scheduled run must finish with no input. Only a destructive command may wait for the operator. The run must also be able to alert the operator, on Home or as a notification, when its prompt asks for that.

## Decision

At startup, `src/main/home/unattended-run.ts` writes two files into `<userData>/scheduled-runs/`. The `schedules:run` event carries their paths and the prompt text (`DueSchedule.unattended`).

- `settings.json` holds a `PreToolUse` hook that prints `permissionDecision: "allow"` for every tool. It also holds `ask` rules for destructive commands and a `deny` rule for `AskUserQuestion`. Deny and ask rules win over a hook's allow ([permissions](https://code.claude.com/docs/en/permissions#precedence-among-rules-hooks-and-mods)), so a destructive command still prompts.
- `system-prompt.md` tells Claude that nobody is watching, and where to write an alert.
- Claude in a terminal starts as `claude --settings <file> --append-system-prompt-file <file> '<prompt>'`. An agent tab sends the same settings path and prompt text as `session/new` `_meta` (`claudeCode.options.settings`, `systemPrompt.append`).
- The agent writes an alert as a JSON file into `scheduled-runs/alerts/`. `src/main/home/scheduled-alerts.ts` watches the folder. It shows each alert as a Home ask with **Dismiss**, and sends a `scheduledRunAlert` notification.

## Alternatives

- **`bypassPermissions` mode with ask rules.** Ask rules still prompt in it, but the interactive CLI shows a one-time warning dialog before the mode starts. That dialog is the input this decision removes. Skipping it needs `skipDangerousModePermissionPrompt` in the operator's own settings.
- **`acceptEdits` mode with allow rules.** An allow rule cannot match every MCP tool (`mcp__*` is ignored as an allow rule), so MCP calls still prompt.
- **`auto` mode.** Its classifier blocks some actions instead of asking, and decides which ones. The operator asked for a fixed rule: only destructive commands ask.
- **A local server or MCP server for alerts.** The app runs no server an agent can reach (`src/main/agents/claude-hook.ts`). A file drop is the mechanism the Claude hook already uses.

## Consequences

- An ACP agent other than Claude ignores the Claude settings, and keeps its own permission rules.
- A run-as an extension registers (for example Foundry) is not changed.
- Home alerts live in memory. They are gone after the app quits; a notification is not.
- The two flags and their paths count against the 1,024-byte typed line, so a scheduled prompt for Claude in a terminal must be shorter than a typed one.
