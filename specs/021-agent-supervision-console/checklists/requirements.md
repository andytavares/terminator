# Specification Quality Checklist: Agent Supervision Console

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-26
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

**Status**: 16/16 pass, re-validated after the 2026-07-26 clarification session. Ready for `/speckit-plan`.

## Notes

### Iteration 1 findings (resolved)

- **Implementation leakage** — the source PRD is written in engineering terms (Agent SDK, JSONL transcripts, `git worktree add`, TOML config keys, hook names, competitor references). All were rewritten to capability language: "the agent runtime's programmatic interface", "the agent's durable activity record", "isolated working copy", "per-repository configuration file". Vendor-specific mechanics are recorded in Assumptions as constraints carried from the PRD, not as requirements.
- **Untestable success criteria** — the PRD's "false-positive rate under 10%" had no measurement mechanism. FR-014 and FR-017 were added so firings and operator judgements are recorded, making SC-002 verifiable rather than aspirational.
- **Unbounded stories** — the PRD spans six build milestones. Stories were sliced so each is independently shippable and testable; priorities mirror the PRD's stated build order.

### Iteration 2 — clarifications resolved by the operator

1. **Shadow mode (FR-014 – FR-018)** — kept as a real, **global, default-on** mode: the detector runs and records from the first release but leaves session state, the feed, and all notifications untouched until explicitly turned off. Turning it off is an operator decision informed by recorded precision, not a fixed calendar gate. Consequence recorded in Assumptions: the attention surface ships showing permission requests, failures, and finished work, and begins showing stalls only once shadow mode is off. Stall FRs and acceptance scenarios were reworded from "marks the session stalled" to "fires / records a firing" so they hold in both modes.
2. **Unattended merge (FR-053 – FR-057)** — the lowest risk grade may merge unattended, but only under a **per-repository setting defaulting to off**, with no all-repositories switch, never when checks are missing/failed/unavailable, every merge recorded, and an after-the-fact review view. SC-009 was widened to three recorded justifications and SC-011 added.
3. **SpecKit Pilot boundary (FR-062 – FR-064)** — console takes the runtime layer (working-copy provisioning, concurrency, backpressure, runtime state, stall detection, all surfaces); the plugin keeps the specification pipeline and artefact authorship and publishes through the work item file. The plugin's own board and its `maxConcurrentRuns` cap are superseded.

### Iteration 3 — clarification session 2026-07-26 (plugin/core isolation)

Triggered by the directive "plugins must NEVER mix with the core application". Iteration 2's Pilot-boundary answer was wrong on this axis: it had core dictating an extension's internals (its board, its concurrency cap) and had the console writing into extension-owned state. All five clarifications tightened the boundary.

1. **Boundary mechanism** — read-only file inbound, Extension API outbound. Console never writes producer state; lane→session bindings moved to console-owned storage.
2. **Contract location** — a **console-owned publication directory** with a console-defined schema. The console holds no knowledge of `.pilot/` or any producer's internal layout. Side effect: the PRD's "spec-kit artefact paths are unverified" risk is eliminated, because the producer reports artefact paths in the contract and the console never infers a layout.
3. **Surface ownership** — substrate and all seven surfaces are **core**; the Extension API exposes read access to runtime state and worktree provisioning. New "Core and extension boundary" requirement group added.
4. **Code-host / CI** — core owns its own code-host client. This corrected a live contradiction: the spec had assumed check results came from the `git-integration` extension, which the new boundary forbids. Verified against the tree — `src/main/git/` exists in core but `src/main/github/` is empty, so all `gh` logic currently lives in that extension. Duplicated code-host calls are accepted as the price of the boundary.
5. **Agent runtime coupling** — one internal seam with exactly one implementation, not pluggable and not on the Extension API. Justified by SC-007 (absorb frequent runtime upgrades in one place), not by an anticipated second runtime, so it does not trip Constitution VII (YAGNI). SC-007 strengthened to require that upgrade changes stay inside that boundary.

New SC-011 makes the directive directly testable: with every extension removed, core still builds, starts, and delivers every capability except work-item intake and gate actions.

### Resolved with documented defaults rather than markers

- _Critical-path file list per repository_ — defaults to empty, operator-supplied, never inferred (FR-052).
- _Whether the plan step reliably emits lane-shaped output_ — a planning-phase verification obligation, not a specification ambiguity. Recorded in Assumptions.
- _Backpressure counting scope_ — global across all repositories, since the constraint being modelled is one human's review capacity.

### Carried into planning

- **The publication directory schema is a new public contract.** It needs versioning, and the plan must say what the console does when it reads a contract file written to a schema version it does not understand.
- **Core gains a code-host client.** New dependency surface for the core application: authentication state, offline behaviour, and rate limiting all need answers in the plan, plus a decision on whether the `git-integration` extension eventually consumes it through the Extension API rather than duplicating it.
- **Migrating the SpecKit Pilot extension onto the contract is separate work.** This specification requires only that the console consume the contract. It requires no change to that extension and deliberately says nothing about its board or its concurrency cap.
