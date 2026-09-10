# ADR 049: An accidental question costs five minutes, not a click

**Status**: Accepted

**Date**: 2026-09-09

## Context

The operator's report was one sentence: _Foundry is still WAY too slow, it's
been plugging away for over an hour on a task that only had <10 acceptance
criteria._

`WO-0910-1fb`, an order whose entire content was **"Make all text in the
application red"**. It ran for eighty-four minutes and shipped nothing.

The ledger and the builder's own transcript account for every one of them:

| Phase                                 | Wall clock                              |
| ------------------------------------- | --------------------------------------- |
| Intake, three converge rounds         | 30m 33s — 20m of it waiting on a person |
| The builder, one node, never finished | 53m 34s                                 |
| — held waiting on a permission        | **16.6 min across 13 calls**            |
| — actually executing                  | 10.1 min across 118 calls               |
| — model thinking and output           | 26.9 min                                |

Halted at 02:19 by the files-touched rule, at 48 against a budget of 42, with
35 files changed and 493 lines written that nobody ever saw.

Thirteen calls of one hundred and thirty-one — ten percent — ate sixty-two
percent of the run's tool time. A held call has a mean of 77 seconds against 5
for one that is taken. That ratio is the whole finding, and it is not a
coincidence: `DEFAULT_ASK_AFTER_MS` is five minutes, so a call this policy asks
about **by accident** does not cost an operator a click. It costs the run five
minutes of dead air and then hands back to a terminal nobody is sitting at.

Re-deciding all 131 calls against the policy as it stood reproduced the split
exactly: every slow call was held, every fast one was taken. Nothing else
correlated.

Four of the five reasons were defects. The fifth was a check working perfectly
and being over-served.

### The commands this policy could not read

**A discard is only a discard with a space after it.** `DISCARDS` ended in
`(?=\s|$)`, so `2>/dev/null ` was recognised and `2>/dev/null;` was not — the
same redirection, spelled the way people actually spell it. The unrecognised
one left `/dev/null` standing as a redirect target, which is outside every
checkout. A bare `ls node_modules 2>/dev/null; …` was held for **322 seconds**.

**A parenthesis inside a quoted argument opened a nesting level.**
`substitution()` counted `(` and `)` without tracking quotes, so
`$(grep -c "var(--$t" a.css)` opened a level nothing closed, the scan ran off
the end, and the shape was reported unreadable. `isDestructive` reads
unreadable as destruction. A read-only `grep` inventory: **276 seconds**.

**A heredoc body was read as shell.** `readShell` knew nothing about heredocs,
so `cat > red-text-palette.spec.ts <<'TESTEOF'` had its body — a spec file with
a JSDoc comment quoting identifiers in backticks, a hundred and six of them —
read as command substitutions. An odd one had no partner, so writing a test
file into the unit's own worktree was called destruction. This is the builder's
single most common operation.

**The harness's own scratchpad was hostile territory.** The runtime an agent
runs inside gives it a scratch directory under the OS temp root and tells it,
in its system prompt, to put intermediate files there. `writesOutside` called
every one of those a write outside the checkout. The agent obeyed its harness;
Foundry charged it five minutes a file.

### The check that was over-served

`checkPicture` fires when a unit touches a `.tsx` or `.css` file and no
criterion asks for a picture of the running application. It is a good rule and
this project has the scars that earned it.

Its failure text named what was missing and never named what was enough. The
architect closed it by inventing **three** screenshot criteria across five
extension panels in two themes. Five acceptance criteria became eight. The
coverage check — which requires every criterion to be built by a unit — then
pulled all five of those panels into `U-1.touches` to keep the matrix complete.
A one-line ask became a 41-file plan.

The architect then budgeted 42 files for that 41-file plan, and `checkBudgets`
passed it, because it asked whether the plan _fits_ and 41 ≤ 42 is a fit. The
builder found seven files the plan had not, reached 48, and the run halted.

Every step there was a check working exactly as written.

## Decision

**An accidental question is a defect, not a cost of doing business.** The
policy asks about destruction and about writes the operator would care to see.
Everything it asks about by accident is priced at five minutes, so reading a
command correctly is a latency requirement and not only a correctness one.

