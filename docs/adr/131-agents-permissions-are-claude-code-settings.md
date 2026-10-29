# ADR 131: Agents' permissions are Claude Code settings

**Status**: Accepted

**Date**: 2026-10-27

Supersedes ADR 049 (an accidental question costs five minutes) and ADR 077 (auto mode answers what the policy abstains on). Amends ADR 130.

## Context

Foundry decided every tool call an agent raised with its own shell reader (`shell-split.ts`, `read-only-policy.ts`, `autonomy-policy.ts`, 1,465 lines with `tool-decision.ts`). It refused by cancelling the agent's turn and sending the reason as a new prompt, and it held any call it did not decide for five minutes.

On order WO-1027-55c the architect wrote its plan in 56 seconds, then checked its own JSON with `python3 -m json.tool`. The policy refused, the turn was cancelled, the follow-up prompt was lost, and both agents sat idle until the eight-minute stall check. Reading the policy with `npx tsx` also showed destructive commands it let through at `standard`: `(rm -rf src)`, `bash -c "rm -rf src"`, `git checkout -- .`, `mv src ~/gone`, and `sed -i` into source from a docs-only role.

Claude Code already applies permission rules to every subcommand, subshell, command substitution and control-flow body. It runs its built-in read-only commands without a prompt, and its `dontAsk` mode refuses any call no rule allows (https://code.claude.com/docs/en/permissions). A spike against `@agentclientprotocol/claude-agent-acp` 0.89.1 confirmed that `settings`, `settingSources`, `permissionMode`, `sandbox` and `outputFormat` passed in `_meta.claudeCode.options` reach the Agent SDK, and that the adapter's reject refuses without interrupting the turn.

## Decision

1. `runtime/role-settings.ts` builds each role's settings: a permission mode, `allow`, `ask` and `deny` rules, and a sandbox for roles that do not write freely. Read-only, docs-only and restricted-write roles run in `dontAsk`.
2. Agents start with `settingSources: ['project']`. They never load the operator's `~/.claude` CLAUDE.md, hooks or MCP connectors.
3. Foundry decides two things itself: the `Artifact` publish path, and refusing an open ask at `lights-out`. A refusal answers the ask with the reject option and never cancels the turn.
4. The shell splitter, the read-only and autonomy policies, the five-minute hold and the question path are deleted.
5. Writer roles get no sandbox. They run the repository's own tests, including Electron end-to-end tests, which the macOS sandbox can block.

## Consequences

- A policy refusal's reason no longer reaches the agent as text; the agent sees Claude Code's refusal. An operator's typed answer is still sent, as a prompt after the turn ends.
- With `letAutoModeDecide` off, a free writer runs in `acceptEdits`, so a state-changing shell command it runs is an ask for the operator.
- `tests/runtime/role-settings.spec.ts` holds the rules each role gets. A role's rules change there, with a test.

## Amendment, 2026-10-29

The Claude ACP adapter (`@agentclientprotocol/claude-agent-acp` 0.89.1 through 0.99.1) does not offer `dontAsk` as a session mode: `setSessionMode('dontAsk')` fails with "Mode dontAsk is not available in this session", so every read-only, docs-only and restricted-write role failed to start. These roles now run in `default`, and `runtime/tool-decision.ts` refuses every ask they raise (`refusesUnlistedCalls`), which keeps the decision above: what no rule allows is refused at once and nothing waits. `tests/unit/agents/acp/adapter-contract.spec.ts` checks every mode Foundry asks for against the installed adapter. ADR 135 records how a failed start now carries its reason.
