# Contributing to Terminator

---

## Setup

```bash
git clone <repo-url>
cd terminator
nvm use            # Node 24.21.0, from .nvmrc: the Node that Electron 44 ships

# Install all dependencies from the root: npm resolves every workspace (versions are pinned — do not use --legacy-peer-deps without cause)
# node-pty is NAPI-based (ABI-stable), so its `npm install` build works across
# Electron versions with no separate rebuild step.
npm install
```

**macOS with Python 3.12+**: node-pty's native build requires `setuptools`:

```bash
pip3 install setuptools --break-system-packages
```

---

## Development Workflow

### Start the app

```bash
npm run dev        # Electron + hot-reload via electron-vite
```

A dev run uses its own profile, `…/@andytavares/terminator-dev`, so it can run beside the installed app without sharing its database.

### Run tests

```bash
npm test                # Unit + integration (Vitest), core and extensions
npm run test:watch      # Watch mode
npm run test:e2e        # E2E — launches real Electron app (Playwright)
npm run test:coverage   # Coverage report in coverage/
npm run test:stories    # The design system's Storybook stories, run as tests
npm run test:visual     # The design system's screenshot tests
```

Coverage is gated by Codecov on the pull request, not locally ([ADR 095](adr/095-coverage-is-gated-by-codecov.md)). `codecov/patch` needs 80% of the lines your change adds or modifies, and `codecov/project` must not drop. A test covers a scenario the running app can produce; a branch no real caller can reach is deleted, not tested.

### Measure performance

```bash
npm run build
node scripts/perf/app-metrics.mjs --runs=5 --throughput
```

Prints the median start-up milestones (process attached, window, DOM ready, sidebar), memory per process type after the app settles, and the time to print 50 MB in a terminal. A change that claims a speed-up records this before and after in its commit.

### E2E rules

E2E runs with no retries, so a test that fails once fails the build ([ADR 070](adr/070-e2e-is-deterministic-and-selective.md)).

- Never sleep. Wait on the condition you assert next: a locator assertion, or `expect.poll`. ESLint rejects `waitForTimeout` in `tests/e2e`.
- Every test passes alone (`npx playwright test tests/e2e/<file>:<line>`), unless it is part of a `test.describe.serial` story, which runs as a whole. Use serial only for a sequence that cannot be split.
- Before sending keys to a surface you just opened, assert that it has focus.
- Launch the app through `launchApp()`. It isolates the profile, runs the terminals on a fixture zsh config (`tests/e2e/fixtures/zdotdir`) whose `claude` is a stub, so no real agent runs, and turns off macOS window restore, whose crash prompt blocks startup.
- A new spec goes in `scripts/e2e-select.mjs`: under the extension it covers, or in `CORE_SPECS`. The selector's unit test fails for a spec that is in neither.
- CI runs only the specs your diff selects, plus the smoke set. Changed specs run three times. To see what your branch selects: `node scripts/e2e-select.mjs origin/main`.

### Build extensions

Each extension's backend (`src/index.ts`) is bundled to CommonJS by esbuild, and its view by its own Vite config into `dist/` (`scripts/build-extensions.cjs`). The output is gitignored — never commit `extensions/*/src/index.js`. Always rebuild after changing extension source files:

```bash
npm run build:extensions   # compile all extensions
```

`npm run dev` and `npm run build` call this automatically.

### Lint and format

```bash
npm run lint       # ESLint (zero errors required)
npm run lint:deps  # syncpack: exact versions, one per package
npm run lint:unused  # knip: no unused files, exports or dependencies
npm run lint:duplicates  # jscpd: no copy-pasted code
npm run typecheck  # TypeScript type check (no emit — zero errors required)
npm run format     # Prettier (auto-fixes)
```

The root `npx tsc --noEmit` checks nothing; use `npm run typecheck`, which checks main, renderer, shared, both packages and every extension. Both `lint` and `typecheck` must pass with **0 errors** before opening a PR. Warnings are acceptable but should not accumulate.

