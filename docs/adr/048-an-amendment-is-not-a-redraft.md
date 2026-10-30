# ADR 048: An amendment is not a redraft

**Status**: Accepted

**Date**: 2026-09-09

## Context

ADR 043 made the architect an agent that proposes the order and never writes it. The Forge made converging a conversation: the operator reads the six checks, and every failing check carries a move that clears it. Two of those moves take you to a control on the screen. The other four redraft, and they carry an instruction to the architect: "the coverage check fails", "ask for a regrade", "ask it to fit the budget".

Each of those moves is a follow-up turn on a document that already exists. None of them said so.

`WO-0910-6ea` was a one-line order to make the application's text red. It had one acceptance criterion and one unit, and a coverage check failed because the unit satisfied nothing. The operator clicked **Ask for the gap to be closed**, which is the smallest possible amendment: one field on one unit. Then the operator waited.

The turn took just under seven minutes and 31 shell commands before the architect wrote anything. Its own account of what it was doing:

> I'll read the existing proposal, the repo's docs, and the actual styling
> surfaces before writing anything.
>
> No proposal yet — let me read the order and ledger to see what the checks
> actually saw.

Neither move was a mistake. Three things forced both:

1. **The architect could not see the order.** `brief()` gates every section on the role's `reads:`. The architect declared `[intent, context]`, not `criteria`, not `unit`, not `order`. It writes `plan` and `acceptance`, and it could read neither. So `coverage — nothing in the plan builds AC-1` arrived as a complaint about a document that was not in the prompt. It named a criterion whose text was not in the prompt either.
2. **The proposal it remembered was gone.** The architect resumes its own conversation, so it remembered that it wrote `proposal.json` last turn. `readProposal` unlinks that file in a `finally` as it applies the proposal. This is deliberate, because a stale proposal read as this turn's answer is what makes a redraft look like it worked. So the architect's memory of the last turn was both the only record it had and a record of a file that no longer existed. It described an order that Foundry had since merged and edited.
3. **The framing told it to start over.** The role prompt opens "Turn intent and context into criteria and a plan." That is the right instruction exactly once. On the fourth turn it arrived again verbatim, over a brief that contained no plan, and it reads as an instruction to derive one.

So the architect did the only thing left. It rebuilt the order by hand from `order.json` and `ledger.jsonl`, on the deep model tier, under a read-only policy, one allowed shell command at a time.

## Decision

Converging distinguishes a first draft from an amendment, and says which one this turn is.

**The architect reads the order it writes.** `roles/architect.yaml` declares `reads: [intent, context, order]`. The fix belongs on the role, not in `convergeBrief`, because `reads:` is the single authority on what a role may see. It is a permission, not a preference. `brief()` then renders the order in full:

- every criterion, with the thing that proves it
- every unit, with its files and what it satisfies
- the coverage matrix as a grid
- the failing checks

The gap that the operator asks about becomes a `·` in a table.

**A turn that amends says so.** `convergeBrief` appends a section after the order and before the operator's own words. The section tells the architect these things:

- This turn amends the document above.
- The document is later than your memory of it.
- The proposal you wrote last turn was consumed when Foundry applied it, so do not look for it.
- Do not rebuild from `order.json` what is already printed.
- Send only the keys you changed.

**`provenance.decisions` tells us whether the turn amends.** That list grows once per applied proposal, and nowhere else while an order is a draft. It is the only honest signal available. A refused turn appends nothing, so the turn after a refusal is still the first draft. Acceptance criteria taken from a ticket at its word are not a plan that the architect wrote, so an order seeded from Linear is still a first draft too. To tell an architect that it wrote something it did not is the same defect as to hide what it did write.

## Alternatives considered

**Render the order in `convergeBrief` and leave `reads:` alone.** This has fewer moving parts, and it works. Rejected: it puts a second authority on what a role may read next to the authority that the design already has, and the failure mode is silent. Strip `order` from the architect tomorrow, and the brief keeps sending it. If the brief gates on `reads.has('order')`, the declaration stays the truth.

**A second, narrow output contract for amendments.** The full contract is about 130 lines of JSON schema, most of it the closed sets that three separate turns have already been lost to (ADR 046). It is tempting to cut it down for a turn that changes one field. Rejected: the schema is what stops a refused document, and the saving is a few hundred tokens against minutes. Two contracts is two places to add the next enum to, which is exactly how the last three were missed.

**Skip the agent for the mechanical remedies.** The application could fix a missing `satisfies` entry without asking anyone. Rejected as a different decision from this one. It would make Foundry write the order directly, which ADR 043 exists to prevent. It is also tractable only for `coverage`. The other three redrafting remedies need judgement.

**Drop the amending turn to the fast model tier.** `modelTier` is declared per role, so this would change the first draft too, which is the turn that most needs the deep tier. A per-turn tier is a larger change than the problem justifies, so this decision does not take it.

## Consequences

An amending brief is about 1,400 characters longer than the draft it replaces: the rendered order, plus the framing. That is the cost, and every turn after the first pays it.

Against that cost, the architect no longer has to find the order before it can change it. On `WO-0910-6ea`, all 31 shell commands went to learn something that the prompt could have told it. The coverage matrix says in one grid what the ledger says across an afternoon of appends.

The problem statement and the order title now appear twice in an amending brief: once from `brief()`'s intent section, and once inside the rendered order. This is four lines. We left them as they are. To suppress them, `brief()` would have to decide what a role sees on the basis of what else it sees. That is the coupling this ADR just removed from the other direction.

A first draft also now carries the rendered order. For a fresh draft, that is mostly `_No criteria yet._` and `_No units yet._`. This is honest, because it is what the order says, and it is about twenty lines.

## Addendum: "send only the keys you changed" held one level deeper

The instruction was true of the proposal's top-level keys and false inside them. `intent`, `risk` and `plan` were each replaced whole, so an amendment that sent `plan.units` alone was refused for `plan.lanes: Required`. On `WO-0927-d2b`, Foundry refused every turn after the first this way.

`ProposalSchema` now takes those three as partial objects, and `applyProposal` merges them key by key over the order. A list inside them is still replaced whole, and the output contract says so. Foundry validates the merged order as before.

While a turn runs, the Forge now disables every control that edits the order. The proposal is merged over the order as it stood when the turn started, so an edit made meanwhile is an edit that the architect never saw.
