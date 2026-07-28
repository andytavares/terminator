# ADR-028: The agent runs in a terminal, not in this process

Status: accepted
Date: 2026-07-27
Supersedes the runtime half of [ADR-027](027-agent-runtime-seam.md); the seam itself survives.

## Context

ADR-027 put the agent behind one module and drove it with the Agent SDK, in the
Electron main process. Everything the console knew came back through
`canUseTool` and the SDK's `result` messages. There was no terminal anywhere.

That worked as an architecture and failed as a product. The operator's account
of it, after using it:

> the way i envisioned this working was that starting a session in the needs you
> section would create a project in a workspace under a new worktree which where
> the session would run in claude code and i could use our new tooling to monitor
> it or jump in to the terminal session directly and start doing things there as
> well. I envisioned this more like a tool that wrapped claude code than what you
> built.

The concrete failures underneath that:

- **Nothing to look at.** A session could run for half an hour and the console
  could show a state and a turn count and nothing else. There was no way to see
  what the agent was actually doing, and no way to say anything to it beyond a
  reply box.
- **No way in.** Taking over meant opening a _second_ shell and running
  `claude --resume`, which is a different conversation beside the one you were
  watching rather than the one you were watching.
- **A correlation bug that made all of it worse.** The SDK chose the session id
  and announced it after the fact, so every hook event and every result arrived
  keyed to an id the console had never registered, and was silently discarded.

## Decision

Start the agent by typing `claude` into a real terminal, in a real project, in
the operator's workspace, on the session's own worktree.

- **Session identity is ours.** `claude --session-id <uuid>` takes an id the
  console mints, so the transcript path is known before the process exists and
  no correlation is needed. This deletes the class of bug above outright.
- **Permissions arrive through a `PreToolUse` hook.** The hook is a command, and
  the tool call waits for it to exit. It posts to a loopback HTTP server in the
  main process, which withholds the response until the operator answers. One
  open connection is one blocked tool call. This is the only mechanism that can
  hold a tool call still for a human — the `Notification` hook still does not
  fire for permission prompts.
- **`Stop` and `SessionEnd` hooks report the lifecycle**, so a session that has
  finished is distinguishable from one that is stuck. Without that signal the
  stall detector would call every completed session a stall eight minutes later.
- **Tool activity still comes from the transcript**, unchanged, which is what
  keeps state current when the console restarts.
- **The seam stays.** `SessionDriver` in `driver-contract.ts` is what the rest
  of the console depends on. Replacing the entire runtime — in-process SDK to a
  process in a terminal — changed the driver and the composition point and did
  not touch the state machine, the stall detector, the review queue, or any
  surface. That is the property ADR-027 was written to buy, and this change is
  the receipt that it paid.

The `@anthropic-ai/claude-agent-sdk` dependency is removed.

## The hook contract, as verified

Established by running claude 2.1.220, not by reading the reference. The
published examples differ from the binary in two ways, and **both fail
silently** — the tool proceeds exactly as though no hook had run:

|                                             |                                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `hookEventName` inside `hookSpecificOutput` | **required**; without it the whole decision is ignored, so `allow` does not approve and `deny` does not block                                   |
| words back to the agent                     | `permissionDecisionReason`, inside `hookSpecificOutput`. A `systemMessage` beside it is dropped                                                 |
| channel                                     | stdout, exit 0. The stderr-and-exit-2 form also blocks, but cannot express `allow` or carry `updatedInput`                                      |
| `updatedInput`                              | honoured — the agent proceeds with the edited input                                                                                             |
| hook timeout                                | configurable well beyond the 60s default; 43200 accepted. On expiry the runtime falls back to **its own prompt**, not to a decision nobody made |

That last row is what makes the design safe. Every failure — console closed,
token wrong, timeout, unparseable answer — degrades to `ask`, which is Claude
Code's own prompt in the terminal the operator is already looking at. Nothing is
approved behind their back and nothing is blocked forever.

## Consequences

**Gained.** The agent is visible and typeable-into. Taking over is clicking the
tab, not resuming a copy. The worktree is a first-class project in the sidebar.
Session identity is ours. A hook failure degrades to a prompt a human can see.

**Lost, and stated rather than papered over.**

- **Cost and context window are no longer reported.** They came from the SDK's
  `result` message; a terminal produces no such message and the transcript
  carries neither. Turn count is still counted from the transcript. The surfaces
  show nothing rather than a confident `$0.00` that means "not measured".
- **The console drives the agent by typing at it.** Interrupt is `ESC`; stop is
  `ESC`, the reason, then `/exit`. This is what a person would do, and it is
  less precise than an API call.
- **A second dependency on the CLI's interface.** The command line and the hook
  schema are now upgrade surface. Both live behind the seam, and
  `runtime-upgrade.spec.ts` fails if either leaks out of it.

## Upgrade procedure

Unchanged in shape from ADR-027, retargeted at the CLI. Pin a claude version,
run the supervision suite, upgrade, re-run. The hook-script tests execute the
script the way Claude Code does — real stdin, real process, real server — so a
schema change surfaces there rather than as agents that silently stop asking
permission.

Verified against: claude 2.1.220.
