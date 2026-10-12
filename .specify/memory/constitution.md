<!--
SYNC IMPACT REPORT
==================
Version change: 1.4.1 → 2.0.0 (MAJOR: Principles II and VI redefined)

Modified principles:
  - II. Extension Isolation → II. Extension Model. Redefined on VS Code's model: the SDK is the
    single API declaration the core implements; extensions import only the SDK, the design system
    and their own packages; backends run in an extension host process; extensions reach each
    other only through exports and a declared dependency. Built-in extensions get no exception.
  - IV. Dependency Stewardship: "pinned" now means an exact version, and one version per
    dependency across all workspaces is required.
  - VI. Test-Driven Development: the four-metric whole-file 80% gate and the per-file rule are
    replaced by the Codecov statuses; tests must cover reachable behavior; unreachable code is
    deleted, not tested.

Added sections:
  - XIII. One Design System

Removed sections: none

Templates requiring updates:
  ⚠ .specify/templates/tasks-template.md still marks tests OPTIONAL, against Principle VI
    (carried over from 1.4.1).

Follow-up TODOs (code and docs that now contradict this version):
  - vitest.config.ts coverage thresholds and the pre-commit `scripts/check-patch-coverage.cjs`
    gate whole files on four metrics (Principle VI).
  - codecov.yml sets `if_ci_failed: success` and `if_not_found: success`, so the Codecov
    statuses can pass without a coverage report (Principle VI).
  - The version-per-dependency CI check does not exist yet; tool to be chosen (Principle IV).
  - 11 dependencies are declared at more than one version and 48 specs are ranges (Principle IV).
  - Extension backends still run in the main process; 32 extension source files import core source
    (Principle II). ADR-002 is superseded by ADR-094.
  - No Storybook, core does not use the design system, fonts are fetched (Principle XIII).
  - docs/CONTRIBUTING.md and docs/EXTENSION-DEVELOPMENT.md describe the old Principle II.
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

### II. Extension Model (NON-NEGOTIABLE)

The core application and each extension are separate programs that meet only through
the published Extension SDK. The model is VS Code's: the core implements the API,
extensions run in an extension host process, and an extension reaches another extension
only through what that extension exports.

**The core**

- The core MUST build and run with every extension directory deleted. The core MUST NOT
  import, require, or reference by path any extension's code.
- `@terminator/extension-sdk` is the single declaration of the Extension API. The core
  implements that declaration, and the compiler checks the implementation against it.

**What an extension may import**

- An extension MAY import only `@terminator/extension-sdk`, the design system package
  (Principle XIII), and npm packages declared in its own `package.json`.
- An extension MUST NOT import core source (`src/**`), another extension's source, or any
  other workspace package. A lint rule enforces this.
- An extension MUST NOT copy or re-declare types from core internals.
- Functionality more than one extension needs (a relative time, an atomic file write,
  running git) MUST be provided once through the SDK: as an API member the core
  implements, or as a design-system export. It MUST NOT be copied into extensions.

**Runtime**

- Extension backends MUST run in the extension host process, never in the Electron main
  process. An extension's slow or failing code MUST NOT stall terminals or the core.
- An extension MUST reach the core only through the API object passed to `activate`.
  Using Electron, `electron-store`, or child processes directly for something the API
  covers is a defect; if the API does not cover it, the API is extended first.
- IPC channels introduced for an extension MUST be registered by the extension through
  the API, never by handler logic in the core. They are local-only unless the extension
  declares a channel remote-accessible.
- The extension MUST NOT depend on undocumented side-effects of core initialisation
  order, store shape, or runtime globals.

**Extension to extension**

- An extension MAY offer an API to other extensions by returning it from `activate`.
  A consumer MUST declare the provider as an extension dependency in its manifest and use
  only that returned object.
- Built-in extensions, shipped with the app (Foundry, task-vault, and the others), follow
  every rule above. Being built in grants no access to core internals.

**Dependencies**

- All npm packages an extension needs MUST be declared in that extension's own
  `package.json`. npm workspaces hoist them automatically; Vite resolves them without
  any root-level entry.
- Adding an extension-only package to the root `package.json` is a defect. The root
  manifest is for the core application only.

**The test**
Before considering any extension work complete, ask two questions. "If this extension
directory were deleted, would the core application still build and run without
modification?" And: "Would every other extension that does not declare it as a
dependency still build and run?" If either answer is no, the model has been violated and
MUST be corrected first.

### IV. Dependency Stewardship

Dependencies are a long-term liability. Every addition MUST be justified and evaluated
for community health before adoption.

- A package MUST have an active community and multiple active maintainers.
  A package maintained by a single individual MUST NOT be adopted, regardless of fit.
- When a well-known, battle-tested alternative exists, it MUST be preferred over a
  niche or newer package.
