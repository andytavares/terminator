# Specification Quality Checklist: One UI Floor for Every Extension

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-05
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

## Notes

Two items warranted a judgement call rather than a clean pass, recorded here rather than
silently ticked:

**"No implementation details" / "written for non-technical stakeholders."** The Context
section names files, class names and counts (`preload-webview.ts`, `.sk-modal`, 14 stacking
values, 19 surfaces). This is deliberate and matches the house convention set by
`032-branch-first-sidebar` and `034-declutter-sidebar`, whose Context sections likewise cite
measured evidence from the build. The audience for specs in this repository is the person
implementing them. The **Requirements** and **Success Criteria** sections — which are what
planning consumes — are free of implementation detail and were revised where they were not:
FR-009 originally prescribed "one shared implementation" and was rewritten to state the
observable requirement (the two surfaces must not diverge) instead.

**Requirements testable and unambiguous.** Three requirements carry an unavoidably
qualitative term — FR-014 ("in plain language"), FR-018 ("MUST NOT occupy the view's primary
space"), FR-033 ("words requiring no legend"). Each is verifiable by review against the
audit's renderings, and each has a corresponding acceptance scenario, so they are testable
even though not mechanically measurable. Left as-is rather than replaced with false precision.
SC-014 was the one genuinely unfalsifiable criterion and was given a number in clarification.

**Zero clarification markers throughout.** Two decisions were originally made on the user's
behalf and recorded in Assumptions rather than blocking spec generation. Both were put to
the user in the `/speckit-clarify` session of 2026-09-05 and are now resolved:

1. Approve-from-queue-row is **retained and demoted** to the row's overflow menu, not removed.
   The feature now withdraws no shipped capability, and SC-011 was rewritten accordingly.
2. The phone-scannable code stands, and now carries the access credential so the everyday
   path never displays it. Dependency selection remains a planning decision under
   Constitution IV.

That session also closed three items that were not previously flagged at all: where dialogs
render (inside the extension's own view, so context stays visible), whether the core app
adopts the same primitives (it does — one implementation product-wide), and a measurable
target for SC-014 (100px, replacing an unfalsifiable "reduced").

**Coverage risk carried forward.** FR-042 exists because the sidebar drag-reorder defect
fixed earlier in this session survived a full unit suite that asserted a mocked store was
called and never that the list rendered. Planning should not satisfy FR-042 with unit
assertions against class names.
