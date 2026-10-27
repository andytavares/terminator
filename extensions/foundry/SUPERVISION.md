# Supervision

What the pilot knows about a running agent, where it comes from, and what you
can do about it.

The premise: you cap out at two to six concurrent agents because **review** is
the bottleneck, and the failure nobody instruments is an agent that is stuck
_without asking for help_. Everything below exists for one of those two facts.

Architecture: [ADR-026](../../docs/adr/026-supervised-runs-in-a-terminal.md), as
[ADR-130](../../docs/adr/130-agents-the-app-drives-run-over-acp.md) amended it (agents run
over ACP; there is no hook).

## The surfaces

The **supervision panel** sits above the board (`components/SupervisionPanel.tsx`)
in two sections:

| Section    | Reads                 | Answers                           |
| ---------- | --------------------- | --------------------------------- |
| **stalls** | `foundry:stalls-list` | what stopped making progress      |
| **feed**   | `foundry:feed-list`   | what happened while you were away |

A card's drawer shows the same run: the phase's console renders the **terminal's
transcript**, with **Open the terminal** next to it. A supervised phase
broadcasts nothing on `foundry:run-output` — it runs in a terminal and its
output goes there — so the console read "Waiting for output…" for the whole run
until this. Replying in the drawer types into that session rather than starting
a second, invisible agent.

Every jump to a terminal happens **in the main process**, through the core's own
`terminal:navigate-to-session`. The extension's UI is a separate renderer
process, so a core store imported into it is a second copy that nothing renders.

The **permission queue** sits above it, because a held tool call is the one
state where nothing moves until a person acts.

The **command palette** (`Cmd+P`) carries every live run, worst
state first — `waiting`, `stalled`, `ready`, `working`. Choosing one focuses the
window and lands on the thing: a run's terminal if it still has one, otherwise
the panel opened on it.

## Where an order stands

One derivation — `src/order/standing.ts` — answers _what is this order doing,
and whose move is it_, and every surface reads it rather than working it out
from whatever it happens to hold. That was the alternative, and it shipped: the
order list read a **draft-time compile result**, which is zero for every running
order for ever, so it labelled every one of them `ready to hand off` — including
`WO-0909-30a`, which had been halted at an undecided budget gate for two hours
with its builder parked at a terminal prompt. The Floor, reading only the graph,
drew `building` chips over the same run. Neither named the gate.

`standingOf` is pure and takes the whole picture at once. The order of its
branches is not arbitrary — it is **how much of the run each condition has
stopped**, worst first:

| Kind       | Whose move | What it means                                                                                     |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `done`     | Foundry    | the order shipped                                                                                 |
| `shaping`  | either     | a draft: yours if it is asking questions or its last intake turn was refused, Foundry's otherwise |
| `halted`   | **you**    | an undecided gate has stopped the line; nothing is scheduled                                      |
| `adrift`   | **you**    | the graph says running and no process is                                                          |
| `asking`   | **you**    | an agent is holding a tool call, answerable from the surface                                      |
| `stranded` | **you**    | a call was handed back to the agent tab, where nobody is                                          |
| `stalled`  | **you**    | a run stopped making progress without asking for anything                                         |
| `stopped`  | **you**    | the run stopped on an error, or finished every step and still failed to ship                      |
| `failed`   | **you**    | a step failed                                                                                     |
| `ready`    | Foundry    | agreed, no graph yet                                                                              |
| `working`  | Foundry    | agents are running                                                                                |

Within `shaping` a **refused intake turn** outranks open questions, and for the
same kind of reason: answering a question the architect asked before it was
refused writes an answer onto a document no architect is reading. See _A turn
that was refused_ below.

`halted` outranks everything because a gate stops the whole line and every other
condition under it is a symptom. `asking` outranks `stranded` because a held
call is answerable here in one click and a handed-back one can only be answered
in the agent tab it was handed to. A **shadow** stall firing is deliberately
never notified, so it is not counted: a standing is a notification.

`readStanding` is the one place the inputs are assembled — the graph from disk,
the gates from the gate store, liveness from this process — and both
`foundry:order.list` and `foundry:run.observe` go through it. Two callers
assembling them separately is how the list and the Floor came to describe one
halted run as `ready to hand off` and `building` at the same moment.

### The band

The Floor opens with the standing across its full width, before anything only
there to be read: the order's **title**, then the headline, the sentence, how
many steps are done — and **the move**. A screen that names a blocker and offers
no reachable control is a wall, so the gate's own options are rendered as
buttons here, each over its consequence, answered through `foundry:inbox.decide`
— the same channel the inbox answers them with. This is not a second queue; the
inbox stays the cross-order one. It is this order's one blocking thing, put
where the person looking at the order will see it.

