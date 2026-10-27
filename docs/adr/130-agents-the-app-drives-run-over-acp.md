# ADR 130: Agents the app drives run over ACP

**Status**: Accepted

**Date**: 2026-10-26

Amends ADR 026 (supervised runs happen in a terminal, behind a hook control server) and ADR 007 (agent runner as a child subprocess).

## Context

The app reached Claude Code in 21 places, through typed `claude …` lines, hooks written into `~/.claude/settings.json`, Claude's transcript JSONL, and the TUI's screen. Each is specific to one agent and fails without an error when Claude Code changes. The Agent Client Protocol (ACP, https://agentclientprotocol.com) is JSON-RPC over stdio between a client and an agent process. `@agentclientprotocol/claude-agent-acp` runs Claude Code as an ACP agent.

A spike drove the adapter (0.89.1, SDK 1.8.0) against claude 2.1.310 in a temporary git repository. Results:

| Question                                                                                          | Result                                                                                             |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Does it run on a claude.ai subscription login?                                                    | Yes. No `ANTHROPIC_API_KEY` was set.                                                               |
| In `default` mode, which tools ask?                                                               | Write, Edit and `echo x > b.txt` asked. Read and `ls` did not.                                     |
| Which mode does a new session start in?                                                           | The user's `permissions.defaultMode` (`auto` here). The client must set the mode.                  |
| Does a `PreToolUse` hook in a `settings` file passed as `_meta.claudeCode.options.settings` fire? | Yes, for all five tools, Read included.                                                            |
| Does `session/load` restore a conversation after the agent process is killed?                     | Yes, in 640 ms, with history replayed.                                                             |
| Is cost reported?                                                                                 | Yes: `usage_update.cost` in USD and the model in `_meta`.                                          |
| Do reject and cancel work?                                                                        | Reject: the file is not written and the agent says so. Cancel: `stopReason: cancelled`.            |
| Does it use client terminals (`terminal: true`)?                                                  | No. Commands run inside Claude Code.                                                               |
| Can it use the user's own `claude`?                                                               | Yes, with `CLAUDE_CODE_EXECUTABLE` in its environment; it overwrites `pathToClaudeCodeExecutable`. |
| Does a permission ask carry the Claude tool name?                                                 | No. It carries `kind` and `rawInput`.                                                              |

## Decision

1. **The core owns one ACP client** (`src/main/agents/acp/`), exposed to extensions as `api.agents` (Extension SDK 5.2.0) and to the renderer over `agents:*` channels.
2. **An agent is a setting.** `claude` runs the bundled adapter with the user's own `claude` binary. Other ACP agents are added as commands in the `agents` setting.
3. **An ACP session shows in a tab** (`surface: 'agent'`): its messages, tool calls and permission asks, and a prompt box. This keeps ADR 026's rule: no agent the operator cannot see or talk to.
4. **Foundry has no PreToolUse hook.** It sets the agent's permission mode per role: `auto` for a role that may write anywhere in its checkout (at `standard` or `lights-out`, with `letAutoModeDecide` on), `default` for every other role. In `default` mode Claude raises an ACP permission ask for every write and every state-changing command, so Foundry's policy decides each of them. The core gives each ask the `toolCallId` and the `_meta` of its tool call (Claude's `toolName` is there), and tells a client when an ask is settled (`onPermissionSettled`). The control server, the hook script, the settings file and the keystroke control are deleted.
5. **A held ask stays in the agent's tab.** Foundry holds an ask it cannot decide for a person. After five minutes, or when the operator hands it back, Foundry drops it from its held list and leaves the ask open in the session's tab. An ask answered in the tab clears Foundry's held entry.
6. **The `claude` TUI stays** as a choice for sessions a person starts.

## Alternatives considered

- **Keep the terminal and hooks only.** Claude-only, and the side channels keep failing without an error.
- **Drop the TUI and convert everything.** Too much new UI before any value; deferred.
- **The Claude Agent SDK directly.** Claude-only.
- **Keep the PreToolUse hook.** It saw every call, reads included, and could give a reason. It needed a settings file, a loopback server and a hook script for one agent, and it was the last side channel into Claude Code.

## Consequences

- Foundry still reads Claude's transcript, because the adapter still writes it. Foundry stays Claude-only.
- An ACP reject option carries no text, so a refusal also cancels the turn and sends Foundry's reason, or the operator's typed answer, as the agent's next prompt. The turn ends once, after the agent has read why.
- Foundry's hard refusals (`git push`, `gh pr` changes, edits under the skills mount, tools a role does not use) are passed as Claude deny rules (`disallowedTools`, `runtime/deny-rules.ts`). Deny rules are checked before any mode, so they hold in `auto` mode too (https://code.claude.com/docs/en/permissions).
- Inside an ask there is no auto mode to defer to, so the policy's old "leave it to auto mode" answer is gone: what it leaves open is asked, or refused with the reason at `lights-out`.
- In `auto` mode Foundry sees only what Claude's classifier asks about, not every tool call. In `default` mode reads do not ask, so Foundry no longer sees them either.
- The app ships the adapter but not its 241 MB Claude binary; `claude` must be installed, as before.
- The adapter releases often (18 releases in 30 days). It is pinned and updated through the 14-day cooldown.
