# ADR-026: Supervised runs happen in a terminal, behind a hook control server

**Status**: Accepted
**Date**: 2026-07-29
**Supersedes in part**: [ADR-007](007-agent-runner-subprocess.md) (the headless spawn remains only for self-review)
**Amended by**: [ADR 130](130-agents-the-app-drives-run-over-acp.md) (the agent runs over ACP in an agent tab; the hook and the control server are gone)

## Context

A card's phase used to run as `claude --print --permission-mode bypassPermissions`
spawned as a hidden child process. That had two problems, and they
compounded:

- **The run was invisible.** It had no terminal, nothing to read, and nothing to type into.
  To take over, the operator had to resume the conversation somewhere else, by hand.
- **It approved every tool call on the operator's behalf, silently.** A card
  could rewrite anything in its worktree, and the operator first learned of it from the diff.

Separately, nobody instruments one failure mode: an agent that is stuck
_without asking for help_. A blocked agent at least announces itself. An agent that
loops over the same file, or waits on something that will never arrive,
looks exactly like one that is working.

## Decision

**A phase runs `claude` in a real terminal, in the card's own worktree project,
and every tool call goes through a `PreToolUse` hook that holds it until
somebody decides.**

Four pieces:

1. **A loopback control server** (`runtime/control-server.ts`) with a bearer
   token minted per run. `/pretooluse` blocks until answered. `/event` does not.
2. **A hook script** written to disk at startup and named in a per-session
   `--settings` file. It posts the tool call and prints the decision.
3. **A session id the console chooses** (`claude --session-id <uuid>`). The
   transcript path is therefore known before the process exists, and a hook callback needs
   no correlation.
4. **A terminal the operator can see**, via the v2.1.0 extension API:
   `workspace.createProject` for the worktree, `pty.openTerminalTab` for the tab.

The operator can type into that same terminal at any time without the runner
losing track, because the runner watches the transcript and the hooks, not the process.

### The verified hook contract

The published documentation is wrong in ways that fail **silently**. The team
established the following by running the binary (claude 2.1.220), not by reading:

| Behaviour                                                    | Consequence if you get it wrong                  |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `hookEventName` is **required** inside `hookSpecificOutput`  | the decision is ignored entirely — `deny` allows |
| Words back to the agent travel as `permissionDecisionReason` | `systemMessage` is dropped                       |
| stdout + exit 0 is the channel                               | stderr + exit 2 blocks but cannot say `allow`    |
| `updatedInput` is honoured                                   | —                                                |
| `ask` overrides `acceptEdits`                                | —                                                |
| On hook timeout the runtime falls back to **its own** prompt | a 12-hour hang if nothing answers                |

The hook timeout is 12 hours. The bridge hands a request **back to the
terminal after five minutes** and does not let it sit there. A supervised
phase with nothing able to answer it is a hang. The team shipped that once, and that is why
the hand-back exists.

### What is not supervised

`--allowedTools` / `--disallowedTools` cannot restrict writes: Bash writes.
The team verified this empirically. Self-review therefore keeps the headless spawn of
ADR-007 and a **command policy** confines it
(`runtime/read-only-policy.ts`). The load-bearing rule: the policy refuses a compound
command outright and does not parse it. A compound command is anything that contains `;`, `&`, `|`, `>`, `<`, a backtick or `$(`.

### Detecting a run that stopped

`runtime/evaluate-stall.ts` fires on tool silence, or on no net diff plus a
single-file loop. A long-running Bash call is exempt, or every test run reads as
a stall.

The team specified a third signal, repeated self-reverts, and did not implement it.
It needs a per-edit history of the working copy, and nothing records one. The team
removed it and did not leave a threshold that no input could cross.

The detector ships in **shadow mode**: the app records and shows firings, but does not notify. A
detector with a 20% false-positive rate produces alarm fatigue and gets turned
off, and then the real stalls go unreported too. Turn it off on the evidence of
a week of recorded firings, not on faith.

## Consequences

**Good.**

- The run is visible, readable and typeable-into, and it is in the sidebar.
- The app asks about tool calls, so the console enforces the autonomy ladder
  and does not trust the agent to do it.
- The stall detector is possible at all, because the transcript is a known path.

**Costs.**

- One loopback port per extension (not per run) and a hook script on disk.
- The hook contract is not a published API. A runtime upgrade can change it, and
  the failure mode is silent. The e2e test drives a real run through the real
  application specifically to catch that.
- The headless spawn still exists for self-review, so there are two run paths.
  A phase also lands on it if supervision cannot be arranged (no
  runtime, or a repository in no workspace). That path approves every tool call,
  so it raises a notification that names the card and does not proceed quietly.

## Alternatives considered

**The Agent SDK, driving sessions headlessly with `canUseTool`.** The team built it, then
removed it. It gives clean permission state and cost accounting, but the run has no
terminal. The operator asked for a terminal, and the whole console is about it. Rejected as the primary driver.

**Parsing PTY output for state.** Rejected outright. Omnara archived 2.6k stars
because wrapping the CLI "became unfeasible to maintain with Claude Code's
constant updates".

**The `Notification` hook for permission prompts.** It does not fire on them
(anthropics/claude-code#56936). `PreToolUse` is the only reliable channel.