Six changes, in the order of the minutes they return:

1. `DISCARDS` admits every operator the shell can put after `/dev/null` —
   `;`, `|`, `&`, `)` — and not only whitespace.
2. `readShell` skips heredoc bodies. A body is data on its way to stdin; it is
   quoting, which is the one thing this module exists to track.
3. `substitution()` tracks quotes while counting parentheses, exactly as the
   main loop already did.
4. The OS temp roots are **scratch**, not "outside". A throwaway file is
   disposable by definition and cannot damage anything the operator has.
5. `checkPicture` says that **one** criterion closes it, of a surface the plan
   already touches — because every surface a criterion names is one the plan
   then has to touch to stay covered.
6. `checkBudgets` requires headroom: a budget must admit about a quarter more
   than the plan declares. A budget the plan already fills cannot tell an agent
   going wide from an estimate a few files short, and stops the run once the
   work is done rather than before it starts.

Two more, on the same run and the same theme — a signal that costs more than it
is worth:

7. Silence is measured from the later of the last tool call and the start of
   the state the session is in now. A session spans turns, and the transcript
   keeps every turn's calls, so a conversation the operator came back to after
   twenty minutes carried the previous turn's last call as its most recent
   activity. `run.stalled` was on this order **twenty-one seconds** into the
   run, raised against the architect's intake session rather than any run node.
8. A session's `startedAt` moves when it is given a new turn — by
   `continueRun`, by `send`, and when a held call is answered. However long the
   operator took is not the agent's silence.

The architect's role file now carries both intake rules in its own words: write
the smallest set of criteria that decides the ask, and budget with room. A
check that has to be re-run because the architect guessed the rule costs a
converge turn, and this order spent three of them.

## Consequences

**Good.**

- Replaying all 131 of `WO-0910-1fb`'s calls against the fixed policy: **2
  held, 0.4 minutes**, against 13 and 16.6 minutes. Both survivors contain
  `rm -f`, which is a deletion and should ask. That is 16.2 minutes returned on
  a 53-minute run, measured rather than estimated.
- The builder's most common write — a test file with a comment in it — is no
  longer a five-minute hold.
- A run that goes past its files budget now does so with room to have been
  slightly wrong, so the rule fires on an agent going wide, which is the only
  thing it is for.
- A stall means a stall. A detector that fires on a run twenty-one seconds old
  is one you mute, and muting it loses the next real one.

**Bad, and accepted.**

- **The temp roots are a stated hole.** An operator who configures
  `terminator.foundry.dataDir` inside the OS temp directory gives up
  cross-checkout protection along with it: one unit could write into another's
  worktree without asking. The default is `<workdir>/.foundry`, and a data root
  in temp does not survive a reboot, so this is a trade taken deliberately
  rather than a case that was missed. Narrowing it to one scratch directory per
  run would mean deriving the harness's own path convention, which is guessing
  at somebody else's internals.
- `readShell` now knows what a heredoc is, which is the parser growth its own
  header warns against. The line held is that it tracks **quoting** and nothing
  else; a heredoc is quoting. The next thing that looks like shell semantics
  rather than quoting does not get in on this precedent.
- The headroom share is a stated policy and not a derived number. A quarter is
  a judgement about how wrong a plan usually is, and no measurement here
  supports a better one.
- Fixes 5 and 6 are prompt-shaped: they teach the architect through a failure
  message and a role file rather than refusing a bloated order structurally.
  Nothing stops an architect writing eight criteria for a one-line ask; it is
  only no longer being asked to.
- Neither the intake round-trips nor the model's own 26.9 minutes are addressed
  here. Fixing the holds cuts 16.2 minutes from a 53-minute run. It does not
  make it a two-minute run, and nothing in this ADR claims it does.

## References

- `extensions/foundry/src/runtime/shell-split.ts`,
  `src/runtime/autonomy-policy.ts`, `src/runtime/evaluate-stall.ts`,
  `src/runtime/supervised-runner.ts`, `src/order/compile.ts`,
  `roles/architect.yaml`
- `WO-0910-1fb` — the run this is all measured on
- ADR 046 (a refused intake turn is a state) — the previous order to die in
  intake on this same one-line ask
