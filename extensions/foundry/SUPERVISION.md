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

| Section     | Reads                                      | Answers                                |
| ----------- | ------------------------------------------ | -------------------------------------- |
| **runs**    | `foundry:supervision-snapshot`             | what is running, and how it is going   |
| **stalls**  | `foundry:stalls-list`                      | what stopped making progress           |
| **review**  | `foundry:supervision-snapshot`             | what is waiting on a decision from you |
| **feed**    | `foundry:feed-list`, `foundry:feed-digest` | what happened while you were away      |
| **history** | `foundry:supervision-snapshot`             | what is over, and what it did          |

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

The **command palette** (`Cmd+P`) carries every live run and every queued diff, worst
state first — `waiting`, `stalled`, `ready`, `working`. Choosing one focuses the
window and lands on the thing: a run's terminal if it still has one, otherwise
the panel opened on it.

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
falls back to the terminal. Six reads was half an hour of waiting, with the
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

## Trusting the folder, or the agent never starts

Claude Code shows a workspace trust dialog for a directory it has not seen, and
its documentation is explicit that the dialog "appears in interactive sessions
only and is bypassed in non-interactive `claude -p` or SDK runs". Foundry runs
interactively on purpose — an agent in a terminal you can go and type at is the
whole design — so every launch meets that dialog.

An agent sitting at it looks exactly like one hard at work: the process is up,
the run register holds it, the graph says `running`, the stall detector counts
its silence as thinking. It has simply never started. The live run that found
this had an agent at 0% CPU with no transcript at all.

`runtime/workspace-trust.ts` sets `projects["<repo>"].hasTrustDialogAccepted` in
`~/.claude.json`, which is the mechanism the documentation names for granting it
without a prompt. Three things about how:

- **Keyed to the repository, not the worktree.** "Trust is keyed to the git
  repository root (or main checkout root in worktrees)" — an entry for the
  worktree path would do nothing at all.
- **Additive, and never creating.** It sets one boolean on one project entry and
  leaves every other key and every other project alone. It will not create
  `~/.claude.json`: a machine with no Claude Code configuration is one where a
  run was never going to work, and inventing the operator's config file is not
  this extension's business.
- **Recorded.** `workspace.trusted` goes in the ledger, because amending the
  operator's own configuration is something they should be able to find, even
  though it is the answer they would have given the dialog themselves.

## A fresh agent, not the parent's session

Terminator launched from a Claude Code terminal passes its whole environment
down: Electron inherits the shell, the pty inherits Electron, and `claude`
inherits the pty. So an agent came up carrying the **parent's** identity —
`CLAUDE_CODE_BRIDGE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET` and
`CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_SESSION_ID`.

It then did exactly what those variables told it to: joined the parent's bridge
session, sat at `lastSequenceNum: 0`, and waited for instructions only the
parent could send. No turn, no tool call, no output — five open connections to
the API and 0% CPU. From the console it was indistinguishable from an agent
thinking hard. Four live runs died on it before the transcript's
`bridge-session` line gave it away.

`CLAUDE_CODE_CHILD_SESSION` was already known about, and worked around with
`CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1` so that a nested session still writes
a transcript. That was one of a family, found because it broke something
visible. The launch script now unsets the rest before `exec`.

Identity and transport only. A preference such as `CLAUDE_EFFORT` is the
operator's and is left alone.

## The launch is a file, not a typed line

A terminal in canonical mode silently drops or corrupts anything past
`MAX_CANON` on a single line — **1024 bytes on macOS**. The launch is
`claude … <the whole brief>`, and a brief is a role prompt plus a work order,
which is always longer than that. Typed, it arrived like this — read off a live
agent's own argv:

```
# Read the session TTL from the environment\n\nWork ordeWork ordeWork orde
…×15… WorkTL_MS reads SESSION_TTL_MS …
```

A fragment of the order repeated fifteen times, then cut off mid-word. **Every
agent this runtime launched was handed a brief like that**, and nothing could
see it: the terminal renders the first line correctly, so an assertion that
`claude --session-id` is visible passes; the process starts, so the run
register, the stall detector and the run graph all report it running. It simply
does the wrong work — or, in the run that found this, sits at 0% CPU with no
transcript at all for half an hour.

