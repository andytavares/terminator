# ADR 040: The work order is the only contract between intake and execution

**Status**: Accepted

**Date**: 2026-09-06

**Supersedes**: ADR-010 (the SpecKit Pilot card model) and ADR-012 (SpecKit run modes and reset)

## Context

The SpecKit Pilot had a card, and the card had a pipeline of ten named phases. Each phase had a prompt and an approval gate. A card was a feature directory, a tracker issue and a run at once. A phase was a slash command. The operator approved every phase before the next one started.

On a one-line change we measured **nine decisions**: eight phase approvals and a merge. None of the eight was a decision in any useful sense. Each was "yes, continue", pressed on evidence the operator had not read, because a phase boundary had nothing worth reading. Approving nine things you have not read is not oversight. It is a habit that makes the one decision that mattered look like the other eight.

The phases were also a shape, not a truth. "Constitution → Specify → Clarify → Plan → Checklist → Tasks → Analyze → Implement → Self-review → Open PR" is one way to do work, developed for this repository. A one-line CSS fix ran through it. A ten-repository migration ran through the same pipeline. Anything that did not fit the shape did not fit the tool.

Three more problems followed from the card model. Each was a problem in its own right:

- **A directory defined a card.** It was `specs/<slug>/` with `.pilot/state.json` inside it. So the tool worked only in a repository laid out that way, and running it left files behind in the repository it worked on.
- **The contract between intake and execution was a phase name.** The runner read `state.json`, decided which phase was next, and dispatched a slash command. "Done" for a phase meant whatever the command printed.
- **Nothing was checkable.** "The spec is ready" was a person's opinion, given at a gate, on a document that nobody could refuse mechanically.

## Decision

One object sits between intake and execution: the **work order**. Nothing else crosses that line: no phase name, no state file, no directory layout, no card.

Two loops share one contract:

- **The Forge** converges an idea or a tracker issue into a work order. It can hand the order off only when six checks pass. The checks are mechanical:

  - no open questions
  - every criterion falsifiable
  - coverage complete in both directions (every criterion has a unit and every unit has a criterion)
  - risk graded against this plan
  - red-team findings resolved
  - budgets set

  "Ironed out" stops being a feeling.

- **The Line** takes the agreed order and chooses a shape of work, called a _recipe_, which is data. It runs the recipe with typed roles. Someone other than whoever did the work produces the verdicts. Named rules raise the interruptions, not phase boundaries.

The ten phases survive as one recipe, `speckit.yaml`, beside `direct`, `standard` and the others. What was hardcoded is now selectable. A recipe can come from the operator's own data directory or from the repository's `.foundry/`. Neither source is required.

On the same change, nine decisions became **nought to two**, because nothing stops unless a rule fires.

## Consequences

**Good.**

- Every read validates the contract (zod, at every boundary). A malformed agent-written order is refused, not half-understood.
- The order is a document that a person can read and argue with. The phase state machine never was.
- The shape of work is data. A new shape is a YAML file, not a change to a union type and three prompt tables.
- Foundry writes nothing into the repository being worked on (ADR-042).

**Bad, and accepted.**

- A large deletion: seventeen board components, a ten-value phase union, three prompt tables, the phase state machine, the card model, and 24 IPC channels. Work in flight under the old model has no migration. None was in flight, and a migration for a single-operator tool that nobody else runs would have been ceremony.
- The recipe layer is more machinery than a fixed pipeline. It earns this by making the pipeline optional. A reader who meets `recipes/`, `roles/` and `rules/` for the first time must learn three vocabularies where there was one.
- Six compile checks can refuse an order that the operator believes is fine. That is the point, and the checks will occasionally be wrong. The escape hatch (accepting a criterion as unverifiable) costs a written reason on purpose.

## References

- `specs/037-foundry-software-factory/spec.md`
- `specs/037-foundry-software-factory/contracts/work-order.md`
- ADR 041 (an extension may move an issue), ADR 042 (Foundry installs nothing)
