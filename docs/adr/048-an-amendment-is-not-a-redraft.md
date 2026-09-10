# ADR 048: An amendment is not a redraft

**Status**: Accepted

**Date**: 2026-09-09

## Context

ADR 043 made the architect an agent that proposes the order and never writes
it, and the Forge made converging a conversation: the operator reads the six
checks, and every failing one carries a move that clears it. Two of those moves
take you to a control on the screen. The other four redraft, carrying an
instruction to the architect — "the coverage check fails", "ask for a regrade",
"ask it to fit the budget".

Each of those is a follow-up turn on a document that already exists. None of
them said so.

`WO-0910-6ea`, a one-line order to make the application's text red. One
acceptance criterion, one unit, and a coverage check failing because the unit
satisfied nothing. The operator clicked **Ask for the gap to be closed** — the
smallest possible amendment, one field on one unit — and waited.

The turn took just under seven minutes and 31 shell commands before the
architect wrote anything. Its own account of what it was doing:

> I'll read the existing proposal, the repo's docs, and the actual styling
> surfaces before writing anything.
>
> No proposal yet — let me read the order and ledger to see what the checks
> actually saw.

Neither move was a mistake. Both were forced:

1. **The architect could not see the order.** `brief()` gates every section on
   the role's `reads:`, and the architect declared `[intent, context]` — not
   `criteria`, not `unit`, not `order`. It writes `plan` and `acceptance` and
   could read neither. So `coverage — nothing in the plan builds AC-1` arrived
   as a complaint about a document that was not in the prompt, naming a
   criterion whose text was not in the prompt either.
2. **The proposal it remembered was gone.** The architect resumes its own
   conversation, so it remembered writing `proposal.json` last turn.
   `readProposal` unlinks that file in a `finally` as it applies it —
   deliberately, because a stale proposal read as this turn's answer is what
   makes a redraft look like it worked. Its memory of the last turn was
   therefore both the only record it had and a record of a file that no longer
   existed, describing an order that had since been merged and edited.
3. **The framing told it to start over.** The role prompt opens "Turn intent
   and context into criteria and a plan." That is the right instruction exactly
   once. Re-sent verbatim on the fourth turn, over a brief containing no plan,
   it reads as an instruction to derive one.

So it did the only thing left: reconstructed the order from `order.json` and
`ledger.jsonl` by hand, on the deep model tier, under a read-only policy, one
allowed shell command at a time.

## Decision

Converging distinguishes a first draft from an amendment, and says which one
this turn is.

**The architect reads the order it writes.** `roles/architect.yaml` declares
`reads: [intent, context, order]`. The fix belongs on the role rather than in
`convergeBrief`, because `reads:` is the single authority on what a role may
see — a permission, not a preference. `brief()` then renders the order in full:
every criterion with the thing that proves it, every unit with its files and
what it satisfies, the coverage matrix as a grid, and the failing checks. The
gap the operator is asking about becomes a `·` in a table.

**A turn that amends says so.** `convergeBrief` appends a section after the
order and before the operator's own words: this turn amends the document above,
the document is later than your memory of it, the proposal you wrote last turn
was consumed when it was applied so do not go looking for it, do not
reconstruct from `order.json` what is already printed, and send only the keys
you changed.

**Whether it amends is read from `provenance.decisions`.** That list grows once
per applied proposal and nowhere else while an order is a draft. It is the only
honest signal available: a refused turn appends nothing, so the turn after a
refusal is still the first draft; and acceptance criteria taken from a ticket
at its word are not a plan the architect wrote, so an order seeded from Linear
is still a first draft too. Telling an architect it wrote something it did not
is the same defect as hiding what it did write.

## Alternatives considered

**Render the order in `convergeBrief` and leave `reads:` alone.** Fewer moving
parts, and it works. Rejected because it puts a second authority on what a role
may read next to the one the design already has, and the failure mode is
silent: strip `order` from the architect tomorrow and the brief keeps sending
it. Gating on `reads.has('order')` means the declaration stays the truth.

**A second, narrow output contract for amendments.** The full contract is about
130 lines of JSON schema, most of it the closed sets that three separate turns
have already been lost to (ADR 046). Tempting to cut it down for a turn that
changes one field. Rejected: the schema is what stops a refused document, the
saving is a few hundred tokens against minutes, and two contracts is two places
to add the next enum to — which is exactly how the last three were missed.

**Skip the agent for the mechanical remedies.** A missing `satisfies` entry
could be fixed by the application without asking anyone. Rejected as a
different decision than this one: it would make Foundry write the order
directly, which ADR 043 exists to prevent, and it is only tractable for
`coverage`. The other three redrafting remedies need judgement.

**Drop the amending turn to the fast model tier.** `modelTier` is declared per
role, so this would change the first draft too — the turn that most needs the
deep tier. A per-turn tier is a larger change than the problem justifies and is
not taken here.

## Consequences

An amending brief is about 1,400 characters longer than the draft it replaces —
the rendered order, plus the framing. That is the cost, and it is paid on every
turn after the first.

Against it: the architect no longer has to find the order before it can change
it. The 31 shell commands on `WO-0910-6ea` were all of them spent learning
something the prompt could have told it, and the coverage matrix says in one
grid what the ledger says across an afternoon of appends.

The problem statement and the order title now appear twice in an amending
brief — once from `brief()`'s intent section, once inside the rendered order.
Four lines, left as they are: suppressing them would mean `brief()` deciding
what a role sees on the basis of what else it sees, which is the coupling this
ADR just removed from the other direction.

A first draft also now carries the rendered order, which for a fresh draft is
mostly `_No criteria yet._` and `_No units yet._`. That is honest — it is what
the order says — and it is about twenty lines.
