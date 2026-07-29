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

**Finishing a review applies it.** The rejected hunks are reverted out of the
working copy (`git apply --reverse` against a patch rebuilt from exactly those
hunks) and the accepted ones stay. The button says which it is going to be
before you press it — "revert 2 hunks" or "keep everything" — because this is
not undoable from here. If git refuses the patch the review stays open with the
reason, rather than closing over a rejection that never landed: a reject that
changes nothing is worse than no review, because you believe the change is gone.

Checks are reported as `unavailable` rather than assumed passing — the extension
does not poll a code host, and assuming green would let a change auto-merge on
evidence nobody has.

## Backpressure

**Three unreviewed diffs and a new run is refused**, with the reason and the
depth. The constraint is one person's capacity to review, which does not scale
with the number of cards.

The refusal appears on the card, with **Start anyway** next to it. Overriding is
one click and is **recorded with the queue depth at the moment it was ignored** (`.speckit-pilot-runtime/backpressure-overrides.jsonl`), so a backlog
built by overriding is visible afterwards rather than only felt.

## Review steps, and multi-repository cards

A review is walked in four steps — **intent → risk → structure → tests**. Intent
is first deliberately: it is the step that catches work which is defensible in
isolation and was never asked for, and reading the diff first is how you end up
justifying such work instead of questioning it. It reads what the card asked for
against the agent's own account of what it did against what actually changed.

### Multi-repository cards

A card that touches more than one repository declares **lanes** in a
`workitem.json` the plan phase writes into the feature directory — the contract
between the pipeline and the console is a file, not an API, so the pipeline
stays usable in a bare terminal. When one is present, the card's Phases tab
shows the lanes in merge order with their predicted collisions and says which
one has to land first. A card with no such file has one repository, and none of
this appears.

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

## What may interrupt you

Fixed by kind, not decided per call. Automation complacency is the documented
failure mode of supervisory control: a console that only speaks when something
is wrong teaches you that silence means fine, and silence is also what a crashed
console looks like.

| Event                            | Channel                                                  |
| -------------------------------- | -------------------------------------------------------- |
| A tool call is held              | a notification carrying **Allow / Deny**, until answered |
| A stall, a failure, a diff ready | an indication                                            |
| Routine progress                 | the feed, and nowhere else                               |

A held tool call is the only thing that interrupts, because it is the only thing
where nothing moves until you act — and a request nobody sees is a twelve-hour
hang. Answering it takes the notification away with it.

**Mute** on a feed row stops one run interrupting you without hiding anything it
does; the entries keep arriving in the feed. Mutes persist, because one you have
to set again after every restart is one you stop bothering with — and then
notifications get turned off wholesale.

## Where state lives

- **In memory** — the run register, the review queue, the stall firings. A run
  does not outlive the application: its terminal is a child of this process, and
  a registry reloaded from disk would describe runs that no longer exist.
- **On disk**, under `<worktree base>/.speckit-pilot-runtime/` — the feed
  (`feed.jsonl`), backpressure overrides, mute rules, and the per-session
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

## Approved, and then edited

Approving a phase records a hash of its artifacts — one hash over the set, since
`plan` produces three files. Reading the card recomputes it, and a phase whose
artifacts no longer match is marked **modified**: what is on disk is not what you
approved.

The artifacts are read **from the card's worktree**, which is where the phase
wrote them. `defaultArtifactPaths` records them against the main checkout, and
that is not where they are: `git worktree add` checks out a branch, so the card
directory the board created — uncommitted, in the main checkout — is not in the
worktree, and the agent creates it there. The hash is taken over each artifact's
_repository-relative_ name plus its content, so reading the same artifact from a
different checkout is not a change while renaming one still is. That is a different thing from **stale**, which means something
upstream moved, and the board says which.

A phase can also be **skipped** from its gate, and unskipped from the rail. Not
every card needs every phase, and the alternative to offering that is approving
something you did not read.

## What is deliberately not here

- **Unattended merge of a P3 change.** The grading is real and shown, but
  nothing merges without a person: the extension has no source of CI status —
  check state is reported as `unavailable` rather than assumed passing — so an
  auto-merge could only ever fire on evidence nobody has. The policy and its
  audit log were removed rather than shipped as a promise the code cannot keep.
- **Stale-lane detection after an upstream merge.** It needs per-lane start and
  merge times, and nothing records a lane merging, so it could not be driven.
