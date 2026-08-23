# Specification Quality Checklist: Tracker issues attached to projects

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-22
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

- **Iteration 1 (2026-08-22)**: three [NEEDS CLARIFICATION] markers raised — issues per project,
  write-back scope, trackers in scope. SC-008 reworded to drop the word "cache" and state the
  outcome in operator-observable terms. All other items passed.
- **Iteration 2 (2026-08-22)**: all three resolved by the operator and folded in.
  - FR-033 — **one issue per project**; attaching a second replaces the first, with a warning.
  - FR-034 / FR-034a — **comments only**; no field is ever mutated. The board's
    pull-request-opened comment is preserved but **off by default**, must be verified to actually
    work, and must report failure instead of swallowing it.
  - FR-035 — **Linear and Jira both**. This widened the feature: US1, US2, US5 and US6 were
    rewritten tracker-neutrally; FR-004/005/006 now cover both credentials; FR-006a added for two
    trackers connected at once and colliding issue keys; six edge cases added (key collision,
    one-connected-one-not, partial fetch failure, no suggested branch name, failed comment);
    SC-012 through SC-014 added; three assumptions added. Spec title generalised to
    "Tracker issues attached to projects" — the branch name keeps its original slug.
- Named product surfaces (the board, the pull-request view, the SpecKit Pilot extension) are
  existing parts of this application, not implementation choices, and are referenced as such.
- Two facts carried in from the source plan are treated as **unverified** and must be proven
  during planning, not assumed: whether the existing pull-request-opened comment works at all
  (its failure is currently discarded), and how each tracker wants a comment addressed.
- All items pass. Ready for `/speckit-plan`.

## Post-analysis remediation (2026-08-22)

`/speckit-analyze` raised 22 findings across the three artifacts. The top eight were applied to
`plan.md`, `tasks.md`, `research.md` and `contracts/` — **`spec.md` was not changed**, so this
checklist's 16/16 result still stands. Summary:

- **F1 (CRITICAL)** — every test path in `tasks.md` pointed at `src/`, where `vitest.config.ts`
  collects nothing. Rewritten to `tests/unit/**`; a Path Conventions table now states the globs.
- **F2 (CRITICAL)** — ADRs and docs were scheduled in a final Polish phase, contradicting
  Constitution VIII and IX. Moved into the phases whose decisions they record.
- **F3 (CRITICAL)** — the quality gate ran once at the end. Now a gate per phase, each phase
  being a PR.
- **F4 (HIGH)** — `integrations:issue-updated` had no producer; removed from the contract.
- **F5 (HIGH)** — FR-034/SC-014 were enforced only by absent code; now a provider-interface
  invariant with a test.
- **F6 (HIGH)** — IPC spec filenames corrected to the repo's `<name>.ipc.spec.ts` convention.
- **F7 (MEDIUM)** — three files tasks create were missing from `plan.md`'s source tree.
- **F8 (MEDIUM)** — a configurable cache lifetime that no requirement asked for was dropped
  (Constitution VII).

Remaining known findings, accepted for now: F9–F11 (edge cases without dedicated tasks), F12
(now mapped in plan.md), F13 (the 10,000-char policy stated in four places), F14 (the Desktop
mockups predate the Jira decision), F16–F22 (low severity). None blocks implementation.
