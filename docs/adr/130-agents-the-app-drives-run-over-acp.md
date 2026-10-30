# ADR 130: Agents the app drives run over ACP

**Status**: Accepted

**Date**: 2026-10-26

Amends ADR 026 (supervised runs happen in a terminal, behind a hook control server) and ADR 007 (agent runner as a child subprocess).

## Context

The app reached Claude Code in 21 places: typed `claude …` lines, hooks written into `~/.claude/settings.json`, the transcript JSONL of Claude, and the screen of the TUI. Each place is specific to one agent. Each fails without an error when Claude Code changes. The Agent Client Protocol (ACP, https://agentclientprotocol.com) is JSON-RPC over stdio between a client and an agent process. `@agentclientprotocol/claude-agent-acp` runs Claude Code as an ACP agent.

A spike drove the adapter (0.89.1, SDK 1.8.0) against claude 2.1.310 in a temporary git repository. The results:

| Question                                                                                          | Result                                                                                             |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Does it run on a claude.ai subscription login?                                                    | Yes. No `ANTHROPIC_API_KEY` was set.                                                               |
| In `default` mode, which tools ask?                                                               | Write, Edit and `echo x > b.txt` asked. Read and `ls` did not.                                     |
| Which mode does a new session start in?                                                           | The `permissions.defaultMode` of the user (`auto` here). The client must set the mode.             |
| Does a `PreToolUse` hook in a `settings` file passed as `_meta.claudeCode.options.settings` fire? | Yes, for all five tools, Read included.                                                            |
| Does `session/load` restore a conversation after the agent process is killed?                     | Yes, in 640 ms, with history replayed.                                                             |
| Is cost reported?                                                                                 | Yes: `usage_update.cost` in USD and the model in `_meta`.                                          |
| Do reject and cancel work?                                                                        | Reject: the file is not written, and the agent says so. Cancel: `stopReason: cancelled`.           |
| Does it use client terminals (`terminal: true`)?                                                  | No. Commands run inside Claude Code.                                                               |
| Can it use the user's own `claude`?                                                               | Yes, with `CLAUDE_CODE_EXECUTABLE` in its environment. It overwrites `pathToClaudeCodeExecutable`. |
| Does a permission ask carry the Claude tool name?                                                 | No. It carries `kind` and `rawInput`.                                                              |

## Decision

1. **The core owns one ACP client** (`src/main/agents/acp/`). It exposes the client to extensions as `api.agents` (Extension SDK 5.2.0) and to the renderer over `agents:*` channels.
2. **An agent is a setting.** `claude` runs the bundled adapter with the own `claude` binary of the user. You add other ACP agents as commands in the `agents` setting.
3. **An ACP session shows in a tab** (`surface: 'agent'`). The tab shows its messages, tool calls and permission asks, and a prompt box. This keeps the rule of ADR 026: no agent that the operator cannot see or talk to.
4. **Foundry has no PreToolUse hook.** It sets the permission mode of the agent per role: `auto` for a role that can write anywhere in its checkout (at `standard` or `lights-out`, with `letAutoModeDecide` on), and `default` for every other role. In `default` mode, Claude raises an ACP permission ask for every write and every state-changing command, so the policy of Foundry decides each of them. The core gives each ask the `toolCallId` and the `_meta` of its tool call (the `toolName` of Claude is there). It tells a client when an ask is settled (`onPermissionSettled`). The control server, the hook script, the settings file and the keystroke control are deleted.
5. **A held ask stays in the tab of the agent.** Foundry holds an ask that it cannot decide for a person. After five minutes, or when the operator hands the ask back, Foundry drops it from its held list and leaves the ask open in the tab of the session. An ask answered in the tab clears the held entry of Foundry.
6. **The `claude` TUI stays** as a choice for sessions that a person starts.

## Alternatives considered

- **Keep the terminal and hooks only.** This works for Claude only, and the side channels keep failing without an error.
- **Drop the TUI and convert everything.** This needs too much new UI before any value. The team deferred it.
- **The Claude Agent SDK directly.** This works for Claude only.
- **Keep the PreToolUse hook.** It saw every call, reads included, and could give a reason. It needed a settings file, a loopback server and a hook script for one agent. It was the last side channel into Claude Code.

## Consequences

- Foundry still reads the transcript of Claude, because the adapter still writes it. Foundry stays Claude-only.
- An ACP reject option carries no text. So a refusal also cancels the turn and sends the reason of Foundry, or the typed answer of the operator, as the next prompt of the agent. The turn ends once, after the agent has read why.
- The cancel of the Claude adapter also drops a prompt that reaches it before the cancelled turn has ended. So the reason was lost, and the run waited for ever (WO-1027-eea). The service sends a prompt only after the cancelled turn ends. It sends no cancel when no prompt runs. It sends a prompt once more when an earlier cancel still dropped it.
- A prompt that fails shows "The agent stopped with an error" in its tab, and ends a Foundry run as failed. So nothing waits for a turn that cannot end.
- Foundry passes its hard refusals (`git push`, `gh pr` changes, edits under the skills mount, tools that a role does not use) as Claude deny rules (`disallowedTools`, `runtime/deny-rules.ts`). Claude checks deny rules before any mode, so they hold in `auto` mode too (https://code.claude.com/docs/en/permissions).
- Inside an ask there is no auto mode to defer to. So the old answer of the policy, "leave it to auto mode", is gone. What the policy leaves open is asked, or refused with the reason at `lights-out`.
- In `auto` mode, Foundry sees only what the classifier of Claude asks about, not every tool call. In `default` mode, reads do not ask, so Foundry no longer sees them either.
- The app ships the adapter but not its 241 MB Claude binary. `claude` must be installed, as before.
- The adapter releases often (18 releases in 30 days). The repository pins it and updates it through the 14-day cooldown.
