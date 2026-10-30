# ADR 063: A failed check sends the work back

**Status**: Accepted

**Date**: 2026-09-26

## Context

The Line could not correct itself. Three things stood between a failing check
and a builder fixing it:

- A recipe `run` step went to an agent session with the literal text "Run
  this exactly: `${toolchain.test}`". Nothing resolved the placeholder. An
  agent node's result is its turn ending, which is exit 0. So `quick`'s
  `check`, `bugfix`'s `flip` and `refactor`'s `baseline` and `unchanged` could
  never fail.
- A node that failed once blocked everything after it. The executor then
  raised `verify.repeat-fail` for the stalled graph with no `nodeId`. "Send
  back" on that gate retried `[]`.
- Nothing kept the output of a command, and a brief could not carry it. A retry
  would have been the same agent with the same information.

The Forge already corrects itself a bounded number of times before it asks
(ADR-062). The operator wants the Line to do the same. The Line stops only when
the agents have had their bounded tries.

## Decision

- A `run` step whose command is not a slash command runs as a command. It runs
  in a terminal tab in the lane's checkout (`SupervisedRunner.runCommand`),
  after `${toolchain.<check>}` is resolved (`resolveCommand`). A check for which
  this repository has no command is `skipped` and recorded as
  `step.not_measured`. It is never passed.
- The combined output of the command is tee'd to
  `<order>/runs/<node>.<attempt>.log`. The script keeps the exit status of the
  command through a status file, not `pipefail`, because the user's `$SHELL`
  runs it.
- A `run` step may declare `onFail: { rework: <upstream step>, max: 1..3 }`.
  While `reworks < max`, a failure calls `scheduler.rework`. The target step's
  node in the checked lane goes back to `waiting`. So do everything between it
  and the check, and the check itself. The `feedback` of the target gains the
  command, the exit status and the last 120 lines of the log. Ledger:
  `rework.started`. Past `max`, the ordinary failure path runs.
- The builder reads `feedback`. Its next brief says that the previous attempt
  failed, with the output.
- The stalled-graph gate names the failed node, so "Send back" retries it.
- Before a node resumes the conversation of a lane, the executor ends the
  previous process of that conversation (`endSession`, wired to `endAndWait`).
- `quick`, `direct`, `standard`, `bugfix` and `poc` run the repository's lint
  command in the lane, right after the build, when the probe found one. They
  send the build back once on failure. Existing test steps do the same.

## Alternatives

- **Keep run steps as agent turns and read the exit status out of the
  transcript.** Rejected. The verdict would come from what an agent printed,
  which is what FR-033 forbids.
- **Rework on the verifier's verdict.** Not possible yet. The turn of a
  verifier always ends with exit 0, and its role hands nothing back, so it
  cannot fail a node. The parser refuses `onFail` anywhere but a `run` step
  until it can.
- **A seventh step kind for retries.** Rejected. `onFail` is an attribute, as
  `when` is.
- **Rework every lane of a fan-out.** Rejected. A command step runs in the
  checkout of the lowest lane, so only the builder of that lane has seen the
  failure.

## Consequences

- Run steps cost a terminal tab, not an agent session. Orders that use them
  launch fewer agents.
- On a multi-lane order, a run step checks only the checkout of the lowest
  lane. That was already true of the verification ladder.
- `onFail` on a verifier waits for a verifier that can report a failing
  verdict.
