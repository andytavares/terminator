<!--
SYNC IMPACT REPORT
==================
Version change: [unversioned template] → 1.0.0 (initial population)

Added sections:
  - I. Source Integrity (new)
  - II. Dependency Stewardship (new)
  - III. Code Readability & Minimalism (new)
  - IV. Test-Driven Development (new)
  - V. SOLID Design & YAGNI (new)
  - VI. Documentation as First-Class (new)
  - VII. Architectural Decision Records (new)
  - VIII. Functional Purity & Immutability (new)
  - Development Environment & Workflow (new section)
  - Governance (new)

Removed sections: none

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — Constitution Check gates align (no changes required)
  ✅ .specify/templates/spec-template.md — No constitution-breaking conflicts found
  ✅ .specify/templates/tasks-template.md — "Tests: OPTIONAL" comment updated to reflect mandatory TDD

Follow-up TODOs:
  - TODO(RATIFICATION_DATE): Confirm the project's official ratification date; defaulted to 2026-05-05.
-->

# Terminator Constitution

## Core Principles

### I. Source Integrity

All development decisions MUST be grounded in official, vendor-published documentation.
Blogs, Stack Overflow posts, and community tutorials are acceptable for orientation
only — they MUST NOT be the sole basis for implementation choices.

- **MUST** cite official docs when selecting an API, pattern, or behavior.
- **MUST** verify behavior against the official specification, not inferred examples.
- When official docs and community guidance conflict, official docs win.

### II. Extension Isolation (NON-NEGOTIABLE)

Extensions MUST be completely self-contained. An extension MUST NOT assume anything
exists in the core application beyond the published Extension API. If it is not in the
API contract, the extension cannot rely on it — full stop.

**Dependencies**

- All npm packages an extension needs MUST be declared in that extension's own
  `package.json`. npm workspaces hoist them automatically; Vite resolves them without
  any root-level entry.
- Adding an extension-only package to the root `package.json` is a defect. The root
  manifest is for the core application only.

**Code & Types**

- An extension MUST NOT import from core application source files (`src/main/*`,
  `src/renderer/*`, `src/shared/*`, etc.). If shared types or utilities are needed,
  they MUST be exposed through the Extension API and the extension imports from there.
- An extension MUST NOT copy or re-declare types from core internals. If a type is not
  in the API surface, the extension defines its own equivalent locally.
- Schemas, stores, hooks, components, and utilities needed by an extension MUST live
  inside the extension's own directory tree.

**IPC & Runtime**

- IPC channels introduced for an extension MUST be registered by the extension's own
  handler file. Core `index.ts` may wire in that handler file, but MUST NOT contain
  handler logic written for the extension.
- The extension MUST NOT depend on undocumented side-effects of core initialisation
  order, store shape, or runtime globals.

**The test**
Before considering any extension work complete, ask: "If this extension directory were
deleted, would the core application still build and run without modification?" If no,
isolation has been violated and MUST be corrected first.

### IV. Dependency Stewardship

Dependencies are a long-term liability. Every addition MUST be justified and evaluated
for community health before adoption.

- A package MUST have an active community and multiple active maintainers.
  A package maintained by a single individual MUST NOT be adopted, regardless of fit.
- When a well-known, battle-tested alternative exists, it MUST be preferred over a
  niche or newer package.
- All version constraints MUST be pinned — unpinned `latest` is forbidden in production.
- New dependencies MUST include a brief justification in the PR: community health signal
  and a link to official documentation.
- The standard library MUST be used when it fully satisfies the requirement; a third-party
  package MUST NOT be added if stdlib covers the need.
- Deprecated packages or packages carrying active CVEs MUST be replaced promptly;
  they MUST NOT be left in a passing state.

### V. Code Readability & Minimalism

Code is a liability. The least code that correctly fulfills a requirement is the best code.

- **MUST** prefer readable, obvious code over clever or terse code.
  If a future reader would need to pause to decode it, rewrite it.
- **MUST NOT** add code speculatively. Every line written MUST serve the current requirement.
- Abstraction MUST be earned: only introduce it when two or more concrete cases demonstrably
  benefit, and the abstraction boundary is clear. Premature abstraction is treated as a defect.
- Comments are reserved for non-obvious WHY — not WHAT. Explanatory comments about
  what the code does are a sign the code should be clearer, not commented.

### VI. Test-Driven Development (NON-NEGOTIABLE)

TDD is the primary mechanism for validating work. No production code is written before
a failing test exists that demands it.

- **MUST** follow Red → Green → Refactor strictly:
  1. Write a failing test that captures the requirement.
  2. Implement the minimum code to make it pass.
  3. Refactor under a green test suite.