So the launch is written to `<stateDir>/launch/<session>.sh` and the terminal is
told to run that file. The script `cat`s itself through a quoted heredoc before
`exec`, so the whole command still appears in the terminal and what an agent was
told is readable there — which is the point of running it in a terminal at all.

The guard is the one that matters rather than the one that is easy: no line the
runner types may reach `MAX_CANON`.

`continueRun` still types, because by then the agent owns the terminal and its
TUI reads in raw mode rather than canonical — a different discipline, without
that limit.

## One conversation per lane

A lane keeps **one Claude session per role**. A role continuing its own work
resumes it — the executor hands `start` a `resumeSessionId` and the launch
becomes `claude --resume <id>` — so a builder taking a second unit in the lane
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

Approving a phase takes its diff off the review queue and its run off the live
list, and writes a row into **history** instead.

Neither happened before. The queue kept offering work that had already been
accepted — and since the queue is what backpressure counts, three approved
phases were enough to refuse the next run outright. The run list, meanwhile, was
the only record there was, so it stacked every finished phase forever and by the
third card answered "what has this workspace ever done" rather than "what is
happening now".

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

The refusal appears in the Forge, with **Start anyway** next to it. Overriding
is one click and is recorded twice — in the order's own ledger as
`backpressure.overridden`, and in `foundry-runtime/backpressure-overrides.jsonl`
— both carrying **the queue depth at the moment it was ignored**, so the debt
built by overriding is visible afterwards rather than only felt.

`run.start` is what asks. It did not, for the whole of this feature's first
life: the gate was built, the Floor showed its verdict, and nothing consulted
it — so runs began regardless and the override had nothing to override. This
section described the behaviour anyway.

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
off with `terminator.foundry.stallShadowMode`.

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

A run is launched with `--permission-mode auto` and, when one is chosen,
`--model`.

**The autonomy ladder still decides first.** A `PreToolUse` hook runs under every
permission mode and its `allow`/`deny` is honoured before the mode is consulted
at all, so the ladder's judgement is unchanged. What the mode picks up is only
what the ladder _abstains_ on — and under `default` that was a prompt. A single
phase routinely asked twenty-five times. Under `auto` the runtime's own
classifier answers those instead, so the questions that reach you are the ones
the ladder actually wanted a person for.

### An "ask" has no unattended resolution

This is worth knowing before turning `lights-out` on, because for a whole
session it looked like Claude Code hanging at random.

When the ladder abstains, the call is held and the operator is asked. If nobody
answers within five minutes the bridge **hands the call back** — which means
Claude Code puts its own prompt in the terminal instead. That is the right
answer when somebody is at the console. When nobody is, the agent waits at that
prompt for ever, and only the wall-clock budget ends the run.

Measured on a live run:

|           |                                                                  |
| --------- | ---------------------------------------------------------------- |
| 09:11:49  | the builder runs `npm test > /tmp/claude-501/…`                  |
|           | a redirect outside the checkout, so FR-050 asks                  |
| ~09:16:49 | nobody answers; the call is handed back to the terminal's prompt |
| 09:19:17  | the stall detector notices silence                               |
| 09:41     | the wall-clock budget ends the run                               |

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
question is asked, and says again when it is handed back to the terminal, which
is the moment the agent stops.

### What the ladder takes for itself

FR-029 says every action is held against a decision — _automatic where the
autonomy setting allows it_, and by asking where it does not. `src/runtime/autonomy-policy.ts`
is the automatic half:

|                                                                                                                                    |                              |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Destructive** — `rm`, `git reset --hard`, `git clean -fd`, a force push, a `-D` branch delete, or a command built inside another | **never automatic** (FR-050) |
| **Writes outside the unit's own checkout**, including a shell redirection to a path outside it                                     | **never automatic**          |
| Anything else, at `escorted`                                                                                                       | asks                         |
| Anything else, at `standard` or `lights-out`                                                                                       | taken, and recorded          |

**Never automatic means asked where somebody can answer, and refused where
nobody can.** At `escorted` and `standard` these two hold the call and ask. At
`lights-out` there is by definition nobody to ask, and a held call becomes a
half-hour of silence: the question goes to the operator, five minutes later to
the runtime's own prompt in the terminal, and the agent stands at that prompt
until the wall-clock budget ends the run. Watched live — the builder redirected
its test output to a scratch file, which is outside the checkout and so worth a
question, and thirty minutes later the order had shipped nothing.

