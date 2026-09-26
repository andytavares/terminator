# ADR 063: A failed check sends the work back

**Status**: Accepted

**Date**: 2026-09-26

## Context

The Line could not correct itself. Three things stood between a failing check
and a builder fixing it:

- A recipe `run` step went to an agent session with the literal text "Run
  this exactly: `${toolchain.test}`". Nothing resolved the placeholder, and an
  agent node's result is its turn ending, which is exit 0. So `quick`'s
  `check`, `bugfix`'s `flip` and `refactor`'s `baseline` and `unchanged` could
  never fail.
- A node that failed once blocked everything after it. The executor then
  raised `verify.repeat-fail` for the stalled graph with no `nodeId`, and
  "Send back" on that gate retried `[]`.
- Nothing kept a command's output, and a brief could not carry it, so a retry
  would have been the same agent with the same information.

The Forge already corrects itself a bounded number of times before asking
(ADR-062). The operator wants the Line to do the same: stop only when the
agents have had their bounded tries.

## Decision

- A `run` step whose command is not a slash command runs as a command, in a
  terminal tab in the lane's checkout (`SupervisedRunner.runCommand`), after
  `${toolchain.<check>}` is resolved (`resolveCommand`). A check this
  repository has no command for is `skipped` and recorded as
  `step.not_measured`, never passed.
- The command's combined output is tee'd to
  `<order>/runs/<node>.<attempt>.log`. The script keeps the command's exit
  status through a status file, not `pipefail`, because the user's `$SHELL`
  runs it.
- A `run` step may declare `onFail: { rework: <upstream step>, max: 1..3 }`.
  While `reworks < max`, a failure calls `scheduler.rework`: the target step's
  node in the checked lane, everything between it and the check, and the check
  go back to `waiting`, and the target's `feedback` gains the command, exit
  status and the last 120 lines of the log. Ledger: `rework.started`. Past
  `max`, the ordinary failure path runs.
- The builder reads `feedback`, so its next brief says the previous attempt
  failed, with the output.
- The stalled-graph gate names the failed node, so "Send back" retries it.
- Before a node resumes a lane's conversation, the executor ends that
  conversation's previous process (`endSession`, wired to `endAndWait`).
- `quick`, `direct`, `standard`, `bugfix` and `poc` run the repository's lint
  command in the lane, right after the build, when the probe found one, and
  send the build back once on failure. Existing test steps do the same.

## Alternatives

- **Keep run steps as agent turns and read the exit status out of the
  transcript.** Rejected: the verdict would come from what an agent printed,
  which is the thing FR-033 forbids.
- **Rework on the verifier's verdict.** Not possible yet: a verifier's turn
  always ends with exit 0 and its role hands nothing back, so it cannot fail a
  node. The parser refuses `onFail` anywhere but a `run` step until it can.
- **A seventh step kind for retries.** Rejected: `onFail` is an attribute, as
  `when` is.
- **Rework every lane of a fan-out.** Rejected: a command step runs in the
  lowest lane's checkout, so only that lane's builder has seen the failure.

## Consequences

- Run steps cost a terminal tab, not an agent session, so orders that use them
  launch fewer agents.
- A run step only checks the lowest lane's checkout on a multi-lane order. That
  was already true of the verification ladder.
- `onFail` on a verifier waits for a verifier that can report a failing
  verdict.