- All version constraints MUST be pinned to an exact version. Ranges (`^`, `~`, `*`,
  `latest`) are forbidden in every `package.json`; the only exception is a reference to
  a package inside this repository's own workspaces.
- **One version per dependency.** A package MUST be declared at exactly one version
  across the root and every workspace `package.json`. One library published under two
  names (`xterm` and `@xterm/xterm`) counts as one package. CI enforces this. npm
  `overrides` MUST NOT be used to force a version, except to apply a security fix,
  with the advisory linked beside it.
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
- **Coverage gate: Codecov.** The Codecov statuses on the pull request
  (`codecov/patch` and `codecov/project`, configured in `codecov.yml`) MUST pass.
  A failing Codecov status is a failed change. The patch gate measures the lines the
  change adds or modifies; there is no whole-file gate and no separate branch or function
  threshold.
- **Tests cover reachable behavior only.** A test MUST exercise a scenario the running
  application can produce and assert what a user or caller observes. A test that only
  asserts a mock was called, restates a constant, tests a copy of production code, or
  can pass without its assertion running is a defect.
- **Unreachable code is deleted, never tested.** A branch no real caller can reach MUST
  be removed together with any test that covers it. A dependency that production always
  supplies MUST be required, not optional.

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
- **`npm run lint` MUST pass with 0 errors** before any session or PR is considered complete.
- **Extension compiled output** (`extensions/*/src/index.js`) is a build artifact generated by `scripts/build-extensions.js`. It MUST be gitignored and MUST NOT be committed. After changing TypeScript source files under `extensions/*/src/`, always run `npm run build:extensions`. The TypeScript source is the canonical source; the compiled JS must never be edited directly.

### XI. Functional Purity & Immutability

Side effects are a code smell. Functions MUST be pure, idempotent, and deterministic
wherever the problem domain allows.

- **MUST** default to immutable data structures and pure functions.
- Side effects (I/O, mutation, global state) MUST be isolated to the boundaries of the
  system and explicitly identified. They MUST NOT bleed into domain logic.
- A function with a hidden side effect MUST be refactored. If a side effect is truly
  unavoidable, it MUST be documented with an explicit justification.

### XII. UI Icons (NON-NEGOTIABLE)

All icons throughout the application MUST use `lucide-react` components exclusively.

- **MUST** use `lucide-react` for every icon in the UI — no emoji, no unicode symbols, no other icon libraries.
- Icons MUST be flat and inherit the current text color (`currentColor`). No inline `color` style, no color utility classes on icon elements.
- Use `opacity` only for state differentiation (e.g., disabled or muted states). Never use color to differentiate icon states.
- SVG size MUST be controlled via CSS (e.g., `width`/`height` on the icon's container or a CSS selector targeting `svg`), not via the `size` prop, so that all icons remain consistent and layout-controlled.

### XIII. One Design System (NON-NEGOTIABLE)

The core and every extension are built from one design system, so a control looks and
lines up the same on every screen. The design system package (`packages/extension-ui`
today) is published outward: the core consumes it exactly as an extension does.

- Design tokens (color, spacing, type, radius, layer) MUST be defined once, in the design
  system, for both themes. The core injects them into its own renderer and into every
  extension view. Neither the core nor an extension may define its own tokens or
  hard-code a value a token covers.
- A component the design system provides MUST be used; the core and extensions MUST NOT
  build their own equivalent. A missing component is added to the design system first,
  then used.
- Every exported component MUST have Storybook stories covering its states in both
  themes. The stories are the component's documentation and run as tests.
- Fonts MUST ship with the app; nothing is fetched at runtime to render the UI.
- Screenshot tests at the supported window sizes, in both themes, MUST guard the
  layout of every core and extension surface.

## Development Environment & Workflow

Isolation and process discipline prevent environment drift and protect the shared codebase.

- Dependencies MUST be installed with npm from the repository root, which resolves the
  workspaces and `package-lock.json`. Global or ad-hoc installs are forbidden.
- All feature work MUST start from an agreed spec. No implementation begins without
  a ratified specification.
- All work MUST happen on a feature branch. Direct commits to `main` are forbidden.
- Complexity deviations from the plan MUST be recorded in the plan's Complexity Tracking
  table, not silently accepted.

## Governance

This constitution supersedes all other practices, conventions, and ad-hoc guidance.

- All PRs and code reviews MUST verify adherence to these principles before merge approval.
- Amendments to this constitution require: a documented rationale, a version bump following
  semantic versioning (MAJOR for removals/redefinitions, MINOR for additions,
  PATCH for clarifications), and an updated `Last Amended` date.
- Principle violations that cannot be resolved MUST be escalated and recorded — they are
  never silently accepted.
- The constitution version and amendment history are the authoritative record of governance
  decisions affecting this project.

**Version**: 2.0.0 | **Ratified**: 2026-05-05 | **Last Amended**: 2026-10-12
