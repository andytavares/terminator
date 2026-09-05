# Specification Quality Checklist: Declutter the Sidebar, and a Board for the Fleet

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

## Validation Notes

### Iteration 1 — issues found and fixed

1. **Component and file names in the Context section.** The first draft named `UnifiedSidebar`, `SessionGroup`, `OverviewScreen` and CSS class names as evidence. Rewritten to describe what a user sees — "four stacked bands of chrome", "a terminal row can carry ten elements in a 24px strip" — so the evidence survives without naming internals. Pixel heights and element counts are retained: they are observable on screen and are what makes the complaint measurable.
2. **Three open scope questions.** Whether the sidebar keeps terminal rows, what becomes of the repo colour system, and what happens to the app band each had multiple defensible answers with materially different deliverables. All three were put to the user before drafting and answered: stop at the branch, one rail with no washes, icons-only app band. No `[NEEDS CLARIFICATION]` markers remain.
3. **The board arrived mid-draft and changed the priority stack.** It was added as US2 at P1, not as a trailing nice-to-have, because US1 removes the surface that answered "which terminal is in what state" and the board is what replaces it. The two are stated as mutually dependent in Context. `Out of Scope` previously excluded a board layout; that line was removed.
4. **Unbounded success criteria.** "Fewer elements" and "less chrome" were replaced with counted thresholds (six per branch row, three per repo header, at least 60% fewer rows, at least 40% less vertical chrome) so each is verifiable from a screenshot.
5. **Deletion made explicit.** FR-025 requires anything that cannot be re-homed to be removed with its controls and tests and named in the PR, rather than left wired-but-inert. The stale-terminal multi-select and bulk close are called out by name in Edge Cases as the concrete case this applies to.

### Deliberate judgement calls

- **Element counts are treated as requirements, not guidance.** FR-026 and FR-027 give hard numbers. A budget that can be argued down during implementation is how the sidebar reached thirteen elements per header in the first place.
- **Success criteria lean on a naive observer.** SC-004, SC-005, SC-008 and SC-011 are phrased as "a person who has not used the app". This is carried over from 032's SC-001, which is the house style here and is the only honest test of whether a glyph reads.
- **The contrast guarantee is retargeted, not dropped.** 033 shipped tests asserting WCAG AA across all ten preset colours in both themes. FR-044 keeps that guarantee and points it at the new surfaces, so removing the washes cannot quietly remove the guarantee with them.

### Open risk for the planning phase, not blocking

- The board's card must not regress the live terminal preview the current tile draws (FR-020). Whether that preview survives being remounted as cards move between columns is an implementation question for `/speckit-plan`, but it is the most likely place this feature breaks something that works today.