The same gate is drawn the same way in three more places, all through the one
`GateCard` (a line with the answers on it, the reason a click away, read as
markdown): the Inbox, the factory hall's pinned cards, and — as just its answers
— the order list's row. A row whose move is yours carries the gate's first two
answers inline; a raise, which needs a number typed, is not offered there and is
answered on the Floor or in the Inbox. A shipped order's open ready-for-review
gate is answerable in all of them. A row also links the pull request and the
ticket, and while CI is watching or fixing says so with a spinner and
**k of n checks done**.

`adrift` and `stranded` carry their moves the same way — _Pick it back up_ and
_Go to its agent tab_. The separate "nothing is running this" panel is gone with
them: two panels saying the same thing in two voices is what the band replaced.

### A turn that was refused

The architect proposes; Foundry validates; a proposal that would not make a
readable order is refused whole. That is ADR 043's boundary working, and the
cost it accepted — _the turn is wasted_ — is real: on `WO-0909-6db` six
acceptance criteria and the only unit in the plan were lost to three file paths
written into `verify.evidence`, which is a closed set of artifact kinds.

What ADR 043 said would happen and did not is that the waste was **reported**.
A refusal has nothing to save, so `order.json` is untouched, so every surface —
all of which read the document — saw an order in exactly the state it had been
in before. The Forge said _The architect is working…_ for forty minutes over a
turn that had ended, and the order list said _Foundry is still shaping this_.

So the outcome of an intake turn is read out of the ledger, which is the only
place it is written. `src/forge/intake-outcome.ts` walks a ledger backwards to
the newest of three lines and answers what the last turn did:

| Line               | Outcome     | What the surfaces do                                          |
| ------------------ | ----------- | ------------------------------------------------------------- |
| `converge.started` | `running`   | the Forge polls; the button says the architect is working     |
| `order.redrafted`  | `redrafted` | the poll stops; the redraw is already on screen               |
| `converge.refused` | `refused`   | the poll stops; the band opens; the standing is **your** move |
| none of them       | `none`      | intake has not run                                            |

`foundry:order.compile` carries it on every read, so the Forge's "is an
architect working" is derived from the record rather than from a flag set by a
click — which was wrong in both directions, surviving a turn that had ended and
not surviving a walk away from the screen.

The band itself carries the **validator's own words**, verbatim and monospaced:
the field path and the values it would have accepted. Paraphrasing would drop
the one thing that makes the next turn succeed. Two controls sit under it —
_Tell the architect what was wrong_, which sends the reason back as the next
turn's instruction, and _Start the turn over_.

The first is not a convenience. The architect cannot read its own refusal: its
turn ended before the validation ran. On the run this was found on it could not
have parsed its own JSON either — `node -e`, `python3 -c` and shell redirects
are all off intake's read-only allowlist, so there was no way for it to check
the deliverable before submitting it. Handed the reason, it fixes it in one
turn.

A refusal also raises a toast, once, keyed to the order. A refusal changes
nothing, so there is nowhere else it would appear to somebody who is not looking
at that order.

**The enums are in the brief.** Both refusals of this kind have been a closed
set the architect was never shown — `risk.triggers` on `WO-0907-3c1`,
`verify.evidence` on `WO-0909-6db`. Both are now rendered into the output
contract from the schema constant (`RISK_TRIGGERS`, `EVIDENCE_KINDS`) rather
than retyped, with the distinction that caused the failure stated: a trigger is
a label and not a sentence, and evidence is a kind of artifact and not a path —
a file the judge should read is named in the rubric. A closed set added to the
order schema and not to the contract is the next one of these — so
`converge.spec.ts` holds the list, and a closed set added to a proposable part
of the order fails that test until it is named in the brief. Sweeping it turned
up a third before it cost anything: a lane's `role`, shown as `null` and named
nowhere, three lines under a _unit's_ `role`, which is a free string whose
example reads `"builder"` — the obvious wrong answer sitting on the same screen
as the field.

### A run that stopped

The ledger is also where a run attempt's outcome lives, and `standingOf` reads
it back the same way it reads a refused intake turn: `src/line/run-outcome.ts`
walks a run's ledger backwards for its newest `run.failed` or `ship.refused`.
`WO-0913-0bd` finished every node and still never opened its pull request —
`Finished, but not shipped`, the ledger's own reason on screen, and a **Try
again** button that re-enters the executor and its shipping tail. See
[ADR 053](../../docs/adr/053-a-stopped-run-is-a-state.md).

## What you can do about a run

