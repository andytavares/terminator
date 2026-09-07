# ADR 040: The work order is the only contract between intake and execution

**Status**: Accepted

**Date**: 2026-09-06

**Supersedes**: ADR-010 (the SpecKit Pilot card model) and ADR-012 (SpecKit run modes and reset)

## Context

The SpecKit Pilot had a card, and the card had a pipeline: ten named phases,
each with a prompt, each with an approval gate. A card was a feature directory,
a tracker issue and a run at once; a phase was a slash command; and the operator
approved every phase before the next one started.

Measured on a one-line change, that cost **nine decisions**: eight phase
approvals and a merge. None of the eight was a decision in any useful sense —
each was "yes, continue", pressed on evidence the operator had not read,
because there was nothing at a phase boundary worth reading. Approving nine
things you have not read is not oversight; it is a habit that makes the one
decision that mattered look like the other eight.

The phases were also a shape, not a truth. "Constitution → Specify → Clarify →
Plan → Checklist → Tasks → Analyze → Implement → Self-review → Open PR" is one
way to do work, developed for this repository. A one-line CSS fix ran through
it. A ten-repository migration ran through the same one. Anything that did not
fit the shape did not fit the tool.

Three further things followed from the card model and were each their own
problem:

- **A card was defined by a directory.** `specs/<slug>/` with `.pilot/state.json`
  inside it. So the tool only worked in a repository laid out that way, and
  running it left files behind in the repository it worked on.
- **The contract between intake and execution was a phase name.** The runner
  looked at `state.json`, decided which phase was next, and dispatched a slash
  command. What "done" meant for a phase was whatever the command printed.
- **Nothing was checkable.** "The spec is ready" was a person's opinion, taken
  at a gate, on a document nobody could refuse mechanically.

## Decision

There is one object between intake and execution: the **work order**. Nothing
else crosses that line — no phase name, no state file, no directory layout, no
card.

Two loops, one contract:

- **The Forge** converges an idea or a tracker issue into a work order and may
  hand it off only when six checks pass. The checks are mechanical: no open
  questions, every criterion falsifiable, coverage complete in both directions
  (every criterion has a unit and every unit has a criterion), risk graded
  against this plan, red-team findings resolved, budgets set. "Ironed out"
  stops being a feeling.
- **The Line** takes the agreed order, chooses a shape of work — a _recipe_,
  which is data — and runs it, with typed roles, verdicts produced by somebody
  other than whoever did the work, and interruptions raised by named rules
  rather than by phase boundaries.

The ten phases are not deleted as an idea: they are one recipe, `speckit.yaml`,
sitting beside `direct`, `standard` and the others. What was hardcoded is now
selectable, and a recipe can come from the operator's own data directory or
from the repository's `.foundry/` without either being required.

Nine decisions became **nought to two** on the same change, because nothing
stops unless a rule fires.

## Consequences

**Good.**

- The contract is validated on every read (zod, at every boundary), so an
  agent-written order that is malformed is refused rather than half-understood.
- The order is a document a person can read and argue with, which the phase
  state machine never was.
- The shape of work is data, so a new one is a YAML file rather than a change
  to a union type and three prompt tables.
- Nothing is written into the repository being worked on (ADR-042).

**Bad, and accepted.**

- A large deletion: seventeen board components, a ten-value phase union, three
  prompt tables, the phase state machine, the card model, and 24 IPC channels.
  Work that was in flight under the old model has no migration; there was none
  in flight, and writing one for a single-operator tool nobody else runs would
  have been ceremony.
- The recipe layer is genuinely more machinery than a fixed pipeline. It earns
  it by making the pipeline optional, but a reader meeting `recipes/`,
  `roles/` and `rules/` for the first time has three vocabularies to learn
  where before there was one.
- Six compile checks can refuse an order the operator believes is fine. That is
  the point, and it will occasionally be wrong; the escape hatch (accepting a
  criterion as unverifiable) costs a written reason on purpose.

## References

- `specs/037-foundry-software-factory/spec.md`
- `specs/037-foundry-software-factory/contracts/work-order.md`
- ADR 041 (an extension may move an issue), ADR 042 (Foundry installs nothing)
