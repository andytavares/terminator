<!--
SYNC IMPACT REPORT (11.0.0)
===========================
Version change: 10.0.1 → 11.0.0 (MAJOR: three rules of Principle XIV redefined, ADR 154)

Modified principles:
  - XIV "Every run tests everything" becomes "A pull request checks what it reaches; main
    checks everything": a pull request and the pre-commit hook run what `turbo --affected`
    selects; a push to main runs everything before the release.
  - XIV "One run decides": a pull request may replay a passed task whose inputs are
    byte-identical from the Turborepo cache; main replays nothing. Retries stay forbidden.
  - XIV "Local checks and CI run the same npm scripts" becomes "... the same tasks": every pull
    request job runs on Ubuntu, E2E and story screenshots included; Start, the `@mac` specs and
    the release run on macOS on main only.
  Approved by the maintainer on 2026-11-08 in the design interview ("Affected on PRs, all on
  main", "E2E on Linux too", "Screenshots to Linux", "macOS job on main only").
Added sections: none
Removed sections: none
Templates requiring updates: none
Follow-up TODOs: none
-->
<!--
SYNC IMPACT REPORT (10.0.1)
===========================
Version change: 10.0.0 → 10.0.1 (PATCH: paths corrected; no rule changed)

Modified principles:
  - XIV: the core moved into workspace packages (packages/core-*, packages/test-support), so the
    paths of the tier guard, eventually(), the hang bounds and the integration test folders follow.
Added sections: none
Removed sections: none
Templates requiring updates: none
Follow-up TODOs: none
-->
<!--
SYNC IMPACT REPORT (10.0.0)
===========================
Version change: 9.0.0 → 10.0.0 (MAJOR: Principles XIII and XIV redefined by the test audit, ADR 150)

Modified principles:
  - XIII: a story is a test only when its play function asserts something; a screenshot test
    first asserts the story rendered and is never the only check of behaviour.
  - XIV: tests run in tiers that tests/setup.ts enforces (a unit test opens no socket, starts no
    process, watches no file, opens no database; an integration test reaches only this machine);
    every mock is reset before each test; a skip that depends on the machine is forbidden too.
  Approved by the maintainer on 2026-11-07 ("Apply and amend": the audit's rules win).
Added sections: none
Removed sections: none
Templates requiring updates: none
Follow-up TODOs: none
-->
<!--
SYNC IMPACT REPORT (9.0.0)
==========================
Version change: 8.0.0 → 9.0.0 (MAJOR: Principle XIV's CI rules removed and redefined, ADR 151)

Modified principles:
  - XIV: removed "Only the tests a change can reach" (test selection), the stability gate, the
    nightly sweep, quarantine, the real-order Foundry canary, and the local CI simulation
    (`npm run ci:local`, its pre-push hook and its local-check status). "CI and the local check
    are the same check" becomes "Local checks and CI run the same npm scripts": the pre-commit
    hook runs `npm run check` (every lint, `format:check`, `typecheck` and `npm test`), and
    ci.yml runs each of those scripts, which `npm run lint:workflows` enforces. Every CI run
    tests everything, once. CI runs on Ubuntu except the jobs that need a Mac.
  - VI: the coverage gate text no longer names ci:local.
  Kept: one run decides, random order, no test depends on another, signals never time, one
  sealed environment, outside services never gate, enforced lint rules.
  Approved by the maintainer on 2026-11-08: "Refactor ci entirely, make everything that can
  run on Ubuntu images do that and simplify everything. Remove the burn in and flake detection
  stuff, simplify everything, nothing fancy." The canary and the local CI simulation were
  removed at the maintainer's instruction of the same day.
Added sections: none
Removed sections: none
Templates requiring updates: none
Follow-up TODOs: none
-->
<!--
SYNC IMPACT REPORT (8.0.0)
==========================
Version change: 7.0.1 → 8.0.0 (MAJOR: where complexity deviations are recorded is redefined)

Modified principles:
  - Simplicity and Governance: complexity deviations are recorded in the pull request
    description, not in the plan's Complexity Tracking table. Spec Kit is removed from the
    repository, so no plan.md exists. Approved by the maintainer on 2026-10-30.
Moved: `.specify/memory/constitution.md` → `docs/CONSTITUTION.md`
Added sections: none
Removed sections: none
Templates requiring updates: none (the Spec Kit templates are removed)
Follow-up TODOs: none
-->
<!--
SYNC IMPACT REPORT (7.0.1)
==========================
Version change: 7.0.0 → 7.0.1 (PATCH: prose rewritten to the plain-language writing rules; no rule changed)

Modified principles: none
Added sections: none
Removed sections: none
Templates requiring updates: none
Follow-up TODOs: none
-->
<!--
SYNC IMPACT REPORT (7.0.0)
==========================
Version change: 6.0.0 → 7.0.0 (MAJOR: Principle XIV's "Only the tests a change can reach" redefined)

Modified principles:
  - XIV: the release no longer runs every test. It is the last job of CI on a push to `main`
    and runs after the checks that push ran, which are the tests its change reaches. The
    nightly sweep still runs everything. Approved by the maintainer on 2026-10-29, so one
    pipeline tests and releases each merge. ADR 134.

Added sections: none
Removed sections: none
Templates requiring updates: none
Follow-up TODOs: none
-->
<!--
SYNC IMPACT REPORT (5.0.0)
==========================
Version change: 4.0.0 → 5.0.0 (MAJOR: Principle XIV's "Only the tests a change can reach" redefined)

Modified principles:
  - XIV: a push to `main` no longer runs everything. It runs what its change reaches, compared
    with the commit `main` was at before, as a pull request does. The nightly sweep and the
    release run everything. The stability gate repeats each changed spec up to ten times,
    not thirty, and runs in CI only; `npm run ci:local` leaves it out. Approved by the
    maintainer on 2026-10-27 to keep every CI run within five minutes on GitHub's free macOS
    runners, and every local run short. ADR 132.

Added sections: none
Removed sections: none
Templates requiring updates: none
Follow-up TODOs: none
-->
<!--
SYNC IMPACT REPORT (4.0.0)
==========================
Version change: 3.0.0 → 4.0.0 (MAJOR: Principle XIV's "One run" redefined)

Modified principles:
  - XIV: "One run" becomes "One run decides": the first run is still the verdict and nothing
    retries a failure, but the stability gate and the nightly sweep repeat tests to find
    flaky ones. A new rule allows a short, capped, visible quarantine. ADR 124.

Added sections: none
Removed sections: none
Templates requiring updates: none
Follow-up TODOs: none
-->
<!--
SYNC IMPACT REPORT (3.0.0)
==========================
Version change: 2.0.1 → 3.0.0 (MAJOR: Principle VI's coverage gate redefined; Principle XIV added)

Modified principles:
  - VI: the coverage gate is Vitest's threshold on the changed files, which CI and ci:local
    both run. Codecov reports but no longer gates: an outside service never decides a check
    (Principle XIV).

Added sections:
  - XIV. Deterministic Tests (NON-NEGOTIABLE): one run, random order on every run, no test
    depends on another, signals never time, one sealed environment, CI and the local check
    alike, outside services never gate, only the tests a change can reach. ADR 123.

Removed sections: none
Templates requiring updates: none
Follow-up TODOs: none
-->
<!--
SYNC IMPACT REPORT (2.0.1)
==========================
Version change: 2.0.0 → 2.0.1 (PATCH: a file path corrected)

Modified principles:
  - X: the extension build script is `scripts/build-extensions.cjs`; the text named
    `scripts/build-extensions.js`, which does not exist. No rule changed.

Added sections: none
Removed sections: none
Templates requiring updates: none
Follow-up TODOs: none
-->
<!--
SYNC IMPACT REPORT (2.0.0)
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
  - The version-per-dependency CI check does not exist yet; it will be syncpack, an approved
    Principle IV exception recorded in ADR-097.
  - 11 dependencies are declared at more than one version and 48 specs are ranges (Principle IV).
  - Extension backends still run in the main process; 32 extension source files import core source
    (Principle II). ADR-002 is superseded by ADR-094.
  - No Storybook, core does not use the design system, fonts are fetched (Principle XIII).
  - docs/CONTRIBUTING.md and docs/EXTENSION-DEVELOPMENT.md describe the old Principle II.
-->

# Terminator Constitution

## Core Principles

### I. Source Integrity

All development decisions MUST be based on official, vendor-published documentation.
Use blogs, Stack Overflow posts, and community tutorials for orientation only.
They MUST NOT be the sole basis for an implementation choice.

- **MUST** cite official docs when you select an API, pattern, or behavior.
- **MUST** verify behavior against the official specification, not inferred examples.
- When official docs and community guidance conflict, official docs win.

### II. Extension Model (NON-NEGOTIABLE)

The core application and each extension are separate programs.
They meet only through the published Extension SDK.
The model is VS Code's. The core implements the API.
Extensions run in an extension host process.
An extension reaches another extension only through what that extension exports.

**The core**

- The core MUST build and run with every extension directory deleted.
  The core MUST NOT import, require, or reference by path any extension's code.
- `@terminator/extension-sdk` is the single declaration of the Extension API.
  The core implements that declaration. The compiler checks the implementation against it.

**What an extension may import**

- An extension MAY import only `@terminator/extension-sdk`, the design system package
  (Principle XIII), and npm packages declared in its own `package.json`.
- An extension MUST NOT import core source (`src/**`), another extension's source, or any
  other workspace package. A lint rule enforces this.
- An extension MUST NOT copy or re-declare types from core internals.
- When more than one extension needs a function (a relative time, an atomic file write,
  running git), the SDK MUST provide it once. It is an API member the core
  implements, or a design-system export. Extensions MUST NOT copy it.

**Runtime**

- Extension backends MUST run in the extension host process, never in the Electron main
  process. An extension's slow or failing code MUST NOT stall terminals or the core.
- An extension MUST reach the core only through the API object passed to `activate`.
  Use of Electron, `electron-store`, or child processes directly for something the API
  covers is a defect. If the API does not cover it, extend the API first.
- An extension MUST register the IPC channels it introduces through the API.
  Handler logic in the core MUST NOT register them. Channels are local-only unless the extension
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

- An extension MUST declare all the npm packages it needs in its own
  `package.json`. npm workspaces hoist them automatically. Vite resolves them without
  any root-level entry.
- Adding an extension-only package to the root `package.json` is a defect. The root
  manifest is for the core application only.

**The test**
Before you consider extension work complete, ask two questions.
"If this extension directory were deleted, would the core application still build and run without
modification?"
And: "Would every other extension that does not declare it as a
dependency still build and run?"
If either answer is no, the work violates the model, and it MUST be corrected first.

### IV. Dependency Stewardship

Dependencies are a long-term liability. Every addition MUST be justified and evaluated
for community health before adoption.

- A package MUST have an active community and multiple active maintainers.
  A package maintained by a single individual MUST NOT be adopted, regardless of fit.
- When a well-known, battle-tested alternative exists, it MUST be preferred over a
  niche or newer package.
- All version constraints MUST be pinned to an exact version. Ranges (`^`, `~`, `*`,
  `latest`) are forbidden in every `package.json`. The only exception is a reference to
  a package inside this repository's own workspaces.
- **One version per dependency.** A package MUST be declared at exactly one version
  across the root and every workspace `package.json`. One library published under two
  names (`xterm` and `@xterm/xterm`) counts as one package. CI enforces this. npm
  `overrides` MUST NOT be used to force a version, except to apply a security fix,
  with the advisory linked beside it.
- A PR that adds a dependency MUST include a brief justification: a community health signal
  and a link to official documentation.
- The standard library MUST be used when it fully satisfies the requirement. A third-party
  package MUST NOT be added if the standard library covers the need.
- Deprecated packages and packages with active CVEs MUST be replaced promptly.
  They MUST NOT be left in a passing state.

### V. Code Readability & Minimalism

Code is a liability. The least code that correctly fulfills a requirement is the best code.

- **MUST** prefer readable, obvious code over clever or terse code.
  If a future reader must pause to decode it, rewrite it.
- **MUST NOT** add code speculatively. Every line written MUST serve the current requirement.
- Abstraction MUST be earned. Introduce it only when two or more concrete cases demonstrably
  benefit and the abstraction boundary is clear. Premature abstraction is a defect.
- Comments are for the non-obvious WHY, not the WHAT. A comment that explains
  what the code does shows that the code must be clearer. Make the code clearer; do not comment it.

### VI. Test-Driven Development (NON-NEGOTIABLE)

TDD is the primary mechanism for validating work. No production code is written before
a failing test exists that demands it.

- **MUST** follow Red → Green → Refactor strictly:
  1. Write a failing test that captures the requirement.
  2. Implement the minimum code to make it pass.
  3. Refactor under a green test suite.
- For bug fixes, the Red → Green → Refactor cycle is mandatory without exception.
  A failing test MUST reproduce a bug before any fix is written.
- Passing tests do not make work complete. Work MUST be verified against the agreed
  spec and validated manually before it is marked done.
- Test coverage MUST be scoped to behavior, not implementation internals.
- **Coverage gate: Codecov `codecov/patch`.** The pull request MUST have 80% coverage of the
  lines it adds or modifies, as Codecov measures it from the uploaded reports (ADR 095). It
  is the one outside service that gates (Principle XIV). Vitest has no coverage threshold.
- **Tests cover reachable behavior only.** A test MUST exercise a scenario the running
  application can produce and assert what a user or caller observes. These tests are defects:
  a test that only asserts a mock was called, restates a constant, tests a copy of production code, or
  can pass without its assertion running.
- **Unreachable code is deleted, never tested.** A branch no real caller can reach
  MUST be removed, together with any test that covers it. A dependency that production always
  supplies MUST be required, not optional.

### VII. SOLID Design & YAGNI

Design MUST solve today's problem cleanly. Anticipating future requirements is actively
harmful.

- Follow all five SOLID principles as a baseline design standard.
- **YAGNI is binding**: features, interfaces, and abstractions that the current
  spec does not require MUST NOT be introduced.
- The simplest design that correctly implements the spec MUST be chosen over a more
  "extensible" alternative that goes beyond scope.
- Complexity deviations from the plan MUST be recorded, with justification, in the pull
  request description.

### VIII. Documentation as First-Class

Documentation is part of the deliverable, not an afterthought. A feature is not complete
until its documentation is accurate.

- Docs MUST ship in the same PR as the implementation. No PR is mergeable without
  updated documentation.
- Documentation MUST stay accurate as code evolves. Stale docs are bugs.
- A feature MUST NOT be marked complete until someone has reviewed the documentation and
  confirmed that it reflects the current implementation.

### IX. Architectural Decision Records (ADRs)

Every significant architectural decision MUST be captured in an ADR. Future maintainers
then understand the reasoning and tradeoffs, not just the outcome.

- An ADR MUST document the decision taken, the motivation behind it, and the alternatives
  considered with their tradeoffs.
- ADRs MUST be written at the time of the decision, not retroactively.
- ADRs are immutable records. If a decision is reversed, a new ADR supersedes the old one.
  Do not edit the old one.

### X. Code Cleanliness (NON-NEGOTIABLE)

Dead code is a defect. Every change must leave the codebase cleaner than it found it.

- **MUST NOT** leave unused imports, unused variables, or unreachable functions. Remove them the moment the code that depended on them is removed or refactored. The linter enforces this. A lint error here means the change is incomplete.
- **MUST NOT** leave placeholder comments (`// TODO`, `// In a real implementation`, `// For now`) unless they are attached to a tracked issue reference. Placeholders rot and mislead future readers.
- **MUST NOT** leave dead exports. If nothing references a function, constant, or export, delete it.
- **`npm run lint` MUST pass with 0 errors** before any session or PR is considered complete.
- **Extension compiled output** (`extensions/*/src/index.js`) is a build artifact generated by `scripts/build-extensions.cjs`. It MUST be gitignored and MUST NOT be committed. After you change TypeScript source files under `extensions/*/src/`, always run `npm run build:extensions`. The TypeScript source is the canonical source. Never edit the compiled JS directly.

### XI. Functional Purity & Immutability

Side effects are a code smell. Functions MUST be pure, idempotent, and deterministic
wherever the problem domain allows.

- **MUST** default to immutable data structures and pure functions.
- Side effects (I/O, mutation, global state) MUST be isolated to the boundaries of the
  system and identified explicitly. They MUST NOT bleed into domain logic.
- A function with a hidden side effect MUST be refactored. If a side effect is truly
  unavoidable, it MUST be documented with an explicit justification.

### XII. UI Icons (NON-NEGOTIABLE)

All icons throughout the application MUST use `lucide-react` components exclusively.

- **MUST** use `lucide-react` for every icon in the UI. Do not use emoji, unicode symbols, or other icon libraries.
- Icons MUST be flat and inherit the current text color (`currentColor`). Do not use an inline `color` style or a color utility class on an icon element.
- Use `opacity` only to show state (for example, disabled or muted states). Never use color to show icon state.
- CSS MUST control SVG size (for example, `width`/`height` on the icon's container or a CSS selector that targets `svg`), not the `size` prop. All icons then stay consistent and layout-controlled.

### XIII. One Design System (NON-NEGOTIABLE)

The core and every extension are built from one design system. A control then looks and
lines up the same on every screen. The design system package (`packages/extension-ui`
today) is published outward. The core consumes it exactly as an extension does.

- Design tokens (color, spacing, type, radius, layer) MUST be defined once, in the design
  system, for both themes. The core injects them into its own renderer and into every
  extension view. Neither the core nor an extension may define its own tokens or
  hard-code a value a token covers.
- The core and extensions MUST use a component that the design system provides.
  They MUST NOT build their own equivalent. Add a missing component to the design system first,
  then use it.
- Every exported component MUST have Storybook stories that cover its states in both
  themes. The stories are the component's documentation. A story whose play function asserts
  behaviour runs as a test; a story that only renders is pictured by the screenshot tests and is
  not a test of its own (ADR 150).
- Fonts MUST ship with the app. The app fetches nothing at runtime to render the UI.
- Screenshot tests at the supported window sizes, in both themes, first assert that the story
  rendered and MUST guard the
  layout of every core and extension surface.

### XIV. Deterministic Tests (NON-NEGOTIABLE)

A test fails only when the code it covers is wrong. Its result depends on the code and the
test, and on nothing else: not the order, the machine, the time, the developer's
environment, an outside service, or another test. A test that fails and passes on the same
code has no value. It is a defect. ADR 123 records the reasoning.

- **Each check in the lowest tier that proves it.** A unit test is one behaviour in one process
  with no I/O: it opens no socket, loopback included, starts no process, watches no file and opens
  no database, and `packages/test-support/setup.ts` refuses each. An integration test (`tests/integration`, `packages/*/tests/integration`,
  `extensions/*/tests/integration`) reaches one boundary the code owns, through a private instance
  it makes, and only on this machine. An end-to-end test is one user journey (ADR 115, ADR 150).
- **No test depends on another.** `vitest.config.ts` resets every mock, calls and implementation
  alike, before each test. A test MUST NOT read anything another test did: module
  state, a mock or stub, a timer, an environment variable, a file, a database row, a
  registered handler, or its position in the run. Each test sets up what it needs and
  undoes what it changed.
- **Random order, on every run, forever.** Every run of the suite, in CI and locally, MUST
  shuffle the spec files and the tests inside each file with a new seed, and print it. The
  seed is Vitest's own, which it prints. A failure reproduces with `--sequence.seed=<seed>`. A test that fails in some order MUST be rewritten so that it is
  independent. Pinning the order (`sequence.shuffle: false`, `.sequential`,
  a fixed seed) is forbidden.
- **One run decides.** A check's verdict is its first run. Never retry or rerun a failing test into a pass, in CI, locally, or in Foundry's final check. Fix it
  at its cause, or delete it together with the behavior it claimed to cover. Nothing repeats a
  test: a run runs each test it selects once. On a pull request, a task whose inputs are
  byte-identical to a task that passed may replay that pass from the Turborepo cache instead of
  running again; a failed task is never cached. A push to `main` replays nothing (ADR 154).
- **No skipped test.** Skipping a test (`skip`, `fixme`, `todo`, `skipIf`, a `test.skip` that
  depends on the machine) is forbidden. A live spec whose credentials or checkout are missing
  fails and says which.
- **Signals, never time.** A test waits only on a signal from the code under test: an
  awaited promise, an event, a locator assertion, or `eventually()`
  (`packages/test-support/src/eventually.ts`). It never sleeps and never waits a tick. A test MUST await the work it
  starts. Stopping (`dispose`, `stop`, `close`, `deactivate`) returns a
  promise that settles when the work it started has ended. The only time limits are the
  hang bounds in `packages/test-support/src/bounds.ts` and `playwright.config.ts`, far above any real
  duration. A spec MUST NOT set its own.
- **One sealed environment.** Every test process runs in the environment
  `scripts/test-env.mjs` builds: fixed time zone and locale, a fresh `HOME` and `TMPDIR`,
  the fixture git config, stubs first on `PATH`. Nothing of the developer's environment
  reaches a test. A unit spec opens no socket; an integration or end-to-end spec connects only to
  loopback. A stub that has no answer fails. It
  never falls through to the real tool.
- **Local checks and CI run the same tasks.** The pre-commit hook and `.github/workflows/ci.yml`
  run the same Turborepo tasks (`turbo.json`) with the Node in `.nvmrc`: every lint task,
  `format:check`, `typecheck` and the tests. `npm run lint:workflows` fails if ci.yml leaves one
  out. Every pull request job runs on Ubuntu, the E2E suite and the story screenshots included.
  Only Start, the end-to-end specs tagged `@mac` and the signed release run on macOS, on a push
  to `main`, before the release. There is no local CI simulation. ADR 154.
- **Outside services never gate.** An advisory database, the artifact store or a registry
  MUST NOT turn a change red that did not touch what they check. The one exception is
  Codecov's `codecov/patch`, which gates the lines a change adds or modifies (Principle VI).
- **A pull request checks what it reaches; `main` checks everything.** A pull request, and the
  pre-commit hook, run the tasks of the packages the change reaches, as `turbo run --affected`
  computes them; a change to a root config, the lockfile or a global dependency reaches every
  package. A push to `main` runs every task and the whole Playwright suite, and a push that
  passes is released (ADR 134, ADR 154).
- **Enforced, not trusted.** `.oxlintrc.json`, with the repository's rules in `scripts/oxlint-plugin/`, rejects sleeps,
  ticks, time limits and
  promises left unawaited in specs. These rules MUST NOT be disabled, suppressed or
  loosened.

## Development Environment & Workflow

Isolation and process discipline prevent environment drift and protect the shared codebase.

- Dependencies MUST be installed with npm from the repository root, which resolves the
  workspaces and `package-lock.json`. Global or ad-hoc installs are forbidden.
- All feature work MUST start from an agreed spec. No implementation begins without
  a ratified specification.
- All work MUST happen on a feature branch. Direct commits to `main` are forbidden.
- Complexity deviations from the plan MUST be recorded in the pull request description.
  Do not accept them silently.

## Governance

This constitution supersedes all other practices, conventions, and ad-hoc guidance.

- All PRs and code reviews MUST verify adherence to these principles before merge approval.
- An amendment to this constitution requires a documented rationale, a version bump that follows
  semantic versioning (MAJOR for removals/redefinitions, MINOR for additions,
  PATCH for clarifications), and an updated `Last Amended` date.
- Principle violations that cannot be resolved MUST be escalated and recorded.
  Never accept them silently.
- The constitution version and amendment history are the authoritative record of governance
  decisions that affect this project.

**Version**: 11.0.0 | **Ratified**: 2026-05-05 | **Last Amended**: 2026-11-08
