# Supervision

What the pilot knows about a running agent, where it comes from, and what you
can do about it.

The premise: you cap out at two to six concurrent agents because **review** is
the bottleneck. The failure that nobody instruments is an agent that is stuck
_without asking for help_. Everything below exists for one of those two facts.

Architecture: [ADR-026](../../docs/adr/026-supervised-runs-in-a-terminal.md), as
[ADR-130](../../docs/adr/130-agents-the-app-drives-run-over-acp.md) amended it (agents run
over ACP; there is no hook).

## The surfaces

The **supervision panel** sits above the board (`components/SupervisionPanel.tsx`).
It has two sections:

| Section    | Reads                 | Answers                           |
| ---------- | --------------------- | --------------------------------- |
| **stalls** | `foundry:stalls-list` | what stopped making progress      |
| **feed**   | `foundry:feed-list`   | what happened while you were away |

The drawer of a card shows the same run. The console of the phase renders the **transcript of the terminal**, with **Open the terminal** next to it. A supervised phase
broadcasts nothing on `foundry:run-output`, because it runs in a terminal and its
output goes there. Before this change, the console read "Waiting for output…" for the whole run.
A reply in the drawer types into that session. It does not start
a second, invisible agent.

Every jump to a terminal happens **in the main process**, through the core's own
`terminal:navigate-to-session`. The UI of the extension is a separate renderer
process, so a core store imported into it is a second copy that nothing renders.

The **permission queue** sits above the panel, because a held tool call is the one
state where nothing moves until a person acts.

The **command palette** (`Cmd+P`) lists every live run, worst
state first: `waiting`, `stalled`, `ready`, `working`. Choosing a run focuses the
window and lands on it. It lands on the terminal of the run if the run still has one, and otherwise on
the panel opened on the run.

## Where an order stands

One derivation, `src/order/standing.ts`, answers _what is this order doing,
and whose move is it_. Every surface reads it. No surface works the answer out
from whatever it happens to hold. That was the alternative, and it shipped: the
order list read a **draft-time compile result**, which is zero for every running
order for ever, so it labelled every running order `ready to hand off`. That included
`WO-0909-30a`, which had been halted at an undecided budget gate for two hours
with its builder parked at a terminal prompt. The Floor, which read only the graph,
drew `building` chips over the same run. Neither surface named the gate.

`standingOf` is pure and takes the whole picture at once. The order of its
branches is not arbitrary. The order is **how much of the run each condition has
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

Within `shaping`, a **refused intake turn** outranks open questions, for the
same kind of reason. An answer to a question that the architect asked before the turn was
refused lands on a document that no architect is reading. See _A turn
that was refused_ below.

`halted` outranks everything, because a gate stops the whole line and every other
condition under it is a symptom. `asking` outranks `stranded`, because you can answer a held
call here in one click, but you can answer a handed-back call only
in the agent tab it was handed to. Foundry deliberately never notifies a **shadow** stall firing,
so it does not count one: a standing is a notification.

`readStanding` is the one place that assembles the inputs: the graph from disk,
the gates from the gate store, and liveness from this process. Both
`foundry:order.list` and `foundry:run.observe` go through it. Two callers
that assembled the inputs separately made the list and the Floor describe one
halted run as `ready to hand off` and `building` at the same moment.

### The band

The Floor opens with the standing across its full width, before anything that is only
there to be read. It shows the **title** of the order, then the headline, the sentence, how
many steps are done, and **the move**. A screen that names a blocker and offers
no reachable control is a wall. The band therefore renders the options of the gate as
buttons, each over its consequence, and answers them through `foundry:inbox.decide`,
the same channel that the inbox uses. This is not a second queue: the
inbox stays the cross-order queue. The band shows the one blocking thing of this order
where the person who looks at the order sees it.

Three more places draw the same gate in the same way, all through the one
`GateCard` (a line with the answers on it, the reason a click away, read as
markdown): the Inbox, the pinned cards of the factory hall, and, with just the answers,
the row of the order list. A row whose move is yours carries the first two
answers of the gate inline. The row does not offer a raise, which needs a typed number.
Answer a raise on the Floor or in the Inbox. You can answer the open ready-for-review
gate of a shipped order in all of them. A row also links the pull request and the
ticket. While CI is watching or fixing, the row says so with a spinner and
**k of n checks done**.

`adrift` and `stranded` carry their moves the same way: _Pick it back up_ and
_Go to its agent tab_. The separate "nothing is running this" panel is gone with
them. The band replaced two panels that said the same thing in two voices.

### A turn that was refused