Every row offers the same set, whether or not anything has called it stuck — the
moment you most want to redirect an agent is usually before that.

| Action         | Channel                  | What it does                                                    |
| -------------- | ------------------------ | --------------------------------------------------------------- |
| **Terminal**   | `foundry:run-terminal`   | goes to where it is actually running                            |
| **Transcript** | `foundry:run-transcript` | the last 20 things said, in its own words                       |
| **Interrupt**  | `foundry:run-interrupt`  | ends the turn, **keeps** the session, so the next message lands |
| **Redirect**   | `foundry:run-redirect`   | interrupt, then say what to do instead                          |
| **Stop**       | `foundry:run-stop`       | says why first, so the agent's own record carries it            |

And two that act on the whole order rather than one agent:

| Action              | Channel              | What it does                                                                              |
| ------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| **Pick it back up** | `foundry:run.resume` | reclaims every step whose agent is gone, then re-enters the executor over the same graph  |
| **Stop the run**    | `foundry:run.stop`   | ends every live agent on it, saying why, and cancels the order. Worktrees are left alone. |

Discard is gone with the card model it belonged to: a run is a node in an
order's graph, and removing its worktree and branch is `foundry:run-stop`
followed by the ordinary cleanup. What used to be true of it still is — a
discarded diff holding a review slot would gate the next run on reviewing
something that no longer
exists.

## What a read-only role may actually run

The read-only policy decides on the _command_, not the tool, because restricting
tools does not work — an agent with Bash can write whatever `--disallowedTools`
says. That part was right from the start. What was wrong is that the list was
tuned for a reviewer, and it is also what governs the architect and the scout,
whose entire job is reading a repository.

The difference matters because **this path decides; it never asks**. A binary
left off the list is not "the agent can ask for it", it is "the agent cannot do
it" — and one that is _on_ the list is allowed outright, not sent to the
operator. It answered `null` on an allowed command for a while, which abstains,
and an abstention is a held tool call: five minutes on the inbox before it
is left open in the agent tab. Six reads was half an hour of waiting, with the
console showing an agent thinking. Four live runs in a row died on that, each on a different command, and the
architect said so itself before giving up: _"Bash is restricted to single
commands here. Working within that."_

What changed, and why each:

- **Every segment is checked, rather than every compound refused.** The original
  rule existed for a real hole — a shell runs each line of `git diff\nrm -rf .`
  in turn, and reading the first word reads the wrong command. But it also
  refused `find . | head -50`. Now a joined command is allowed exactly when
  every part of it reads, which is the same safety property and names the
  offending part when it fails: `ls && rm file` is refused, and the reason says
  `rm`. Redirection stays refused outright; a substitution is read rather than
  refused, so `cd "$(pwd)"` is allowed and `echo $(rm -rf x)` is not.
