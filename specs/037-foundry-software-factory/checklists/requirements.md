# Specification Quality Checklist: Foundry — a software factory

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-06
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Validation Record

**Iteration 1** — 2026-09-06. All items pass. Evidence:

- **No implementation details**: scanned for language, framework, tool, file-path, data-format and interface terms; no occurrences. The source material for this feature was an implementation-level design document, so this was the highest-risk item — every schema, path, channel name and module reference was deliberately dropped and restated as observable behaviour. Two borderline items were kept as behaviour rather than mechanism, and both are requirements in their own right: deriving a verdict from a command's exit status rather than its printed summary (FR-037), and per-file rather than project-wide coverage measurement (FR-038). Neither names a tool.
- **No specific tracker is named** anywhere; the feature is specified against "a connected tracker" so it does not encode today's integrations.
- **No [NEEDS CLARIFICATION] markers**: 0. Every open question from the source document was resolved with the recommended option at the operator's instruction, and each resolution is recorded in Assumptions with the trade-off it carries.
- **Testable and unambiguous**: 84 functional requirements, each stating an observable MUST. Two were tightened during this pass — FR-083 originally said a question "the agreed order should have answered", which is a judgement; it now classifies by where the question arose, which is decidable. The risk scale referenced by FR-050 and FR-055 was previously unnamed and is now stated explicitly in Assumptions.
- **Measurable success criteria**: 14, each carrying a number, a percentage or a count. None names a technology.
- **Acceptance scenarios**: 8 prioritised user stories, 62 Given/When/Then scenarios between them, each story independently testable and independently valuable.
- **Edge cases**: 14, drawn from the boundaries the design actually has — an unknown toolchain, an absent convention document, a struck assumption invalidating a plan, a second verification failure, an unreachable remote, an unmapped tracker state, a mid-work budget breach, a cancelled order, a duplicate seed, a dirty tree, concurrent orders on one repository, an unwritable records location, and an unprovable criterion.
- **Scope bounded**: an explicit Out of Scope section names nine exclusions, including multi-user operation, stacked pull requests, automatic merging, workflow write-back for any tracker other than Linear, and any modification of a target repository beyond the requested change.
- **Assumptions**: thirteen, covering all four decisions taken on the operator's behalf, the four budget defaults, the records location behaviour, the reuse of existing application capabilities, the Linear-only scope of workflow write-back, and the staged delivery.

**Iteration 2** — 2026-09-06, after the operator approved the core Extension API addition and scoped workflow write-back to Linear only. All items still pass. Changes:

- **FR-059** now applies to trackers that support being moved; **FR-059a** is new and requires an unsupported capability to be reported when the order is agreed, not when the write is attempted. That distinction is what keeps the requirement testable — "it did not move" and "it was never going to move" are different outcomes and the operator learns the second one before the run.
- **FR-063** now separates a failure (retried) from an unsupported capability (recorded once, never retried).
- Assumptions gained the Linear-only scope, including why the interface stays intent-based with a single implementation: FR-060 gives the operator the intent-to-state mapping, and that indirection is needed with one tracker as much as with two.
- Out of Scope gained workflow write-back for any tracker other than Linear, stated as unsupported rather than partially built.
- Counts re-verified against the file: 84 FRs, 14 SCs, 62 scenarios, 14 edge cases, 13 assumptions, 9 exclusions, 0 clarification markers.

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`. None are incomplete.
- The heaviest constraint on planning is FR-069 through FR-077: the feature must function against a repository with nothing installed into it. Any plan that requires scaffolding, an initialisation step, or a committed configuration file in a target repository contradicts the specification.
- P1 stories (1–4) form a coherent first delivery; P2 (5–6) removes the operator from the loop; P3 (7–8) adds multiple repositories and the learning loop. Each level is shippable alone.