The architect proposes and Foundry validates. Foundry refuses whole a proposal that would not make a
readable order. That is the boundary of ADR 043 at work, and the
cost it accepted, _the turn is wasted_, is real. On `WO-0909-6db`, three file paths
written into `verify.evidence`, which is a closed set of artifact kinds, cost six
acceptance criteria and the only unit in the plan.

ADR 043 said that the waste would be **reported**, and it was not.
A refusal has nothing to save, so `order.json` is untouched. Every surface
reads that document, so every surface saw an order in exactly the state it had been
in before. The Forge said _The architect is working…_ for forty minutes over a
turn that had ended, and the order list said _Foundry is still shaping this_.

So Foundry reads the outcome of an intake turn out of the ledger, which is the only
place that writes it. `src/forge/intake-outcome.ts` walks a ledger backwards to
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

The band itself carries the **words of the validator**, verbatim and monospaced:
the field path and the values that the validator would have accepted. A paraphrase would drop
the one thing that makes the next turn succeed. Two controls sit under the words:
_Tell the architect what was wrong_, which sends the reason back as the instruction
of the next turn, and _Start the turn over_.

The first control is not a convenience. The architect cannot read its own refusal, because its
turn ended before the validation ran. On the run where this was found, the architect could not
have parsed its own JSON either: `node -e`, `python3 -c` and shell redirects
are all off the read-only allowlist of intake, so it had no way to check
the deliverable before it submitted the deliverable. When the architect receives the reason, it fixes the problem in one
turn.

A refusal also raises one toast, keyed to the order. A refusal changes
nothing, so a person who is not looking at that order would see it nowhere else.

**The enums are in the brief.** Both refusals of this kind came from a closed
set that nobody showed the architect: `risk.triggers` on `WO-0907-3c1` and
`verify.evidence` on `WO-0909-6db`. The output contract now renders both from the schema constant (`RISK_TRIGGERS`, `EVIDENCE_KINDS`) instead of
a retyped copy. It also states the distinction that caused the failure: a trigger is
a label and not a sentence, and evidence is a kind of artifact and not a path.
The rubric names a file that the judge should read. A closed set that someone adds to the
order schema and not to the contract is the next failure of this kind. So
`converge.spec.ts` holds the list, and a closed set added to a proposable part
of the order fails that test until the brief names it. A sweep found a third failure before it cost anything: the `role` of a lane, shown as `null` and named
nowhere, three lines under the `role` of a _unit_, which is a free string whose
example reads `"builder"`. The obvious wrong answer sat on the same screen
as the field.

### A run that stopped

The ledger also holds the outcome of a run attempt, and `standingOf` reads
it back in the same way as it reads a refused intake turn: `src/line/run-outcome.ts`
walks the ledger of a run backwards for its newest `run.failed` or `ship.refused`.
`WO-0913-0bd` finished every node and still never opened its pull request.
The screen showed `Finished, but not shipped`, the reason from the ledger, and a **Try
again** button that re-enters the executor and its shipping tail. See
[ADR 053](../../docs/adr/053-a-stopped-run-is-a-state.md).

## What you can do about a run

Every row offers the same set of actions, whether or not anything has called the run stuck. You usually want to redirect an agent before that.

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

Discard is gone with the card model it belonged to. A run is a node in the graph of an
order, and removing its worktree and branch is `foundry:run-stop`
followed by the ordinary cleanup. What was true of Discard is still true: a
discarded diff that holds a review slot would gate the next run on a review of
something that no longer
exists.

## What a read-only role may actually run

The read-only policy decides on the _command_, not the tool, because restricting
tools does not work: an agent with Bash can write whatever `--disallowedTools`
says. That part was right from the start. The list was wrong because someone tuned it for a reviewer,
and it also governs the architect and the scout, whose entire job is to read a repository.

The difference matters because **this path decides; it never asks**. A binary
that is off the list is not "the agent can ask for it". It is "the agent cannot do
it". A binary that is _on_ the list is allowed outright, and the policy does not send it to the
operator. For a while the policy answered `null` on an allowed command. That abstains,
and an abstention is a held tool call: five minutes on the inbox before the call
is left open in the agent tab. Six reads meant half an hour of waiting, with the
console showing an agent that was thinking. Four live runs in a row died on that, each on a different command. The
architect said so itself before it gave up: _"Bash is restricted to single
commands here. Working within that."_

What changed, and why each:

- **The policy checks every segment instead of refusing every compound.** The original
  rule existed for a real hole: a shell runs each line of `git diff\nrm -rf .`
  in turn, and a check of the first word reads the wrong command. But the rule also
  refused `find . | head -50`. Now the policy allows a joined command exactly when
  every part of it reads. That is the same safety property, and it names the
  offending part when it fails: `ls && rm file` is refused, and the reason says
  `rm`. The policy still refuses redirection outright. It reads a substitution instead of
  refusing it, so `cd "$(pwd)"` is allowed and `echo $(rm -rf x)` is not.
