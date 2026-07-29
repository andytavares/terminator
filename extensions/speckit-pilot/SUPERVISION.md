# Supervision

What the pilot knows about a running agent, where it comes from, and what you
can do about it.

The premise: you cap out at two to six concurrent agents because **review** is
the bottleneck, and the failure nobody instruments is an agent that is stuck
_without asking for help_. Everything below exists for one of those two facts.

Architecture and the verified hook contract:
[ADR-026](../../docs/adr/026-supervised-runs-in-a-terminal.md).

## The surfaces

The **supervision panel** sits above the board (`components/SupervisionPanel.tsx`)
in four sections:

| Section    | Reads                                      | Answers                                |
| ---------- | ------------------------------------------ | -------------------------------------- |
| **runs**   | `speckit:supervision-snapshot`             | what is running, and how it is going   |
| **stalls** | `speckit:stalls-list`                      | what stopped making progress           |
| **review** | `speckit:supervision-snapshot`             | what is waiting on a decision from you |
| **feed**   | `speckit:feed-list`, `speckit:feed-digest` | what happened while you were away      |

The **permission queue** sits above it, because a held tool call is the one
state where nothing moves until a person acts.

The **command palette** (`Cmd+P`) carries every live run and every queued diff, worst
state first — `waiting`, `stalled`, `ready`, `working`. Choosing one focuses the
window and lands on the thing: a run's terminal if it still has one, otherwise
the panel opened on it.

## What you can do about a run

Every row offers the same set, whether or not anything has called it stuck — the
moment you most want to redirect an agent is usually before that.

| Action         | Channel                  | What it does                                                    |
| -------------- | ------------------------ | --------------------------------------------------------------- |
| **Terminal**   | `speckit:run-terminal`   | goes to where it is actually running                            |
| **Transcript** | `speckit:run-transcript` | the last 20 things said, in its own words                       |
| **Interrupt**  | `speckit:run-interrupt`  | ends the turn, **keeps** the session, so the next message lands |
| **Redirect**   | `speckit:run-redirect`   | interrupt, then say what to do instead                          |
| **Stop**       | `speckit:run-stop`       | says why first, so the agent's own record carries it            |
| **Discard**    | `speckit:run-discard`    | ends it and removes its worktree **and branch**                 |

Discard takes the run off the review queue too. A discarded diff holding a
review slot would gate the next run on reviewing something that no longer
exists.

## Review

A finished turn with changes goes into the queue **worst first**, graded by what
it touched (`runtime/review/risk-grader.ts`):

| Grade  | Trigger                                                        |
| ------ | -------------------------------------------------------------- |
| **P0** | auth, payments, secrets, migrations, public API, critical path |
| **P1** | schema change, shared contract file, >300 changed lines        |
| **P2** | ordinary feature work                                          |
| **P3** | formatting, lockfile-only, dep bumps with green CI             |

The grade is always shown with **its trigger**. A grade with no reason is a
number you learn to ignore.

The unit of decision is the **hunk**, not the file: one file routinely holds both
the change you asked for and the one you did not, and accepting a file wholesale
is how the second one ships. A review cannot be finished with a hunk still
undecided, and a fully rejected branch says so rather than offering a merge.

Checks are reported as `unavailable` rather than assumed passing — the extension
does not poll a code host, and assuming green would let a change auto-merge on
evidence nobody has.

## Backpressure

**Three unreviewed diffs and a new run is refused**, with the reason and the
depth. The constraint is one person's capacity to review, which does not scale
with the number of cards.

Override is one click and is **recorded with the queue depth at the moment it was
ignored** (`.speckit-pilot-runtime/backpressure-overrides.jsonl`), so a backlog
built by overriding is visible afterwards rather than only felt.

## Stalls

Two independent signals, either of which fires (`runtime/evaluate-stall.ts`):

- no tool call for `T_silence` (default 8 min), or
- no net diff for `T_nodiff` (15 min) **and** the last 8 tool calls touched one
  file and changed nothing, or
- two or more reverts in the last 10 edits.

A shell call in flight is never silence, however long it runs — without that
exemption every test run reads as a stall.

**Shadow mode is on by default**: firings are recorded and shown in the stalls
section, not notified. Judge them against your own read for a week, then turn it
off with `terminator.speckit-pilot.stallShadowMode`.

A firing is posted to the feed **attributed to the pilot**, never to the agent.
The agent did not say it, and a feed that blurs the two is one you stop trusting.

## Where state lives

- **In memory** — the run register, the review queue, the stall firings. A run
  does not outlive the application: its terminal is a child of this process, and
  a registry reloaded from disk would describe runs that no longer exist.
- **On disk**, under `<worktree base>/.speckit-pilot-runtime/` — the feed
  (`feed.jsonl`), backpressure overrides, unattended merges, and the per-session
  `--settings` files and hook script.
- **In the browser** — when you last read the feed. That is a property of the
  person looking, not of the runs.

## Testing it

`npx vitest run extensions/speckit-pilot` covers the units and the IPC.

The one that matters is `tests/e2e/speckit-supervised-run.spec.ts`: it drives a
real dispatch through the real application and asserts the worktree became a
project, the terminal exists, and `claude --session-id` is visible in it — never
`bypassPermissions`. Every worst bug on this line of work passed its unit tests
and only appeared when the application ran.
