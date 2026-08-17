# ADR-026: Supervised runs happen in a terminal, behind a hook control server

**Status**: Accepted
**Date**: 2026-07-29
**Supersedes in part**: [ADR-007](007-agent-runner-subprocess.md) (the headless spawn remains only for self-review)

## Context

A card's phase used to run as `claude --print --permission-mode bypassPermissions`
spawned as a hidden child process. Two things were wrong with that, and they
compounded:

- **The run was invisible.** No terminal, nothing to read, nothing to type into.
  Taking over meant resuming the conversation somewhere else, by hand.
- **It approved every tool call on the operator's behalf, silently.** A card
  could rewrite anything in its worktree and the first you knew was the diff.

Separately, the failure mode nobody instruments is an agent that is stuck
_without asking for help_. A blocked agent at least announces itself. One that
is looping over the same file, or waiting on something that will never arrive,
looks exactly like one that is working.

## Decision

**A phase runs `claude` in a real terminal, in the card's own worktree project,
and every tool call goes through a `PreToolUse` hook that holds it until
somebody decides.**

Four pieces:

1. **A loopback control server** (`runtime/control-server.ts`) with a bearer
   token minted per run. `/pretooluse` blocks until answered; `/event` does not.
2. **A hook script** written to disk at startup and named in a per-session
   `--settings` file. It posts the tool call and prints the decision.
3. **A session id the console chooses** (`claude --session-id <uuid>`), so the
   transcript path is known before the process exists and a hook callback needs
   no correlation.
4. **A terminal the operator can see**, via the v2.1.0 extension API —
   `workspace.createProject` for the worktree, `pty.openTerminalTab` for the tab.

The operator can type into that same terminal at any time without the runner
losing track, because what it watches is the transcript and the hooks rather
than the process.

### The verified hook contract

The published documentation is wrong in ways that fail **silently**. These were
established by running the binary (claude 2.1.220), not by reading:

| Behaviour                                                    | Consequence if you get it wrong                  |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `hookEventName` is **required** inside `hookSpecificOutput`  | the decision is ignored entirely — `deny` allows |
| Words back to the agent travel as `permissionDecisionReason` | `systemMessage` is dropped                       |
| stdout + exit 0 is the channel                               | stderr + exit 2 blocks but cannot say `allow`    |
| `updatedInput` is honoured                                   | —                                                |
| `ask` overrides `acceptEdits`                                | —                                                |
| On hook timeout the runtime falls back to **its own** prompt | a 12-hour hang if nothing answers                |

The hook timeout is 12 hours, and the bridge hands a request **back to the
terminal after five minutes** rather than letting it sit there. A supervised
phase with nothing able to answer it is a hang, and shipping that once is why
the hand-back exists.

### What is not supervised

`--allowedTools` / `--disallowedTools` cannot restrict writes: Bash writes.
Verified empirically. Self-review therefore keeps the headless spawn of
ADR-007 and is confined by a **command policy** instead
(`runtime/read-only-policy.ts`); the load-bearing rule is that a compound
command — anything containing `;`, `&`, `|`, `>`, `<`, a backtick or `$(` — is
refused outright rather than parsed.

### Detecting a run that stopped

`runtime/evaluate-stall.ts` fires on tool silence, or on no net diff plus a
single-file loop. A long-running Bash call is exempt or every test run reads as
a stall.

A third signal — repeated self-reverts — was specified and is not implemented:
it needs a per-edit history of the working copy and nothing records one. It was
removed rather than left as a threshold no input could cross.

It ships in **shadow mode**: firings are recorded and shown, not notified. A
detector with a 20% false-positive rate produces alarm fatigue and gets turned
off, and then the real stalls go unreported too. Turn it off on the evidence of
a week of recorded firings, not on faith.

## Consequences

**Good.**

- The run is visible, readable and typeable-into, and it is in the sidebar.
- Tool calls are asked about, so the autonomy ladder is enforced by the console
  rather than trusted to the agent.
- The stall detector is possible at all, because the transcript is a known path.

**Costs.**

- One loopback port per extension (not per run) and a hook script on disk.
- The hook contract is not a published API; a runtime upgrade can change it, and
  the failure mode is silent. The e2e test drives a real run through the real
  application specifically to catch that.
- The headless spawn still exists for self-review, so there are two run paths —
  and it is also where a phase lands if supervision cannot be arranged (no
  runtime, or a repository in no workspace). That path approves every tool call,
  so it raises a notification naming the card rather than proceeding quietly.

## Alternatives considered

**The Agent SDK, driving sessions headlessly with `canUseTool`.** Built, then
removed. It gives clean permission state and cost accounting, but the run has no
terminal — which is the thing the operator asked for and the thing the whole
console is about. Rejected as the primary driver.

**Parsing PTY output for state.** Rejected outright. Omnara archived 2.6k stars
because wrapping the CLI "became unfeasible to maintain with Claude Code's
constant updates".

**The `Notification` hook for permission prompts.** It does not fire on them
(anthropics/claude-code#56936). `PreToolUse` is the only reliable channel.