- For bug fixes, the Red → Green → Refactor cycle is mandatory without exception.
  A bug MUST be reproduced by a failing test before any fix is written.
- Passing tests do not constitute completion. Work MUST be verified against the agreed
  spec and validated manually before being marked done.
- Test coverage MUST be scoped to behavior, not implementation internals.

### VII. SOLID Design & YAGNI

Design MUST solve today's problem cleanly. Anticipating future requirements is actively
harmful.

- Follow all five SOLID principles as a baseline design standard.
- **YAGNI is binding**: features, interfaces, and abstractions not required by the current
  spec MUST NOT be introduced.
- The simplest design that correctly implements the spec MUST be chosen over a more
  "extensible" alternative that goes beyond scope.
- Complexity deviations from the plan MUST be recorded in the plan's Complexity Tracking
  table with justification.

### VIII. Documentation as First-Class

Documentation is part of the deliverable, not an afterthought. A feature is not complete
until its documentation is accurate.

- Docs MUST ship in the same PR as the implementation. No PR is mergeable without
  updated documentation.
- Documentation MUST be kept accurate as code evolves. Stale docs are treated as bugs.
- A feature MUST NOT be marked complete until documentation has been reviewed and
  confirmed to reflect the current implementation.

### IX. Architectural Decision Records (ADRs)

Every significant architectural decision MUST be captured in an ADR so future maintainers
understand the reasoning and tradeoffs, not just the outcome.

- An ADR MUST document: the decision taken, the motivation behind it, and the alternatives
  considered with their tradeoffs.
- ADRs MUST be written at the time of the decision, not retroactively.
- ADRs are immutable records; if a decision is reversed, a new ADR supersedes the old one
  rather than editing it.

### X. Code Cleanliness (NON-NEGOTIABLE)

Dead code is a defect. Every change must leave the codebase in a cleaner state than it found it.

- **MUST NOT** leave unused imports, unused variables, or unreachable functions. Remove them the moment the code that depended on them is removed or refactored. The linter enforces this — a lint error here means the change is incomplete.
- **MUST NOT** leave placeholder comments (`// TODO`, `// In a real implementation`, `// For now`) unless attached to a tracked issue reference. Placeholders rot and mislead future readers.
- **MUST NOT** leave dead exports. If a function, constant, or export is no longer referenced anywhere, delete it.
- **`npm run lint` MUST pass with 0 errors** before any session or PR is considered complete. Run it explicitly — a CI lint failure caused by changes in the session is a blocker.
- **Extension compiled output** (`extensions/*/src/index.js`) is a build artifact generated by `scripts/build-extensions.js`. It MUST be gitignored and MUST NOT be committed. After changing TypeScript source files under `extensions/*/src/`, always run `npm run build:extensions`. The TypeScript source is the canonical source; the compiled JS must never be edited directly.

### XI. Functional Purity & Immutability

Side effects are a code smell. Functions MUST be pure, idempotent, and deterministic
wherever the problem domain allows.

- **MUST** default to immutable data structures and pure functions.
- Side effects (I/O, mutation, global state) MUST be isolated to the boundaries of the
  system and explicitly identified. They MUST NOT bleed into domain logic.
- A function with a hidden side effect MUST be refactored. If a side effect is truly
  unavoidable, it MUST be documented with an explicit justification.

## Development Environment & Workflow

Isolation and process discipline prevent environment drift and protect the shared codebase.

- Development MUST occur in an isolated environment appropriate to the stack
  (e.g., `venv` for Python, `node_modules` local installs for Node, etc.).
- Dependencies MUST be installed via the project's standard package manager only.
  Manual or ad-hoc installations outside the managed environment are forbidden.
- All feature work MUST start from an agreed spec. No implementation begins without
  a ratified specification.
- All work MUST happen on a feature branch. Direct commits to `main` are forbidden.
- Complexity deviations from the plan MUST be recorded in the plan's Complexity Tracking
  table, not silently accepted.

## Governance

This constitution supersedes all other practices, conventions, and ad-hoc guidance.
Compliance is not optional.

- All PRs and code reviews MUST verify adherence to these principles before merge approval.
- Amendments to this constitution require: a documented rationale, a version bump following
  semantic versioning (MAJOR for removals/redefinitions, MINOR for additions,
  PATCH for clarifications), and an updated `Last Amended` date.
- Principle violations that cannot be resolved MUST be escalated and recorded — they are
  never silently accepted.
- The constitution version and amendment history are the authoritative record of governance
  decisions affecting this project.

**Version**: 1.3.0 | **Ratified**: 2026-05-05 | **Last Amended**: 2026-05-10
