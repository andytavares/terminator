# ADR 130: Agents the app drives run over ACP

**Status**: Accepted

**Date**: 2026-10-26

Amends ADR 026 (supervised runs happen in a terminal, behind a hook control server) and ADR 007 (agent runner as a child subprocess).

## Context

The app reached Claude Code in 21 places, through typed `claude …` lines, hooks written into `~/.claude/settings.json`, Claude's transcript JSONL, and the TUI's screen. Each is specific to one agent and fails without an error when Claude Code changes. The Agent Client Protocol (ACP, https://agentclientprotocol.com) is JSON-RPC over stdio between a client and an agent process. `@agentclientprotocol/claude-agent-acp` runs Claude Code as an ACP agent.

A spike drove the adapter (0.89.1, SDK 1.8.0) against claude 2.1.310 in a temporary git repository. Results:

| Question                                                                                          | Result                                                                                  |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Does it run on a claude.ai subscription login?                                                    | Yes. No `ANTHROPIC_API_KEY` was set.                                                    |
| In `default` mode, which tools ask?                                                               | Write, Edit and `echo x > b.txt` asked. Read and `ls` did not.                          |
| Which mode does a new session start in?                                                           | The user's `permissions.defaultMode` (`auto` here). The client must set the mode.       |
| Does a `PreToolUse` hook in a `settings` file passed as `_meta.claudeCode.options.settings` fire? | Yes, for all five tools, Read included.                                                 |
| Does `session/load` restore a conversation after the agent process is killed?                     | Yes, in 640 ms, with history replayed.                                                  |
| Is cost reported?                                                                                 | Yes: `usage_update.cost` in USD and the model in `_meta`.                               |
| Do reject and cancel work?                                                                        | Reject: the file is not written and the agent says so. Cancel: `stopReason: cancelled`. |
| Does it use client terminals (`terminal: true`)?                                                  | No. Commands run inside Claude Code.                                                    |
| Can it use the user's own `claude`?                                                               | Yes, with `pathToClaudeCodeExecutable`.                                                 |
| Does a permission ask carry the Claude tool name?                                                 | No. It carries `kind` and `rawInput`.                                                   |

## Decision

1. **The core owns one ACP client** (`src/main/agents/acp/`), exposed to extensions as `api.agents` (Extension SDK 5.2.0) and to the renderer over `agents:*` channels.
2. **An agent is a setting.** `claude` runs the bundled adapter with the user's own `claude` binary. Other ACP agents are added as commands in the `agents` setting.
3. **An ACP session shows in a tab** (`surface: 'agent'`): its messages, tool calls and permission asks, and a prompt box. This keeps ADR 026's rule: no agent the operator cannot see or talk to.
4. **Foundry keeps its PreToolUse hook for the Claude agent.** ACP's permission request cannot say "let the agent's own classifier decide", cannot rewrite input, and is not sent for reads. Foundry passes its settings file through `_meta.claudeCode.options.settings`, so its policy still sees every tool call. The terminal, the launch script and the keystroke control go away.
5. **A held call has no terminal to go back to.** When the hook hands a call back, Claude Code asks over ACP, and the ask shows in the session's tab and in Foundry's pending list.
6. **The `claude` TUI stays** as a choice for sessions a person starts.

## Alternatives considered

- **Keep the terminal and hooks only.** Claude-only, and the side channels keep failing without an error.
- **Drop the TUI and convert everything.** Too much new UI before any value; deferred.
- **The Claude Agent SDK directly.** Claude-only.
- **Answer every tool through ACP permission asks alone.** Reads never ask, and "defer to auto mode" cannot be expressed, so Foundry's ladder would see less than it does now.

## Consequences

- Foundry still reads Claude's transcript, because the adapter still writes it. Foundry stays Claude-only.
- The app ships the adapter but not its 241 MB Claude binary; `claude` must be installed, as before.
- The adapter releases often (18 releases in 30 days). It is pinned and updated through the 14-day cooldown.
