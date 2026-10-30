# ADR 049: An accidental question costs five minutes, not a click

**Status**: Superseded by ADR 131

**Date**: 2026-09-09

## Context

The operator's report was one sentence: _Foundry is still WAY too slow, it's
been plugging away for over an hour on a task that only had <10 acceptance
criteria._

`WO-0910-1fb` was an order whose entire content was **"Make all text in the application red"**. It ran for eighty-four minutes and shipped nothing.

The ledger and the builder's own transcript account for every minute:

| Phase                                 | Wall clock                              |
| ------------------------------------- | --------------------------------------- |
| Intake, three converge rounds         | 30m 33s — 20m of it waiting on a person |
| The builder, one node, never finished | 53m 34s                                 |
| — held waiting on a permission        | **16.6 min across 13 calls**            |
| — actually executing                  | 10.1 min across 118 calls               |
| — model thinking and output           | 26.9 min                                |

The files-touched rule halted the run at 02:19, at 48 files against a budget of 42. By then the builder had changed 35 files and written 493 lines that nobody ever saw.

Thirteen calls of one hundred and thirty-one, ten percent, ate sixty-two percent of the run's tool time. A held call has a mean of 77 seconds. A call that is taken has a mean of 5. That ratio is the whole finding, and it is not a coincidence. `DEFAULT_ASK_AFTER_MS` is five minutes. So a call that this policy asks about **by accident** does not cost an operator a click. It costs the run five minutes of dead air, and then the run hands back to a terminal that nobody is sitting at.

We re-decided all 131 calls against the policy as it stood. This reproduced the split exactly: Foundry held every slow call and took every fast one. Nothing else correlated.

Four of the five reasons were defects. The fifth was a check that worked perfectly and was over-served.

### The commands this policy could not read

**A discard is only a discard with a space after it.** `DISCARDS` ended in `(?=\s|$)`. So the policy recognised `2>/dev/null ` and did not recognise `2>/dev/null;`. These are the same redirection, spelled the way people actually spell it. The unrecognised form left `/dev/null` standing as a redirect target, which is outside every checkout. Foundry held a bare `ls node_modules 2>/dev/null; …` for **322 seconds**.

**A parenthesis inside a quoted argument opened a nesting level.** `substitution()` counted `(` and `)` without tracking quotes. So `$(grep -c "var(--$t" a.css)` opened a level that nothing closed. The scan ran off the end, and the policy reported the shape as unreadable. `isDestructive` reads unreadable as destruction. A read-only `grep` inventory was held for **276 seconds**.

**A heredoc body was read as shell.** `readShell` knew nothing about heredocs. So it read the body of `cat > red-text-palette.spec.ts <<'TESTEOF'` as command substitutions. The body was a spec file with a JSDoc comment that quoted identifiers in backticks, a hundred and six of them. One backtick had no partner, so the policy called the write of a test file into the unit's own worktree destruction. This is the builder's single most common operation.

**The harness's own scratchpad was hostile territory.** The runtime that an agent runs inside gives the agent a scratch directory under the OS temp root. It tells the agent, in its system prompt, to put intermediate files there. `writesOutside` called every one of those a write outside the checkout. The agent obeyed its harness, and Foundry charged it five minutes a file.

### The check that was over-served

`checkPicture` fires when a unit touches a `.tsx` or `.css` file and no criterion asks for a picture of the running application. It is a good rule, and this project has the scars that earned it.

Its failure text named what was missing and never named what was enough. The architect closed the check by inventing **three** screenshot criteria across five extension panels in two themes. Five acceptance criteria became eight. The coverage check requires a unit to build every criterion. It then pulled all five of those panels into `U-1.touches` to keep the matrix complete. A one-line ask became a 41-file plan.

The architect then budgeted 42 files for that 41-file plan, and `checkBudgets` passed it, because it asked whether the plan _fits_, and 41 ≤ 42 is a fit. The builder found seven files that the plan had not, reached 48, and the run halted.

Every step there was a check that worked exactly as written.

## Decision

**An accidental question is a defect. It is not a cost of doing business.** The policy asks about destruction and about writes that the operator would care to see. Five minutes is the price of everything it asks about by accident. So reading a command correctly is a latency requirement as well as a correctness requirement.

