# ADR 131: Agents' permissions are Claude Code settings

**Status**: Accepted

**Date**: 2026-10-27

Supersedes ADR 049 (an accidental question costs five minutes) and ADR 077 (auto mode answers what the policy abstains on). Amends ADR 130.

## Context

Foundry decided every tool call that an agent raised, with its own shell reader (`shell-split.ts`, `read-only-policy.ts`, `autonomy-policy.ts`, 1,465 lines with `tool-decision.ts`). It refused by cancelling the turn of the agent and sending the reason as a new prompt. It held any call that it did not decide for five minutes.

On order WO-1027-55c, the architect wrote its plan in 56 seconds, then checked its own JSON with `python3 -m json.tool`. The policy refused, the turn was cancelled, and the follow-up prompt was lost. Both agents sat idle until the eight-minute stall check. Reading the policy with `npx tsx` also showed destructive commands that it let through at `standard`: `(rm -rf src)`, `bash -c "rm -rf src"`, `git checkout -- .`, `mv src ~/gone`, and `sed -i` into source from a docs-only role.

Claude Code already applies permission rules to every subcommand, subshell, command substitution and control-flow body. It runs its built-in read-only commands without a prompt. Its `dontAsk` mode refuses any call that no rule allows (https://code.claude.com/docs/en/permissions). A spike against `@agentclientprotocol/claude-agent-acp` 0.89.1 confirmed two facts. First, `settings`, `settingSources`, `permissionMode`, `sandbox` and `outputFormat`, passed in `_meta.claudeCode.options`, reach the Agent SDK. Second, the reject of the adapter refuses without an interruption of the turn.

## Decision

1. `runtime/role-settings.ts` builds the settings of each role: a permission mode, `allow`, `ask` and `deny` rules, and a sandbox for roles that do not write freely. Read-only, docs-only and restricted-write roles run in `dontAsk`.
2. Agents start with `settingSources: ['project']`. They never load the `~/.claude` CLAUDE.md, hooks or MCP connectors of the operator.
3. Foundry decides two things itself: the `Artifact` publish path, and the refusal of an open ask at `lights-out`. A refusal answers the ask with the reject option and never cancels the turn.
4. The shell splitter, the read-only and autonomy policies, the five-minute hold and the question path are deleted.
5. Writer roles get no sandbox. They run the own tests of the repository, including Electron end-to-end tests, which the macOS sandbox can block.

## Consequences

- The reason for a policy refusal no longer reaches the agent as text. The agent sees the refusal of Claude Code. The typed answer of an operator is still sent, as a prompt after the turn ends.
- With `letAutoModeDecide` off, a free writer runs in `acceptEdits`. So a state-changing shell command that it runs is an ask for the operator.
- `tests/runtime/role-settings.spec.ts` holds the rules that each role gets. Change the rules of a role there, with a test.

## Amendment, 2026-10-29

The Claude ACP adapter (`@agentclientprotocol/claude-agent-acp` 0.89.1 through 0.99.1) does not offer `dontAsk` as a session mode. `setSessionMode('dontAsk')` fails with "Mode dontAsk is not available in this session", so every read-only, docs-only and restricted-write role failed to start. These roles now run in `default`. `runtime/tool-decision.ts` refuses every ask that they raise (`refusesUnlistedCalls`). This keeps the decision above: what no rule allows is refused at once, and nothing waits. `tests/unit/agents/acp/adapter-contract.spec.ts` checks every mode that Foundry asks for against the installed adapter. ADR 135 records how a failed start now carries its reason.