So at `lights-out` the same two are **refused, with the reason**, and the agent
does the work another way. Nothing became more permissive: the action does not
happen either way, and that is the property to hold on to. What changed is that
the agent is told, instead of left standing at a prompt nobody will ever reach.
The reason names the alternative — "write inside the worktree instead" — because
a refusal an agent cannot act on wastes the turn it was given to adapt.

**Every segment is judged, rather than every compound refused** — the same
correction the read-only policy needed, and for the same reason. Reading
`git status` off the front of `git status; rm -rf .` reads the wrong command,
so the answer is to read _all_ of it: a joined command whose second half
destroys is caught by that half.

Refusing the shape instead does not stop at the dangerous ones.
`pwd && git rev-parse --abbrev-ref HEAD && git status --short` and
`npm test 2>&1 | tail -20` are the ordinary sentences every agent writes, and
each was called destruction and sent to the operator at every setting,
lights-out included. Watched live: a builder's first two tool calls were held,
and it sat there while the graph said `running` and the worktree stayed clean.

**A substitution is read, not refused.** `$(…)` and backticks were treated as
unreadable — "whatever they expand to is not in front of us". The result is
not; the command is, right there in the text. So their contents are read and
judged as commands of their own, nesting included: `cd "$(pwd)"` is ordinary
work, `echo $(rm -rf /)` asks because `rm -rf /` does, and single quotes stay
text because a shell expands nothing inside them. Only one that cannot be read
to the end — an unbalanced `$(` — is refused outright, which is the single case
the old rule was right about.

Refusing the shape cost a live run: the builder's second command was
`cd "$(pwd)" && cat -n src/session.js`, it was called destruction and sent to
an operator who was not there, and it sat for eighteen minutes until the
wall-clock budget stopped the run with an empty worktree.

Both policies read commands through `runtime/shell-split.ts`, which tracks
quoting and escaping and nothing else. It is not a shell parser and must not
grow into one — it exists so that punctuation inside an argument stops being
read as punctuation belonging to the shell.

A redirection is a write of the file it names, and it names that file in the
command rather than in a tool's path field. While every command containing `>`
was destructive, that was covered by accident; it is read properly now, so
`> /etc/hosts` asks and `> notes.txt` and `2>/dev/null` do not.

This half was missing, and it is not a small thing: without it a builder's
first `Edit` went to the operator at every setting, so no run could finish
unattended and "lights-out" named something the factory could not do. A live
run sat for half an hour with a clean worktree and an agent waiting on a click
nobody was there to make.

**The model is an alias, not a pinned id.** `--model opus` is documented as
resolving to the latest of that family, so the default cannot go a generation
stale sitting in the source — which is exactly what the pinned `claude-opus-4-6`
it replaces did. Choosing nothing passes no `--model` at all, so the run follows
your own Claude Code configuration.

The picker reads `foundry:models-list`: the aliases always, plus every model the
account can reach from `GET /v1/models` when the environment carries an
`ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`. There is no CLI subcommand that
lists models, and a subscription login is not a Models API credential, so for
most people the aliases are the whole list — which is why they are the ones that
have to keep working.

The choice is persisted through `foundry:model-set` into the extension's own
settings, because the main process is the only thing that builds a `claude`
command line. It previously lived only in the renderer's `localStorage`, which
is why the setting existed, rendered, and did nothing at all.

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
waiting on it and sends you to the terminal.

## Where state lives

- **In memory** — the run register, the review queue, the stall firings. A run
  does not outlive the application: its terminal is a child of this process, and
  a registry reloaded from disk would describe runs that no longer exist.
- **On disk**, under `userData/foundry-runtime/` — the feed
  (`feed.jsonl`), backpressure overrides, mute rules, and the per-session
  `--settings` files and hook script.
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

| Check  | Command                                     | What the gate shows                             |
| ------ | ------------------------------------------- | ----------------------------------------------- |
| Format | the repository's `format:check`             | pass/fail — **never** `format`, which writes    |
| Lint   | `lint -- --format json --output-file`       | errors and warnings, totalled from the report   |
| Tests  | `vitest --coverage.reporter=json-summary`   | line coverage from `coverage-summary.json`      |
| Review | `/google-review` under the read-only policy | pass/fail; it writes prose, so no blocker count |

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