We make six changes, in the order of the minutes they return:

1. `DISCARDS` admits every operator the shell can put after `/dev/null` (`;`, `|`, `&`, `)`), not only whitespace.
2. `readShell` skips heredoc bodies. A body is data on its way to stdin. It is quoting, and quoting is the one thing this module exists to track.
3. `substitution()` tracks quotes while it counts parentheses, exactly as the main loop already did.
4. The OS temp roots are **scratch**, not "outside". A throwaway file is disposable by definition. It cannot damage anything the operator has.
5. `checkPicture` says that **one** criterion closes it, of a surface that the plan already touches. Every surface that a criterion names is a surface that the plan then has to touch to stay covered.
6. `checkBudgets` requires headroom: a budget must admit about a quarter more than the plan declares. A budget that the plan already fills cannot tell an agent going wide from an estimate a few files short. It stops the run once the work is done, not before the work starts.

Two more changes come from the same run and the same theme: a signal that costs more than it is worth.

7. Foundry measures silence from the later of two points: the last tool call, and the start of the state that the session is in now. A session spans turns, and the transcript keeps every turn's calls. So when the operator came back to a conversation after twenty minutes, the previous turn's last call counted as its most recent activity. `run.stalled` fired on this order **twenty-one seconds** into the run. It fired against the architect's intake session, not against any run node.
8. A session's `startedAt` moves when the session gets a new turn: through `continueRun`, through `send`, and when someone answers a held call. The time the operator took is not the agent's silence.

The architect's role file now carries both intake rules in its own words: write the smallest set of criteria that decides the ask, and budget with room. A check that Foundry has to re-run because the architect guessed the rule costs a converge turn, and this order spent three of them.

## Consequences

**Good.**

- We replayed all 131 of `WO-0910-1fb`'s calls against the fixed policy. It held **2 calls for 0.4 minutes**, against 13 calls and 16.6 minutes. Both survivors contain `rm -f`, which is a deletion and should ask. That returns 16.2 minutes on a 53-minute run. We measured this. We did not estimate it.
- The builder's most common write, a test file with a comment in it, is no longer a five-minute hold.
- A run that goes past its files budget now does so with room to have been slightly wrong. So the rule fires on an agent going wide, which is the only thing it is for.
- A stall means a stall. A detector that fires on a run twenty-one seconds old is a detector you mute, and muting it loses the next real one.

**Bad, and accepted.**

- **The temp roots are a stated hole.** Suppose an operator configures `terminator.foundry.dataDir` inside the OS temp directory. That operator gives up cross-checkout protection along with it: one unit could write into another's worktree without asking. The default is `<workdir>/.foundry`, and a data root in temp does not survive a reboot. So we took this trade deliberately. It is not a case that we missed. To narrow it to one scratch directory per run, we would have to derive the harness's own path convention, which is guessing at somebody else's internals.
- `readShell` now knows what a heredoc is. This is the parser growth that its own header warns against. We hold one line: it tracks **quoting** and nothing else, and a heredoc is quoting. The next thing that looks like shell semantics, and not quoting, does not get in on this precedent.
- The headroom share is a stated policy. It is not a derived number. A quarter is a judgement about how wrong a plan usually is, and no measurement here supports a better one.
- Fixes 5 and 6 are prompt-shaped. They teach the architect through a failure message and a role file. They do not refuse a bloated order structurally. Nothing stops an architect from writing eight criteria for a one-line ask. The architect is only no longer being asked to.
- This ADR addresses neither the intake round-trips nor the model's own 26.9 minutes. Fixing the holds cuts 16.2 minutes from a 53-minute run. It does not make the run take two minutes, and nothing in this ADR claims it does.

## References

- `extensions/foundry/src/runtime/shell-split.ts`,
  `src/runtime/autonomy-policy.ts`, `src/runtime/evaluate-stall.ts`,
  `src/runtime/supervised-runner.ts`, `src/order/compile.ts`,
  `roles/architect.yaml`
- `WO-0910-1fb` — the run this is all measured on
- ADR 046 (a refused intake turn is a state) — the previous order to die in
  intake on this same one-line ask