- **Segments are found with the quoting respected.** Matching `[><`|;&]`against the raw text split a verifier's`grep -rn -E "TTL|15 \* 60|process\.env" .`into four commands and refused
the review with "15 is not on the review's read-only list" — a fragment of
its own regex, reported as a binary. It tried three more spellings and gave
up.`2>&1`had the same shape, its`&` read as a joiner.
- **`git` has options of its own before the subcommand.** Reading the word
  straight after `git` made `git -C . status` a subcommand called `-C`, which
  is on no list, so the whole command was refused. Only git's real global
  options are stepped over — an unknown flag is still judged.
- **A role that declared `run_tests` may capture an exit status.** A verdict
  from an exit status is what FR-033 asks the verifier for, and an exit status
  is something you have to ask for: `npm test; echo "EXIT=$?"`. The allowance
  is per segment, so that is admitted while `npm test; rm -rf .` is not.
- **`find` is on the list**, with every way it writes — `-delete`, `-exec`,
  `-execdir`, `-ok`, `-okdir`, `-fprint*`, `-fls` — in the flag list, which is
  checked across the whole argument list rather than the first word.
- **`-o` is the one flag whose meaning depends on its binary.** `sort -o file`
  writes; `find . -name a -o -name b` is an "or". It is refused for everything
  except `find`.
- **Bare `-i` is no longer refused.** It was there for in-place editing, and it
  is also how `grep`, `rg` and `diff` all spell "ignore case". Nothing on the
  list writes with it; the tools that do are not on the list at all.
- **`pwd`, `echo`, `cd`, `basename`, `dirname`, `realpath`, `sort`, `uniq`,
  `cut`, `tr`, `du` and `tree` are on it**, because they cannot change
  anything, and a leading `NAME=value` is read past to the command underneath.
- **`git branch` is allowed when it is only listing.** Every writing form is
  visible — a flag this refuses, or a bare name, since `git branch newthing`
  creates a ref and looks like nothing. `config` and `remote` stay off: they
  write through a _positional_, which no flag rule can see.
- **Discarding output is not writing.** `2>/dev/null` is the first thing any
  reader reaches for — it was the architect's opening command on four runs
  running — and it was refused along with every other redirection. Only
  `/dev/null` is exempt, and only as a whole path: `> /dev/nullish` and
  `> /dev/null/file` are still refused, and a discard cannot hide a command
  that writes, because the command is still checked without it.

`sed` and `awk` stay off, and now say why: `sed -i` cannot be caught by a
general flag rule without also catching every case-insensitive read, and `awk`
redirects from inside its program text, where no flag check can see it.

**And refusals are said out loud.** A decision the ladder takes on its own
raises no prompt — that is the point of it — but a _refusal_ now posts to the
feed. An allow is one of hundreds and would drown it; a refusal is the reason
the agent is about to do something else, or nothing at all. It was invisible,
and that is why finding the five above took five live runs and five readings of
a transcript: on the console, an agent being turned down and an agent that had
gone quiet looked exactly the same.

## No trust dialog, no environment from the parent

Foundry starts its agents over ACP (`api.agents`,
[ADR-130](../../docs/adr/130-agents-the-app-drives-run-over-acp.md)). Two
problems of the old terminal launch are gone with it:

- **No workspace trust dialog.** An ACP session shows none, so Foundry no
  longer edits `~/.claude.json`. `runtime/workspace-trust.ts` and the
  `workspace.trusted` ledger entry are deleted.
- **No parent identity.** The core scrubs the parent Claude Code session's
  variables (`CLAUDE_CODE_BRIDGE_SESSION_ID` and the rest) from the agent's
  environment, so an agent cannot join somebody else's bridge session.

## What an agent is started with

`startSupervisedRun` (`runtime/supervised-runner.ts`) calls `api.agents.start` with
the permission mode its caller chose, the model and effort when chosen, the skill
folders, and the environment the skills read. It writes no settings file and
installs no hook:

| Variable                                | Why                                               |
| --------------------------------------- | ------------------------------------------------- |
| `SPECIFY_FEATURE`, `..._DIRECTORY`      | the card's paths, for the skills                  |
| `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` | a nested session still writes a transcript        |
| `FOUNDRY_RUN`                           | lets the operator's own hooks tell a Foundry run  |
| `CLAUDE_CODE_ARTIFACT_AUTO_OPEN`        | an unattended run must not open a browser per doc |

The session id is the agent's own (Claude Code's session id), so the transcript
is still `~/.claude/projects/<cwd>/<sessionId>.jsonl`. The brief is sent with
`api.agents.prompt`, as a message and not as a line typed into a terminal, so
its length and its line breaks are no concern.

The turn end is the end of a `prompt` (`end_turn`); the end of the run is
`api.agents.onEnd`. A `cancelled` or `error` turn is not reported as a turn end.
`mode` is chosen per role by `modeFor` (`runtime/permission-mode.ts`): `auto` for a
role that may write anywhere in its checkout, at `standard` or `lights-out`, with
`letAutoModeDecide` on; `default` for every other role. A read-only role (red team,
scout, review, the architect's rounds), a role limited to declared write paths
(`docsOnly`, an output file or directory), `escorted`, or `letAutoModeDecide` off
all get `default`.

Checks (`runCommand`) still run in terminal tabs: a command is not an agent.

## One conversation per lane

A lane keeps **one Claude session per role**. A role continuing its own work
resumes it — the executor hands `start` a `resumeSessionId` and the launch
passes `resume: <id>` to `api.agents.start` — so a builder taking a second unit in the lane
keeps everything it learned taking the first.

**A change of role starts a fresh conversation.** It used to resume across the
boundary too, on the reasoning that the builder should have the architect's
reading behind it. What it also had was the architect's _identity_: a context
window carries who the agent has been, not only what it read, and forty turns
of being the architect outweigh a paragraph of brief saying the next turn is
the builder's.

Three live runs died on it, each further along than the last. The clearest is
the third, where the builder wrote its own recap:

> Goal is making `TTL_MS` in `src/session.js` read `SESSION_TTL_MS` from the
> environment … **I've handed over the work order with criteria and two units,
> and I'm waiting on your sign-off plus write access to implement.**

Still the architect, waiting to be approved, while the graph said the unit was
being built and the worktree stayed clean. The run before it opened with
"Checking whether the sandbox is writable this turn"; the one before that
concluded "Read-only session, so no writes" and never wrote at all — and the
graph recorded that unit as built.

A brief that says "you may write now" does not fix this, and one was tried:
the problem is not what the agent believes it is permitted to do, it is who it
believes it is. `context: fresh` already says this for the verifier, and the
evidence is that it is not a verifier quirk. What the architect produced is
carried by the **work order**, which is the artefact that exists for exactly
that, rather than by a context window that carries its posture along with it.

The resume is offered on a positive match — the lane's last role was this
role — rather than on the absence of a mismatch, because a session this run
cannot account for belongs to a role it cannot name.

**It does not keep one terminal.** `start` opens a tab per node, so a
four-node lane leaves four tabs on the same worktree — same conversation, four
windows onto it. `SupervisedRunner.continueRun` is the mechanism that would fix
that, by typing the next node's brief into the prompt the agent is already
sitting at, and **nothing calls it**. It is built and tested and unused, and
this section claimed its behaviour as though it were live.

Wiring it is the obvious next move and is deliberately not done here: it types
a multi-kilobyte brief into a running TUI, and the last thing that typed a
brief anywhere corrupted every launch this runtime ever made. That is worth
proving on purpose rather than assuming, in a change of its own.

Before any of this, each phase minted its own session id as well as its own
tab, so a card ended up with five _transcripts_ and five agents that had each
read the repository from scratch. Resuming fixed that half — the expensive
half. Tab-per-node is what is left of it.

**A resumed role is told what it may do.** The turn before a builder's may have
been a read-only role spending it being refused, and the model reads that
history as its own standing permissions. Watched on two live runs: an architect
concluded _"Read-only session, so no writes"_, and the builder that resumed it
opened with _"Checking whether the sandbox is writable this turn."_ On the first
of those the builder never wrote at all, while the graph recorded the unit as
built. The hook cannot fix this — it refuses what a role may not do and has no
way to correct a role that wrongly believes it may do nothing — so a brief for a
writing role continuing someone else's conversation says the permissions changed.

**A rung reads only its own turn.** One conversation per lane means one
transcript for the architect, the builder, the verifier and all eight ladder
rungs. `rungExitCode` scanned the whole file for the last shell call matching
the rung's command, so a rung was answered by whoever ran that command last: run
against a real transcript from a live run, asking it for `npm test` returns the
_architect's_ result — from before the change existed, produced by the session
whose work the rung exists to check. Every run now carries the byte offset its
own turn starts at, taken before a keystroke reaches the terminal, and the rung
reads past it only. A command this turn never ran is "not measured" rather than
another session's pass.

One thing follows from the session outliving the node, and it is handled rather
than assumed: **a node is measured from the diff it inherited.** The
conversation carries every earlier node's changes, so "a turn that changed
something ended the node" would be true before the agent had read its prompt.
The runner records the diff as it stood when the node began and compares
against that.

(`runs.notePhase`, which renamed a run as it moved between phases, has no
caller either — a node's own `start` names it. It is on the list of twelve
methods this feature ships without using.)

When the session is gone — the tab was closed, the console restarted —
`continueRun` returns null and the caller opens a fresh conversation with
`--resume` rather than silently dropping the phase.

## What is over

Approving a phase takes its run off the live list, and writes a row into
**history** instead.

The run list was the only record there was, so it stacked every finished phase
forever and by the third card answered "what has this workspace ever done"
rather than "what is happening now".

History records one row per phase (`approved`, `stopped`, `discarded`, `ended`)
with what that phase actually did — turns, diff, how often it asked. It is in
memory and bounded at 200 rows; it does not outlive the application, because
neither do the runs it describes.

A run that has been approved also stops being stallable: the runtime marks a
session **waiting** when its `Stop` hook fires, because an agent sitting at its
prompt is blocked on a person, not stuck. Without that, a phase that finished
cleanly and was waiting to be approved went quiet, fired a stall eight minutes
later, and stayed in the Stalls tab offering to interrupt work that was done.

## Review

**Foundry does not review, and it keeps no review queue.** Review happens on the
pull request: the Floor's **Review** button runs the git extension's
`review-pull-request` command for the draft pull request (and says **Open on
GitHub** when that extension is off). The per-hunk review, its queue, the
backpressure gate that counted the queue and the channels that drained it
(`foundry:review-advance`, `foundry:review-done`) were removed; nothing counts
finished turns any more, and `run.start` is never refused for them.

What stays of the grading is `runtime/review/risk-grader.ts`, which the gates
and the verification ladder read: a change's grade (P0 to P3) and the trigger
that produced it. A grade is always shown with **its trigger** — a grade with
no reason is a number you learn to ignore.

Checks are reported as `unavailable` rather than assumed passing — the extension
does not poll a code host, and assuming green would let a change auto-merge on
evidence nobody has.

## Multi-repository cards

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
off with `terminator.foundry.stallShadowMode`.

A firing is posted to the feed **attributed to the pilot**, never to the agent.
The agent did not say it, and a feed that blurs the two is one you stop trusting.

## A run whose agents are gone

An agent runs in a terminal that is a **child of this process**. Quitting the
application kills every one of them — while `run-graph.json` on disk goes on
saying `running`.

Nothing used to notice. The scheduler offers only `waiting` and `ready` nodes
and `hasStalled` is false while anything is in flight, so a reopened run broke
out of its wave loop immediately, raised no gate and started nothing. The Floor
drew the same "building" chips it draws for a working run. `foundry:run.resume`
existed, was registered, and was called by no surface at all — its only caller
was the inbox's gate action, and there was no gate.

Three things now hold that together.

**Liveness is a question, and it is asked.** `line/reclaim.ts` takes a graph and
"is this process still running that session" — the runner's own register, which
is empty in a fresh application by construction. `run.observe` carries
`orphaned: string[]`, so a surface can tell a dead run from a busy one.

**Reclaiming precedes scheduling.** `run.resume` moves every orphaned node back
to `waiting` before it re-enters the executor. The attempt is **given back** —
the counter exists to catch an agent thrashing on the same check, and an
application closing is not the agent's doing. The **session id stays on the
node**, and `executeOrderRun` seeds its lane/role conversation map from the graph, so
a resumed step continues its own conversation through `claude --resume` rather
than putting a cold agent that has read nothing into a half-finished worktree.

**It announces itself.** The first time this application reads a records
location, `line/adopt.ts` raises one `run.interrupted` gate per affected order.
The rule is live at **every** autonomy setting: every other rule asks about
work, this one says the work stopped, and a dial that can silence it is a dial
that lets a dead run look busy until somebody checks. The gate id is derived
from the order rather than sequenced, so reopening five times leaves one row.
It is raised from `foundry:attention` and `foundry:inbox.list` — the chrome
polls `attention` every four seconds from the moment the application opens, so
the Forge badge says so within one poll rather than hours later.

Its options are **Pick it back up**, **Stop here** and **Hold**, and the default
if nobody answers is `hold`. No deadline, ever: every other default here
declines to act, and this one would start agents in somebody's repository
because they were at lunch.

### What this does not cover

A run that halts on a **budget breach** abandons its wave with the agents still
in their terminals. Those sessions are live, so nothing reclaims them — which is
correct, because restarting them would put a second agent into the same
worktree. What you get is an honest Floor: the steps read as running, because
they are, and nothing is collecting their results. **Stop the run** ends them.

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

## When a recipe needs something this repository does not have

A recipe declares what it requires, and `recipe/requirements.ts` checks it
against the order before anything starts. The `speckit` recipe requires the
SpecKit skills, so it is simply not offered in a repository without them —
rather than being started and answering "Unknown command: /speckit-specify"
with the step over before it began.

The check runs in the **worktree**, because that is where the agent runs, and
`git worktree add` only brings across what is committed: `.claude/skills/` is
routinely untracked, so the run's checkout often does not have it even when
your main one does.

`foundry:run.recipes` returns every recipe with `available` and, when it is
false, the specific requirement that is unmet — so the reason a shape of work
is not on offer is readable rather than inferred.

## Which model, and how many questions

A run is started with a permission mode (`modeFor`) and, when one is chosen, a model.

**Foundry decides every ask it sees.** In `default` mode Claude raises an ACP
permission ask for every write and every state-changing command (reads and plain
`ls` do not ask). `runtime/supervised-runner.ts` subscribes to the session's asks,
takes the tool name from the ask's `toolCallMeta` (`claudeCode.toolName`), and
gives the call to the permission bridge, which runs the autonomy ladder. Allow
picks the ask's `allow_once` option; deny picks `reject_once`. What the ladder
abstains on is held for a person. In `auto` mode Foundry sees only what Claude's
classifier asks about, and the ladder decides those the same way.

**A refusal is followed by its reason.** ACP's reject option has no text, so the
runner cancels the turn and sends the reason (or the operator's typed answer) as
the next prompt; the turn ends once, after the agent has read why. The hard
refusals also reach Claude as deny rules (`runtime/deny-rules.ts`), which hold in
`auto` mode, where the ladder sees only what the classifier asks about.

### An "ask" has no unattended resolution

This is worth knowing before turning `lights-out` on, because for a whole
session it looked like Claude Code hanging at random.

An ask the settings leave open goes to the operator at once, and stays open in
the agent tab until somebody answers it there or in the inbox. At `lights-out`
Foundry refuses it instead, since nobody is there. An ask the operator answers
in the agent tab clears its held call in Foundry (`onPermissionSettled`).

Measured on a live run:

|           |                                                                |
| --------- | -------------------------------------------------------------- |
| 09:11:49  | the builder runs `npm test > /tmp/claude-501/…`                |
|           | a redirect outside the checkout, so FR-050 asks                |
| ~09:16:49 | nobody answers; the call is handed back to the agent tab's ask |
| 09:19:17  | the stall detector notices silence                             |
| 09:41     | the wall-clock budget ends the run                             |

**How to recognise it in a transcript**: a held call is a `tool_use` record with
no `tool_result` after it. The agent never ran the tool; it is waiting to be
allowed to.

Agents redirect scratch output to their own `/tmp/claude-501/<session>/`
constantly — Claude Code's own instructions tell them to — so this fires on
ordinary behaviour rather than on anything alarming.

The question it raises is open on purpose: whether an "ask" should instead be a
**denial with a reason** at `lights-out`, where by definition nobody is coming.
Denying keeps FR-050's intent exactly — the action is still not taken — and lets
the agent adapt, which agents demonstrably do all day against the read-only
policy. It changes what FR-029 and FR-050 mean, so it is a decision to take on
purpose rather than a fix.

What has changed is that the silence is legible: the console says when a
question is asked, and says again when it is handed back to the agent tab, which
is the moment the agent stops.

A feed entry scrolls away, so the hand-back is also **recorded**. The session is
held in `strandedAgents` and counted for as long as its process is alive, which
is what lets the order's standing read `stranded` — _An agent is waiting at its
terminal_ — instead of `working`. The entry is dropped when that agent asks
again, which is what an agent somebody freed at the prompt does next, and when
its process is gone, which is `adrift` and a different move.

For 90 minutes on `WO-0909-30a` there was no such record: the builder was parked
at a prompt, its node still said `running`, and every surface drew a working
build over it until the wall-clock budget fired.

### What the settings decide

FR-029 says every action is held against a decision, automatic where the
autonomy setting allows it and asked where it does not. Claude Code makes that
decision now (ADR 131). `src/runtime/role-settings.ts` gives each role a
permission mode and `allow`, `ask` and `deny` rules, and Claude applies them to
every subcommand, subshell and control-flow body:

| Calls                                                                                                 | Rule                                                                           |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Pushing, changing a pull request, editing the skills mount, a tool the role file leaves out           | `deny`: never, in every mode                                                   |
| `rm -rf`, `sudo`, `git reset --hard`, `git checkout --`, `git restore`, `git clean`, `git stash drop` | `ask`: the operator decides; refused at `lights-out` (FR-050)                  |
| Every call from a read-only, docs-only or restricted-write role                                       | `dontAsk`: only what an `allow` rule names runs                                |
| Every call from a free writer                                                                         | `auto`, or `acceptEdits` with `letAutoModeDecide` off; `default` at `escorted` |

A refusal answers the ask with the agent's reject option. It never cancels the
turn, so the agent carries on and does the work another way.

## Two things the runtime does to a supervised run

**Session persistence is forced.** Claude Code sets `CLAUDE_CODE_CHILD_SESSION=1`
in every process it spawns, and a nested interactive session carrying that marker
is excluded from history — "Transcript saving is off". Everything here reads the
transcript, so when the console itself was started from a Claude Code session its
agents would write none and the stall detector, the turn count and the card's
console would all read empty forever. The runner exports
`CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`, which is the documented override.

**The folder-trust prompt is not suppressed.** The runtime asks you to trust a
directory the first time it runs in one, and a worktree is a new directory every
time — so a fresh run waits at that prompt having said nothing. There is no
documented flag or settings key to pre-answer it (only `-p`, which would give up
the terminal), so nothing here guesses at one: the card says the run is probably
waiting on it and sends you to the agent tab.

## Where state lives

- **In memory** — the run register, the stall firings. A run
  does not outlive the application: its terminal is a child of this process, and
  a registry reloaded from disk would describe runs that no longer exist. What
  survives is the **graph**, not the sessions — see "A run whose agents are
  gone" for how the two are reconciled when the application reopens.
- **On disk**, under `runtime/` in Foundry's own `api.paths.globalStorage` — the feed
  (`feed.jsonl`) and mute rules.
- **In the browser** — when you last read the feed. That is a property of the
  person looking, not of the runs.

## Testing it

`npx vitest run extensions/foundry` covers the units and the IPC.

The one that matters is `tests/e2e/foundry.spec.ts`: it drives the real
extension inside the real application, through the same IPC its own UI uses,
and asserts all four surfaces render, that an idea becomes an order, that an
order nobody agreed cannot be started, and that the repository is left exactly
as it was found. Every worst bug on this line of work passed its unit tests and
only appeared when the application ran.

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

## Self-review

Four checks, run as separate steps rather than an `&&` chain: for a gate you
want all four answers, not the first failure. Each records its own exit code.

| Check  | Command                                        | What the gate shows                             |
| ------ | ---------------------------------------------- | ----------------------------------------------- |
| Format | the repository's `format:check`                | pass/fail — **never** `format`, which writes    |
| Lint   | `lint -- --format json --output-file`          | errors and warnings, totalled from the report   |
| Tests  | `vitest --coverage.reporter=json-summary`      | line coverage from `coverage-summary.json`      |
| Review | `/at:google-review` under the read-only policy | pass/fail; it writes prose, so no blocker count |

Every number comes from a tool's own machine-readable report. Anything a tool
did not report reads as **not measured**, never as zero — a review that says "0
errors" when it does not know is worse than one that says nothing. A repository
with no `format:check` or `lint` script gets a step that says it did not run and
fails, so "not checked" never looks like "clean".

The exit codes and reports are written beside the runtime's other state, never
in the worktree: a review that adds a `coverage/` directory to the diff it is
reviewing has changed the thing it was measuring. Step output is not captured —
it streams to the run console live, and capturing it per step would mean piping,
whose status variable differs between bash and zsh.

## When a phase cannot be supervised

Three things drop a run to the headless spawn — `claude --print
--permission-mode bypassPermissions`, an agent nobody can see approving its own
tool calls: the supervision runtime failed to start, the repository belongs to
no workspace, or there is no window to put a terminal in. All three raise a
notification naming the card, because a log line is not a signal and a card that
ran unsupervised looks exactly like one that did not.

A terminal that could not be opened is different: that ends the phase with a
failure rather than running it unwatched.

## What is deliberately not here

- **Unattended merge of a P3 change.** The grading is real and shown, but
  nothing merges without a person: the extension has no source of CI status —
  check state is reported as `unavailable` rather than assumed passing — so an
  auto-merge could only ever fire on evidence nobody has. The policy and its
  audit log were removed rather than shipped as a promise the code cannot keep.
- **Stale-lane detection after an upstream merge.** It needs per-lane start and
  merge times, and nothing records a lane merging, so it could not be driven.

## Incidents behind the code

What a comment in the code points here for: the live run that showed why the
code is the way it is.

- `resume` (`src/ipc/run-channels.ts`) keeps the executor already driving an order: starting a second one produced `run.halted: waiting on a gate` three times in 23 seconds on WO-0927-4fd.
- `onPending` (`src/line/node-session.ts`) posts a held question to the console as well as the inbox. Before it did, a builder redirected its test output to a scratch file outside the checkout, FR-050 asked about it, nobody was there, the bridge handed the call back to the agent tab five minutes later, and the run sat until the wall-clock budget ended it half an hour on, with nothing saying a question had been asked.
- `stallInputs` (`src/runtime/evaluate-stall.ts`) counts silence from the later of the last activity and `stateSince`. A session spans turns and the transcript keeps every turn's tool calls, so a session given a new turn after a long gap carried the previous turn's last call as its latest activity: a run twenty-three seconds old was reported silent for twenty-one minutes, and `run.stalled` was on the order before the builder's third command.
- `runtimeStateDir` (`src/runtime/runtime-state.ts`) is absolute. It used to be `resolveWorktreeBaseDir('')`, which is `join('', '.worktrees')`, a relative path, so the `--settings` handed to claude resolved against the worktree it started in. The file was never there, so every supervised run died on "Settings file not found" the moment it launched: the card sat at WORKING with 0 turns and the console stayed empty.
- `recordStall` (`src/runtime/supervision-runtime.ts`) writes a stall to the order's ledger as well as the console. The detector was timely and nothing consumed it: on a live run the builder fell silent at 07:27:08, the stall fired at 07:34:21, and the run waited until the wall-clock budget stopped it at 07:52:10, eighteen minutes after the console knew. With shadow mode on by default, nothing an operator reads afterwards showed those minutes; the ledger said "budget exceeded".
- `fallbackRecordsBase` (`src/storage-folder.ts`) is never `process.cwd()`. The extension host's working directory is wherever the application was launched from (in development, the Terminator repository itself), so defaulting to it wrote one workspace's orders into another repository's working tree: a `.foundry/` directory in this repository held twelve orders from four different fixtures.