`npm run lint:unused` runs [knip](https://knip.dev) with `knip.jsonc` and must report nothing ([ADR 102](adr/102-unused-code-is-a-ci-gate.md)). Its plugins find the entry points: electron-vite's main, preload and renderer inputs, each extension's `src/index.ts` and view, Vite, Vitest, Playwright and Storybook configs, and the `exports` of the SDK and the design system, which are their public API. When it reports something:

- Unused and unreachable: delete it, with any test that covers only it (Constitution VI).
- Exported but used only in its own file: drop the `export`.
- Reached in a way knip cannot see (loaded by path at run time, a global declaration): add it to `knip.jsonc` with a comment that says how it is reached, and check that claim with `grep`.

`npm run lint:duplicates` runs [jscpd](https://github.com/kucherenko/jscpd) with `.jscpd.json` and must find no clones ([ADR 103](adr/103-duplicate-code-is-a-ci-gate.md)). A clone is a block of at least 6 lines and 60 tokens that appears twice in `src`, `packages` or `extensions`. Specs, `tests` and `stories` folders are not checked. When it reports one, move the code to the one place both copies may import:

- Inside one extension: a module of that extension.
- Between the core and an extension, or between two extensions: `@terminator/extension-ui` (views, styles) or `@terminator/extension-sdk` (everything else). An extension never imports another extension or the core.
- CSS: group the shared declarations into one rule. Put it where no selector in it loses to a rule it used to follow.

Do not add a path to `ignore` to make a clone go away. The gate uses jscpd 5.4.1 ([npm](https://www.npmjs.com/package/jscpd/v/5.4.1)), the Rust rewrite with no JavaScript dependencies. It does not use 4.x, which pulls in `braces` through `fast-glob`, affected by [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) with no patched release.

---

## Branching

All work happens on feature branches. Direct commits to `main` are **forbidden**.

Feature branches follow the naming convention:

```
{sequential-number}-{kebab-case-description}
e.g. 001-extension-first-terminal
     002-marketplace-phase-two
```

---

## TDD (Non-Negotiable)

Per the [project constitution](../.specify/memory/constitution.md), **no production code is written without a failing test first**.

1. Write a failing test that captures the requirement.
2. Implement the minimum code to make it pass.
3. Refactor under a green suite.

Test location by type:

| Type        | Location                         | When to use                                                |
| ----------- | -------------------------------- | ---------------------------------------------------------- |
| Unit        | `tests/unit/`                    | Pure logic — schemas, storage, pty-manager, extension host |
| Integration | `tests/integration/`             | IPC round-trips, storage read/write                        |
| E2E         | `tests/e2e/`                     | Full acceptance scenarios against the real Electron app    |
| Extension   | `extensions/*/tests/`            | Each extension's own unit and integration tests            |
| Stories     | `packages/extension-ui/stories/` | Design system components, in both themes                   |

---

## Documentation Requirements

**Documentation ships in the same PR as the code.** A feature is not complete until docs are updated. This is a hard requirement from the project constitution (Principle VIII).

### When you add or change something, update:

| Change                              | Documentation to update                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| New feature or user-facing behavior | `README.md` features list, `docs/user-guide/USER-GUIDE.md` and/or `docs/ARCHITECTURE.md`                     |
| New core IPC channel                | `src/shared/electron-api/manifest.ts`, and the namespace table in `docs/ARCHITECTURE.md` for a new namespace |
| Change to the Extension API         | `packages/extension-sdk/types/api.d.ts`, its `CHANGELOG.md` and version, and `docs/EXTENSION-DEVELOPMENT.md` |
| New npm script                      | `README.md` scripts table                                                                                    |
| Architectural decision              | New ADR in `docs/adr/`                                                                                       |
| Data model change                   | The feature's `specs/<feature>/data-model.md` and `docs/ARCHITECTURE.md`                                     |
| Setup step change                   | `README.md` and `docs/CONTRIBUTING.md`                                                                       |
| New keyboard shortcut               | `README.md` features list and `CORE_SHORTCUTS` in `src/renderer/quick-actions/shortcut-behaviors.ts`         |

---

## IPC Contracts

`src/shared/electron-api/manifest.ts` is the one declaration of the core's channels. To add one:

1. Describe it in your feature's `specs/<feature>/contracts/`.
2. Add the Zod payload schema to `src/shared/schemas/` (or beside the handler for a one-off shape).
3. Declare it in `src/shared/electron-api/manifest.ts` with its `signature`. The native and remote adapters, the remote allowlist and the renderer's `window.electronAPI` type all come from that one entry. If extension views need it, mark it `extensionView` and add it to `src/main/preload-webview.ts`; its spec fails until the two agree.
4. Register it in the appropriate `src/main/ipc/*.ipc.ts` file as a row of `registerInvokeTable([...invokeSpec({ channel, schema, invalid, run })])` in `src/main/ipc/invoke-table.ts`.

Core invoke channels are registered **only** through that table ([ADR-096](adr/096-every-ipc-channel-has-a-schema.md)). `schema` is a required field, so a channel without one does not compile; `invalid` is the response returned when the payload fails the schema, and `onError` (optional) maps a throwing `run` to a response. A channel that takes no payload uses `noPayload`. Do not call `handleChannel` from a handler module — ESLint rejects the import outside the table and the extension API. Do not write a "rejects a malformed payload" test for the new channel: `tests/unit/ipc/core-channel-schemas.spec.ts` already asserts that every registered core channel has a schema and rejects a payload of the wrong type.

---

## Architectural Decision Records (ADRs)

Significant decisions require an ADR in `docs/adr/`. ADRs are numbered sequentially (`005-`, `006-`, …). Template:

```markdown
# ADR-NNN: Title

**Date**: YYYY-MM-DD
**Status**: Accepted | Superseded by ADR-NNN

## Decision

One sentence.

## Motivation

Why this decision was made.

## Alternatives Considered

What else was evaluated and why it was rejected.

## Consequences

What this decision enables and what it constrains.
```

ADRs are **immutable**. If a decision is reversed, write a new ADR that supersedes the old one — do not edit the original.

---

## Dependency Policy

Per the constitution (Principle IV):

- New dependencies require a brief justification in the PR: community health signal and official docs link.
- Versions are exact (no `^`, `~`, `*` or `latest`), and each package has one version across every `package.json` in the repository ([ADR 097](adr/097-one-version-per-dependency.md)).
- The standard library must be used when it covers the need; do not add a package for something Node.js provides.

`npm run lint:deps` (`syncpack lint`) checks both version rules. npm `overrides` in `package.json` are kept only to force a patched version of a transitive dependency, and each one is listed here with its advisories:

| Override             | Patched version | Advisories                                                                                                                                         |
| -------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brace-expansion@^5` | 5.0.12          | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) |
| `fast-uri`           | 3.1.8           | [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj), [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3) |
| `find-my-way`        | 9.7.0           | [GHSA-c96f-x56v-gq3h](https://github.com/advisories/GHSA-c96f-x56v-gq3h)                                                                           |
| `js-yaml@4`          | 4.3.2           | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh)                                                                           |
| `postcss`            | 8.5.24          | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) |
| `tar`                | 7.5.22          | [GHSA-r292-9mhp-454m](https://github.com/advisories/GHSA-r292-9mhp-454m), [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw) |

Dependency install scripts are blocked by npm unless listed in `allowScripts` in `package.json` ([npm docs](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts)). Review a new one with `npm install-scripts ls` before approving it.

---

## PR Checklist

Before opening a PR, verify:

- [ ] All tests pass (`npm test`)
- [ ] `npm run lint`, `npm run lint:deps`, `npm run lint:unused`, `npm run lint:duplicates` and `npm run typecheck` pass with 0 errors
- [ ] `npm run format:check` passes
- [ ] `npm run build:extensions` succeeds (no compile errors)
- [ ] No unused imports, variables, or dead code introduced
- [ ] Documentation updated for every changed behavior (see table above)
- [ ] New core IPC channels declared in `src/shared/electron-api/manifest.ts` and registered through the invoke table
- [ ] ADR written if a significant architectural decision was made