- **The policy finds segments with the quoting respected.** Matching `[><`|;&]`against the raw text split a verifier's`grep -rn -E "TTL|15 \* 60|process\.env" .`into four commands and refused
the review with "15 is not on the review's read-only list". That was a fragment of
its own regex, reported as a binary. The verifier tried three more spellings and gave
up.`2>&1`had the same shape: the policy read its`&` as a joiner.
- **`git` has options of its own before the subcommand.** The old check read the word
  straight after `git`, so it made `git -C . status` a subcommand called `-C`, which
  is on no list, and it refused the whole command. The policy now steps over only the real global
  options of git. It still judges an unknown flag.
- **A role that declared `run_tests` can capture an exit status.** FR-033 asks the verifier for a verdict
  from an exit status, and you have to ask for an exit status explicitly: `npm test; echo "EXIT=$?"`. The allowance
  is per segment, so the policy admits that command and refuses `npm test; rm -rf .`.
- **`find` is on the list.** The flag list holds every way that `find` writes: `-delete`, `-exec`,
  `-execdir`, `-ok`, `-okdir`, `-fprint*`, `-fls`. The policy checks the flag list across the whole argument list, not only the first word.
- **`-o` is the one flag whose meaning depends on its binary.** `sort -o file`
  writes. `find . -name a -o -name b` is an "or". The policy refuses `-o` for every binary
  except `find`.
- **The policy no longer refuses bare `-i`.** The rule was there for in-place editing, but
  `grep`, `rg` and `diff` also spell "ignore case" with `-i`. Nothing on the
  list writes with it. The tools that do write with it are not on the list at all.
- **`pwd`, `echo`, `cd`, `basename`, `dirname`, `realpath`, `sort`, `uniq`,
  `cut`, `tr`, `du` and `tree` are on the list**, because they cannot change
  anything. The policy reads past a leading `NAME=value` to the command underneath.
- **The policy allows `git branch` when it only lists.** Every writing form is
  visible: a flag that the policy refuses, or a bare name, because `git branch newthing`
  creates a ref and looks like nothing. `config` and `remote` stay off, because they
  write through a _positional_, which no flag rule can see.
- **Discarding output is not writing.** `2>/dev/null` is the first thing that any
  reader reaches for. It was the opening command of the architect on four runs
  in a row, and the policy refused it along with every other redirection. Only
  `/dev/null` is exempt, and only as a whole path: the policy still refuses `> /dev/nullish` and
  `> /dev/null/file`. A discard cannot hide a command
  that writes, because the policy still checks the command without it.

`sed` and `awk` stay off, and the policy now says why. A general flag rule cannot catch `sed -i`
without also catching every case-insensitive read, and `awk`
redirects from inside its program text, where no flag check can see it.

**The policy also says refusals out loud.** A decision that the ladder takes on its own
raises no prompt, which is the point of the ladder. But a _refusal_ now posts to the
feed. An allow is one of hundreds and would drown the feed. A refusal is the reason
that the agent is about to do something else, or nothing at all. It was invisible,
and that is why finding the five problems above took five live runs and five readings of
a transcript. On the console, an agent that the policy turned down and an agent that had
gone quiet looked exactly the same.

## No trust dialog, no environment from the parent

Foundry starts its agents over ACP (`api.agents`,
[ADR-130](../../docs/adr/130-agents-the-app-drives-run-over-acp.md)). Two
problems of the old terminal launch are gone:

- **No workspace trust dialog.** An ACP session shows none, so Foundry no
  longer edits `~/.claude.json`. The commit deleted `runtime/workspace-trust.ts` and the
  `workspace.trusted` ledger entry.
- **No parent identity.** The core scrubs the variables of the parent Claude Code session
  (`CLAUDE_CODE_BRIDGE_SESSION_ID` and the rest) from the environment of the agent,
  so an agent cannot join the bridge session of somebody else.

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

The session id is the own id of the agent (the session id of Claude Code), so the transcript
is still `~/.claude/projects/<cwd>/<sessionId>.jsonl`. Foundry sends the brief with
`api.agents.prompt`, as a message and not as a line typed into a terminal, so
the length and the line breaks of the brief do not matter.

The turn end is the end of a `prompt` (`end_turn`). The end of the run is
`api.agents.onEnd`. Foundry does not report a `cancelled` or `error` turn as a turn end.
`modeFor` (`runtime/permission-mode.ts`) chooses `mode` per role. A role that can write anywhere in its checkout gets `auto`, at `standard` or `lights-out`, with
`letAutoModeDecide` on. Every other role gets `default`: a read-only role (red team,
scout, review, the rounds of the architect), a role limited to declared write paths
(`docsOnly`, an output file or directory), `escorted`, and any role when `letAutoModeDecide` is off.

Checks (`runCommand`) still run in terminal tabs, because a command is not an agent.

## One conversation per lane

A lane keeps **one Claude session per role**. A role that continues its own work
resumes the session. The executor hands `start` a `resumeSessionId`, and the launch
passes `resume: <id>` to `api.agents.start`. A builder that takes a second unit in the lane
therefore keeps everything it learned on the first unit.

**A change of role starts a fresh conversation.** The lane used to resume across the
boundary too, on the reasoning that the builder should have the reading of the architect
behind it. The builder also received the _identity_ of the architect. A context
window carries who the agent has been, not only what it read, and forty turns
as the architect outweigh a paragraph of brief that says the next turn
belongs to the builder.

Three live runs died on it, each further along than the last. The clearest is
the third, where the builder wrote its own recap:

> Goal is making `TTL_MS` in `src/session.js` read `SESSION_TTL_MS` from the
> environment … **I've handed over the work order with criteria and two units,
> and I'm waiting on your sign-off plus write access to implement.**

The builder was still the architect, waiting for approval, while the graph said the unit was
being built and the worktree stayed clean. The run before it opened with
"Checking whether the sandbox is writable this turn". The run before that
concluded "Read-only session, so no writes" and never wrote at all, and the
graph recorded that unit as built.

A brief that says "you may write now" does not fix this. Someone tried one. The
problem is not what the agent believes it can do. The problem is who it
believes it is. `context: fresh` already says this for the verifier, and the
evidence shows that this is not a quirk of the verifier. The **work order** carries what the architect produced.
The work order is the artefact that exists for exactly
that purpose. A context window carries its posture along with the content, so it is the wrong carrier.

Foundry offers the resume on a positive match (the last role of the lane was this
role), not on the absence of a mismatch, because a session that this run
cannot account for belongs to a role that it cannot name.

**It does not keep one terminal.** `start` opens a tab per node, so a
four-node lane leaves four tabs on the same worktree: the same conversation, in four
windows. `SupervisedRunner.continueRun` is the mechanism that would fix
that, by typing the brief of the next node into the prompt where the agent already
sits, and **nothing calls it**. Someone built and tested it, and nothing uses it.
This section claimed its behaviour as if it were live.

Wiring it is the obvious next move. This change deliberately does not do it: it types
a multi-kilobyte brief into a running TUI, and the last change that typed a
brief anywhere corrupted every launch this runtime ever made. Prove the wiring on purpose
in a change of its own. Do not assume it works.

Before any of this, each phase minted its own session id as well as its own
tab. A card ended up with five _transcripts_ and five agents that had each
read the repository from scratch. Resuming fixed that half, the expensive
half. Tab-per-node is what is left.

**A resumed role is told what it can do.** The turn before the turn of a builder can have
been a read-only role that spent the turn being refused, and the model reads that
history as its own standing permissions. Two live runs showed this. An architect
concluded _"Read-only session, so no writes"_, and the builder that resumed it
opened with _"Checking whether the sandbox is writable this turn."_ On the first
of those runs, the builder never wrote at all, while the graph recorded the unit as
built. The hook cannot fix this. It refuses what a role must not do, and it cannot
correct a role that wrongly believes it can do nothing. So the brief for a
writing role that continues the conversation of another role says that the permissions changed.

**A rung reads only its own turn.** One conversation per lane means one
transcript for the architect, the builder, the verifier and all eight ladder
rungs. `rungExitCode` scanned the whole file for the last shell call that matched
the command of the rung, so whoever ran that command last answered the rung. Run
against a real transcript from a live run, a request for `npm test` returns the
_architect's_ result. That result predates the change, and the session
whose work the rung exists to check produced it. Every run now carries the byte offset where its
own turn starts, taken before a keystroke reaches the terminal, and the rung
reads past that offset only. A command that this turn never ran is "not measured", not
the pass of another session.

One consequence follows from a session that outlives the node. Foundry handles it and does not assume it: **a node is measured from the diff it inherited.** The
conversation carries the changes of every earlier node, so "a turn that changed
something ended the node" would be true before the agent had read its prompt.
The runner records the diff as it stood when the node began and compares
against that diff.

(`runs.notePhase`, which renamed a run as it moved between phases, has no
caller either, because the own `start` of a node names the run. It is on the list of twelve
methods that this feature ships without using.)

When the session is gone (the tab was closed, the console restarted),
`continueRun` returns null and the caller opens a fresh conversation with
`--resume`. It does not silently drop the phase.

## What is over

Approving a phase takes its run off the live list and writes a row into
**history** instead.

The run list was the only record, so it stacked every finished phase
forever. By the third card, it answered "what has this workspace ever done"
instead of "what is happening now".

History records one row per phase (`approved`, `stopped`, `discarded`, `ended`)
with what that phase actually did: turns, diff, and how often it asked. It is in
memory and holds at most 200 rows. It does not outlive the application, because
the runs that it describes do not outlive the application either.

A run that someone has approved also stops being stallable. The runtime marks a
session **waiting** when its `Stop` hook fires, because an agent that sits at its
prompt is blocked on a person, not stuck. Without that mark, a phase that finished
cleanly and waited for approval went quiet, fired a stall eight minutes
later, and stayed in the Stalls tab, where it offered to interrupt work that was done.

## Review

**Foundry does not review, and it keeps no review queue.** Review happens on the
pull request. The **Review** button of the Floor runs the `review-pull-request` command of the git extension
for the draft pull request (and says **Open on
GitHub** when that extension is off). Someone removed the per-hunk review, its queue, the
backpressure gate that counted the queue and the channels that drained it
(`foundry:review-advance`, `foundry:review-done`). Nothing counts
finished turns any more, and `run.start` is never refused for them.

`runtime/review/risk-grader.ts` stays from the grading. The gates
and the verification ladder read it: the grade of a change (P0 to P3) and the trigger
that produced the grade. Foundry always shows a grade with **its trigger**, because a grade with
no reason is a number that you learn to ignore.

Foundry reports checks as `unavailable` and does not assume they pass. The extension
does not poll a code host, and assuming green would let a change auto-merge on
evidence that nobody has.

## Multi-repository cards

A card that touches more than one repository declares **lanes** in a
`workitem.json` that the plan phase writes into the feature directory. The contract
between the pipeline and the console is a file, not an API, so the pipeline
stays usable in a bare terminal. When the file is present, the Phases tab of the card
shows the lanes in merge order with their predicted collisions and says which
lane has to land first. A card with no such file has one repository, and none of
this appears.

## Stalls

A stall fires on any of these signals (`runtime/evaluate-stall.ts`):

- no tool call for `T_silence` (default 8 min), or
- no net diff for `T_nodiff` (15 min) **and** the last 8 tool calls touched one
  file and changed nothing, or
- two or more reverts in the last 10 edits.

A shell call in flight is never silence, however long it runs. Without that
exemption every test run reads as a stall.

**Shadow mode is on by default.** Foundry records each firing and shows it in the
stalls section. It sends no notification. Judge the firings against your own read
for a week. Then turn shadow mode off with `terminator.foundry.stallShadowMode`.

Foundry posts a firing to the feed **attributed to the pilot**, never to the agent.
The agent did not say it. A feed that blurs the two is a feed you stop trusting.

## A run whose agents are gone

An agent runs in a terminal that is a **child of this process**. Quitting the
application kills every agent. Meanwhile `run-graph.json` on disk still says
`running`.

Nothing used to notice. The scheduler offers only `waiting` and `ready` nodes.
`hasStalled` is false while anything is in flight. A reopened run therefore left
its wave loop immediately, raised no gate and started nothing. The Floor drew the
same "building" chips that it draws for a working run. `foundry:run.resume`
existed and was registered, but no surface called it. Its only caller was the
gate action of the inbox, and there was no gate.

Three things now hold this together.

**Liveness is a question, and Foundry asks it.** `line/reclaim.ts` takes a graph
and asks whether this process still runs each session. It uses the register of the
runner, which is empty in a fresh application by construction. `run.observe`
carries `orphaned: string[]`, so a surface can tell a dead run from a busy one.

**Reclaiming comes before scheduling.** `run.resume` moves every orphaned node
back to `waiting` before it re-enters the executor. The attempt is **given
back**. The counter exists to catch an agent that thrashes on the same check, and
closing the application is not the fault of the agent. The **session id stays on
the node**, and `executeOrderRun` seeds its lane/role conversation map from the
graph. A resumed step therefore continues its own conversation through
`claude --resume`. Without this, a cold agent that has read nothing would enter a
half-finished worktree.

**The run announces itself.** The first time this application reads a records
location, `line/adopt.ts` raises one `run.interrupted` gate for each affected
order. The rule is live at **every** autonomy setting. Every other rule asks about
work. This rule says that the work stopped. A dial that can silence it lets a dead
run look busy until somebody checks. Foundry derives the gate id from the order and
does not sequence it, so reopening five times leaves one row. Foundry raises the
gate from `foundry:attention` and `foundry:inbox.list`. The chrome polls
`attention` every four seconds from the moment the application opens. The Forge
badge therefore shows the gate within one poll, not hours later.

The options are **Pick it back up**, **Stop here** and **Hold**. The default, if
nobody answers, is `hold`. There is no deadline, ever. Every other default here
declines to act. A deadline on this gate would start agents in somebody's
repository because they were at lunch.

### What this does not cover

A run that halts on a **budget breach** abandons its wave, and the agents stay in
their terminals. Those sessions are live, so nothing reclaims them. This is
correct, because a restart would put a second agent into the same worktree. The
Floor stays honest: the steps read as running, because they are, and nothing
collects their results. **Stop the run** ends them.

## What may interrupt you

The kind of event fixes the channel. Foundry does not decide it for each call.
Automation complacency is the documented failure mode of supervisory control. A
console that speaks only when something is wrong teaches you that silence means
fine. Silence is also what a crashed console looks like.

| Event                            | Channel                                                  |
| -------------------------------- | -------------------------------------------------------- |
| A tool call is held              | a notification carrying **Allow / Deny**, until answered |
| A stall, a failure, a diff ready | an indication                                            |
| Routine progress                 | the feed, and nowhere else                               |

A held tool call is the only event that interrupts. It is the only event where
nothing moves until you act, and a request that nobody sees is a twelve-hour
hang. Answering the call removes the notification.

**Mute** on a feed row stops one run from interrupting you. It hides nothing that
the run does: the entries keep arriving in the feed. Mutes persist. A mute that
you must set again after every restart is one you stop bothering with, and then
you turn notifications off wholesale.

## When a recipe needs something this repository does not have

A recipe declares what it requires. `recipe/requirements.ts` checks the
requirements against the order before anything starts. The `speckit` recipe
requires the SpecKit skills, so Foundry does not offer it in a repository without
them. Without this check, the run would start and answer "Unknown command:
/speckit-specify", and the step would be over before it began.

The check runs in the **worktree**, because the agent runs there. `git worktree
add` brings across only what is committed. `.claude/skills/` is routinely
untracked, so the checkout of the run often lacks it even when your main checkout
has it.

`foundry:run.recipes` returns every recipe with `available`. When `available` is
false, it also returns the specific requirement that is not met. You can read why
a shape of work is not on offer, and you do not have to infer it.

## Which model, and how many questions

A run starts with a permission mode (`modeFor`) and, when you choose one, a model.

**Foundry decides every ask it sees.** In `default` mode Claude raises an ACP
permission ask for every write and every state-changing command. Reads and plain
`ls` do not ask. `runtime/supervised-runner.ts` subscribes to the asks of the
session and takes the tool name from the `toolCallMeta` of the ask
(`claudeCode.toolName`). It gives the call to the permission bridge, which runs
the autonomy ladder. Allow picks the `allow_once` option of the ask. Deny picks
`reject_once`. A person holds what the ladder abstains on. In `auto` mode Foundry
sees only what the classifier of Claude asks about, and the ladder decides those
asks in the same way.

**A refusal is followed by its reason.** The reject option of ACP has no text. The
runner therefore cancels the turn and sends the reason (or the typed answer of the
operator) as the next prompt. The turn ends once, after the agent has read why.
The hard refusals also reach Claude as deny rules (`runtime/deny-rules.ts`). Those
rules hold in `auto` mode, where the ladder sees only what the classifier asks
about.

### An "ask" has no unattended resolution

Know this before you turn `lights-out` on. For a whole session it looked like
Claude Code hanging at random.

An ask that the settings leave open goes to the operator at once. It stays open in
the agent tab until somebody answers it there or in the inbox. At `lights-out`
Foundry refuses the ask instead, because nobody is there. When the operator
answers an ask in the agent tab, Foundry clears its held call
(`onPermissionSettled`).

Measured on a live run:

|           |                                                                |
| --------- | -------------------------------------------------------------- |
| 09:11:49  | the builder runs `npm test > /tmp/claude-501/…`                |
|           | a redirect outside the checkout, so FR-050 asks                |
| ~09:16:49 | nobody answers; the call is handed back to the agent tab's ask |
| 09:19:17  | the stall detector notices silence                             |
| 09:41     | the wall-clock budget ends the run                             |

**How to recognise it in a transcript**: a held call is a `tool_use` record with
no `tool_result` after it. The agent never ran the tool. It is waiting for
permission.

Agents constantly redirect scratch output to their own
`/tmp/claude-501/<session>/`. The own instructions of Claude Code tell them to. So
this event happens on ordinary behaviour, not on anything alarming.

The question that this raises is open on purpose. Should an "ask" be a **denial
with a reason** at `lights-out`, where by definition nobody is coming? A denial
keeps the intent of FR-050 exactly, because the action is still not taken. It also
lets the agent adapt, which agents demonstrably do all day against the read-only
policy. A denial changes what FR-029 and FR-050 mean, so it is a decision to take
on purpose and not a fix.

What has changed is that the silence is now legible. The console says when a
question is asked. It says again when it hands the question back to the agent tab,
which is the moment the agent stops.

A feed entry scrolls away, so Foundry also **records** the hand-back. It holds the
session in `strandedAgents` and counts it for as long as its process is alive.
This is why the standing of the order reads `stranded` (_An agent is waiting at its
terminal_) and not `working`. Foundry drops the entry in two cases. The first case
is that the agent asks again, which is what an agent that somebody freed at the
prompt does next. The second case is that the process is gone, which is `adrift`
and a different move.

For 90 minutes on `WO-0909-30a` there was no such record. The builder was parked
at a prompt and its node still said `running`. Every surface drew a working build
over it until the wall-clock budget fired.

### What the settings decide

FR-029 says that every action is held against a decision. The decision is
automatic where the autonomy setting allows it, and asked where it does not.
Claude Code makes that decision now (ADR 131). `src/runtime/role-settings.ts`
gives each role a permission mode and `allow`, `ask` and `deny` rules. Claude
applies them to every subcommand, subshell and control-flow body:

| Calls                                                                                                 | Rule                                                                           |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Pushing, changing a pull request, editing the skills mount, a tool the role file leaves out           | `deny`: never, in every mode                                                   |
| `rm -rf`, `sudo`, `git reset --hard`, `git checkout --`, `git restore`, `git clean`, `git stash drop` | `ask`: the operator decides; refused at `lights-out` (FR-050)                  |
| Every call from a read-only, docs-only or restricted-write role                                       | `default`; Foundry refuses every ask: only what an `allow` rule names runs     |
| Every call from a free writer                                                                         | `auto`, or `acceptEdits` with `letAutoModeDecide` off; `default` at `escorted` |

A refusal answers the ask with the reject option of the agent. It never cancels
the turn, so the agent carries on and does the work another way.

## Two things the runtime does to a supervised run

**Session persistence is forced.** Claude Code sets `CLAUDE_CODE_CHILD_SESSION=1`
in every process it spawns. A nested interactive session with that marker is
excluded from history: "Transcript saving is off". Everything here reads the
transcript. When the console itself starts from a Claude Code session, its agents
would write no transcript. The stall detector, the turn count and the console of
the card would then read empty forever. The runner exports
`CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`, which is the documented override.

**Foundry does not suppress the folder-trust prompt.** The runtime asks you to
trust a directory the first time it runs in that directory. A worktree is a new
directory every time. A fresh run therefore waits at that prompt and says nothing.
No documented flag or settings key pre-answers the prompt. Only `-p` does, and it
would give up the terminal. Nothing here guesses at a flag. The card says that the
run is probably waiting on the prompt and sends you to the agent tab.

## Where state lives

- **In memory** — the run register and the stall firings. A run does not outlive
  the application, because its terminal is a child of this process. A registry
  reloaded from disk would describe runs that no longer exist. What survives is
  the **graph**, not the sessions. See "A run whose agents are gone" for how
  Foundry reconciles the two when the application reopens.
- **On disk**, under `runtime/` in `api.paths.globalStorage` of Foundry — the feed
  (`feed.jsonl`) and the mute rules.
- **In the browser** — when you last read the feed. This belongs to the person who
  looks, not to the runs.

## Testing it

`npx vitest run extensions/foundry` covers the units and the IPC.

The test that matters is `tests/e2e/foundry.spec.ts`. It drives the real extension
inside the real application, through the same IPC that the UI of the extension
uses. It asserts four things. All four surfaces render. An idea becomes an order.
An order that nobody agreed cannot start. The repository is left exactly as it was
found. Every worst bug on this line of work passed its unit tests and appeared
only when the application ran.

## Approved, and then edited

Approving a phase records a hash of its artifacts. One hash covers the whole set,
because `plan` produces three files. Reading the card recomputes the hash. A phase
whose artifacts no longer match is marked **modified**: what is on disk is not what
you approved.

Foundry reads the artifacts **from the worktree of the card**, because the phase
wrote them there. `defaultArtifactPaths` records them against the main checkout,
and they are not there. `git worktree add` checks out a branch. The card directory
that the board created is uncommitted and sits in the main checkout, so it is not
in the worktree, and the agent creates it there. The hash covers the
_repository-relative_ name of each artifact plus its content. Reading the same
artifact from a different checkout is therefore not a change, while renaming an
artifact still is. **Modified** is a different thing from **stale**. Stale means
that something upstream moved, and the board says which.

You can **skip** a phase from its gate and unskip it from the rail. Not every card
needs every phase. Without this option, you would approve something that you did
not read.

## Self-review

Four checks run as separate steps and not as an `&&` chain. For a gate you want
all four answers, not the first failure. Each check records its own exit code.

| Check  | Command                                        | What the gate shows                             |
| ------ | ---------------------------------------------- | ----------------------------------------------- |
| Format | the repository's `format:check`                | pass/fail — **never** `format`, which writes    |
| Lint   | `lint -- --format json --output-file`          | errors and warnings, totalled from the report   |
| Tests  | `vitest --coverage.reporter=json-summary`      | line coverage from `coverage-summary.json`      |
| Review | `/at:google-review` under the read-only policy | pass/fail; it writes prose, so no blocker count |

Every number comes from the own machine-readable report of a tool. A number that a
tool did not report reads as **not measured**, never as zero. A review that says
"0 errors" when it does not know is worse than a review that says nothing. A
repository with no `format:check` or `lint` script gets a step that says it did
not run, and the step fails. In this way "not checked" never looks like "clean".

Foundry writes the exit codes and reports beside the other state of the runtime,
never in the worktree. A review that adds a `coverage/` directory to the diff it
reviews has changed the thing it measures. Foundry does not capture step output.
The output streams to the run console live. Capturing it per step would need
piping, and the status variable of piping differs between bash and zsh.

## When a phase cannot be supervised

Three things drop a run to the headless spawn — `claude --print
--permission-mode bypassPermissions`, an agent that approves its own tool calls
where nobody can see. The first is that the supervision runtime failed to start.
The second is that the repository belongs to no workspace. The third is that there
is no window to put a terminal in. All three raise a notification that names the
card. A log line is not a signal, and a card that ran unsupervised looks exactly
like one that did not.

A terminal that could not open is different. It ends the phase with a failure and
does not run the phase unwatched.

## What is deliberately not here

- **Unattended merge of a P3 change.** The grading is real and Foundry shows it.
  Nothing merges without a person. The extension has no source of CI status, and
  Foundry reports check state as `unavailable` and does not assume it passes. An
  auto-merge could therefore fire only on evidence that nobody has. The policy and
  its audit log were removed. They were not shipped as a promise that the code
  cannot keep.
- **Stale-lane detection after an upstream merge.** It needs per-lane start and
  merge times. Nothing records a lane merging, so nothing could drive the
  detection.

## Incidents behind the code

A comment in the code points here for one reason: the live run that showed why the
code is the way it is.

- `resume` (`src/ipc/run-channels.ts`) keeps the executor that already drives an order. Starting a second executor produced `run.halted: waiting on a gate` three times in 23 seconds on WO-0927-4fd.
- `onPending` (`src/line/node-session.ts`) posts a held question to the console and to the inbox. Before it did, a builder redirected its test output to a scratch file outside the checkout. FR-050 asked about it, and nobody was there. Five minutes later the bridge handed the call back to the agent tab. The run sat until the wall-clock budget ended it half an hour on, and nothing said that a question had been asked.
- `stallInputs` (`src/runtime/evaluate-stall.ts`) counts silence from the later of the last activity and `stateSince`. A session spans turns, and the transcript keeps the tool calls of every turn. A session that got a new turn after a long gap carried the last call of the previous turn as its latest activity. A run twenty-three seconds old was reported silent for twenty-one minutes, and `run.stalled` was on the order before the third command of the builder.
- `runtimeStateDir` (`src/runtime/runtime-state.ts`) is absolute. It used to be `resolveWorktreeBaseDir('')`, which is `join('', '.worktrees')`, a relative path. The `--settings` handed to claude therefore resolved against the worktree where it started. The file was never there, so every supervised run died on "Settings file not found" the moment it launched. The card sat at WORKING with 0 turns, and the console stayed empty.
- `recordStall` (`src/runtime/supervision-runtime.ts`) writes a stall to the ledger of the order and to the console. The detector was timely and nothing consumed it. On a live run the builder fell silent at 07:27:08, and the stall fired at 07:34:21. The run waited until the wall-clock budget stopped it at 07:52:10, eighteen minutes after the console knew. Shadow mode is on by default, so nothing that an operator reads afterwards showed those minutes. The ledger said "budget exceeded".
- `fallbackRecordsBase` (`src/storage-folder.ts`) is never `process.cwd()`. The working directory of the extension host is wherever the application was launched from (in development, the Terminator repository itself). A default to it wrote the orders of one workspace into the working tree of another repository. A `.foundry/` directory in this repository held twelve orders from four different fixtures.
