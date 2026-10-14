# Contributing to Terminator

---

## Setup

```bash
git clone <repo-url>
cd terminator
nvm use            # Node 24.21.0, from .nvmrc: the Node that Electron 44 ships

# Install all dependencies from the root: npm resolves every workspace (versions are pinned — do not use --legacy-peer-deps without cause)
# node-pty loads the N-API prebuilds it ships (macOS, Linux, Windows; x64 and arm64);
# its install script is denied in `allowScripts`, so nothing is compiled.
npm install
```

Electron 44 no longer downloads its binary when it is installed: it does so on first run or through its `install-electron` bin ([breaking changes](https://github.com/electron/electron/blob/v44.7.0/docs/breaking-changes.md)). electron-vite does not run that bin, so `predev` and `prepreview` call `install-electron` before starting the app; it returns at once when the binary is already there.

---

## Development Workflow

### Start the app

```bash
npm run dev        # Electron + hot-reload via electron-vite
```

A dev run uses its own profile, `…/@andytavares/terminator-dev`, so it can run beside the installed app without sharing its database.

### Check that the app starts

```bash
node scripts/smoke-start.mjs dev                  # npm run dev
npm run build && node scripts/smoke-start.mjs preview
node scripts/smoke-start.mjs exec <executable>    # a packaged app
```

Starts the app on a fresh profile and passes when the main log says `App ready`, every extension under `extensions/` logs `Extension <id> activated`, and nothing logs an error or an uncaught exception, in main or a renderer (renderer console output reaches it through [`ELECTRON_ENABLE_LOGGING`](https://www.electronjs.org/docs/latest/api/environment-variables#electron_enable_logging)). It then asks Electron to quit and requires exit code 0. On Linux it turns the Chromium sandbox off and needs a display (`xvfb-run -a`). CI's `Start` job runs the first two on macOS and Linux from a clean `npm ci`, and on Linux packages the app (`npx electron-builder --linux dir --publish never`) and runs the third against `dist/linux-unpacked`.

### Packaging

`electron-builder.cjs` is the packaging configuration. electron-builder ships only the root package's production dependencies, so the bundled extensions and the packages their backends require at run time (`scripts/extension-externals.cjs`, closed over `package-lock.json` by `scripts/extension-runtime-modules.cjs`) are copied in explicitly, to `app.asar/extensions` and `app.asar/extensions/node_modules`. A package an extension backend adds to the esbuild `external` list ships by being in `scripts/extension-externals.cjs`; nothing else needs editing.

`npmRebuild` is off: the one native module, node-pty, loads the N-API prebuild it ships for the platform (`node_modules/node-pty/lib/utils.js`), which does not depend on Electron's ABI. Rebuilding failed outright for Electron 44: "Could not detect abi for version 44.7.0" (@electron/rebuild's node-abi).

`asarUnpack` lists only `postgres.wasm` and `postgres.data` of `@electric-sql/pglite`, which the one-time import (`src/main/db/legacy-pglite-import.ts`, ADR 099) reads with `readFileSync`; Electron's asar fs interception redirects those reads to `app.asar.unpacked`. Unpacking all of the package breaks Electron's ESM dynamic import handler: from `app.asar.unpacked`, pglite's `import("./fs/nodefs.js")` fails to resolve through the asar virtual path, the NodeFS adapter never loads, and `pg_initdb` aborts. The entries go when PGlite is removed, one release after the import ships.

### Run tests

```bash
npm test                # Unit + integration (Vitest), core and extensions
npm run test:watch      # Watch mode
npm run test:e2e        # E2E — launches real Electron app (Playwright)
npm run test:perf       # Wall-clock budgets (*.perf.spec.ts), one file at a time
npm run test:coverage   # Coverage report in coverage/
npm run test:stories    # The design system's Storybook stories, run as tests
npm run test:visual     # The design system's screenshot tests
```

**Temporary directories.** A spec makes one with `makeTempDir(prefix)` from `tests/support/temp-dir.ts`, never with `mkdtempSync` in `os.tmpdir()`: `tests/setup.ts` removes every one after the spec file ends, passed or failed. An E2E spec uses `e2eTempDir(prefix)` from `tests/e2e/helpers.ts`, which `tests/e2e/global-teardown.ts` removes with the run's root. CI runs each unit shard through `node scripts/check-temp-leaks.mjs`, which points `TMPDIR` at an empty directory (read by [`os.tmpdir()`](https://nodejs.org/api/os.html#ostmpdir), git, sh and mktemp) and fails if anything is left in it; run it locally the same way, `node scripts/check-temp-leaks.mjs npx vitest run`. Specs that skipped this once left ~22,000 folders in `/tmp` in a day and filled the disk.

A spec that asserts a wall-clock budget is named `*.perf.spec.ts`. `npm test` leaves it out, because beside every other spec in parallel it measures the load; `npm run test:perf` (`vitest.perf.config.ts`) runs it alone, and CI's `Perf budgets` job runs that.

Notepad's and git-integration's DOM specs run in [happy-dom](https://vitest.dev/guide/environment), not jsdom (`HAPPY_DOM_INCLUDE` in `vitest.config.ts`). They mount CodeMirror and the design system, which inject stylesheets, and jsdom validates every declaration it parses (cssstyle, css-tree, css-color), with no option to turn that off. CodeMirror's 5 KB of theme CSS took 150-250 ms on the first view of each file, and the first test of a file 1-2 s, which went past the five-second timeout on a busy machine. happy-dom parses the same CSS in a few milliseconds, and every spec in both passes unchanged.

Every other spec has to pass on a loaded machine too, where a test can run ten times slower than on an idle one. It waits for the event it needs, never for a fixed time that hopes the event came first. A clock the code reads (a replay, a poll) is a fake one, `vi.useFakeTimers({ toFake: [...] })` with only the timers that code uses. A canvas whose pixels the spec does not check gets no 2D context (`getContext` returns `null`), because a `vi.fn()` fake records every call of every frame. `tests/setup.ts` makes jsdom parse its built-in stylesheet before the first test, so that test is not charged 300 ms for it. To find a flake, run 4–6 copies of the spec at once: `for i in 1 2 3 4 5 6; do npx vitest run <spec> & done; wait`.

Coverage is gated by Codecov on the pull request, not locally ([ADR 095](adr/095-coverage-is-gated-by-codecov.md)). `codecov/patch` needs 80% of the lines your change adds or modifies, and `codecov/project` must not drop. A test covers a scenario the running app can produce; a branch no real caller can reach is deleted, not tested.

### Measure performance

```bash
npm run build
node scripts/perf/app-metrics.mjs --runs=5 --throughput
```

Prints the median start-up milestones (process attached, window, DOM ready, sidebar), memory per process type after the app settles, and the time to print 50 MB in a terminal. A change that claims a speed-up records this before and after in its commit.

`--extensions=each` measures the extension host instead: its memory with no extension, with a probe that loads nothing, with each bundled extension alone and with all of them ([2026-10-12 results](research/perf/2026-10-12-extension-host.md)).

### E2E rules

E2E runs with no retries, so a test that fails once fails the build ([ADR 070](adr/070-e2e-is-deterministic-and-selective.md)).

- Never sleep. Wait on the condition you assert next: a locator assertion, or `expect.poll`. ESLint rejects `waitForTimeout` in `tests/e2e`.
- Every test passes alone (`npx playwright test tests/e2e/<file>:<line>`), unless it is part of a `test.describe.serial` story, which runs as a whole. Use serial only for a sequence that cannot be split.
- Before sending keys to a surface you just opened, assert that it has focus.
- On Linux `launchApp()` moves the window off the X server's pointer. Chromium on X11 synthesizes a mousemove at the real pointer whenever a view under it is added, removed or resized, as an extension view is when its extension activates. Xvfb parks the pointer inside the window, and the move carries no pressed button, so it lands between Playwright's mouse down and mouse move and Chromium abandons the drag: `dragTo` returned and nothing was dropped. macOS does not synthesize it.
- Launch the app through `launchApp()`. It isolates the profile, runs the terminals on a fixture zsh config (`tests/e2e/fixtures/zdotdir`) whose `claude` is a stub, so no real agent runs, and turns off macOS window restore, whose crash prompt blocks startup. A launch that does not reach the sidebar in 25 s fails with each window's state (its URL, whether it was still loading, whether its renderer crashed, or that main did not answer) and the app's own output. Close it with `closeApp()`: it returns only once the app's process has exited (killing it after 5 s), then fails the spec if any process the app started is still running 3 s later, and kills those and every process under them (`tests/e2e/leftover-processes.ts`). It finds them by the launch's marker in their environment and by the app's process tree taken just before the close, which also covers the git and gh commands the core runs with an environment of their own. Leaked processes add up on a CI runner until `fork` fails with `EAGAIN`; a process your feature starts must end when the app quits. CI prints the runner user's processes against its limit before and after each macOS E2E step, with the parent commands and a few full command lines of the commonest (`scripts/process-census.sh`).
- Read what a terminal shows with `readTerminalRows(page)` from `tests/e2e/helpers.ts`, never from `.xterm-rows`. A visible terminal draws with WebGL into a canvas and the DOM holds none of its text; `readTerminalRows` reads xterm's buffer through `window.terminatorE2E`, which the app sets up in `src/renderer/terminal/terminal-rows.ts`. It reads every open terminal, hidden ones too, one after another; when the row's terminal or its place on screen matters, read one pane with `readTerminalRowsIn(screen)`, where `screen` is that pane's `.xterm-screen` (`visibleTerminalScreen(page)` for the first one on screen). To run the specs on the WebGL renderer, as macOS does, on Linux: `E2E_ELECTRON_ARGS="--no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist"`.
- A new spec goes in `scripts/e2e-select.mjs`: under the extension it covers, or in `CORE_SPECS`. The selector's unit test fails for a spec that is in neither.
- **Live specs** (`tests/e2e/live/`) run a real agent on an order (`live-order.ts`). `full-run.spec.ts` polls until the run says it is over, never until the graph settles: the ladder's climb, then the push and the draft pull request, all come after the last node leaves the graph. Breaking on a settled graph once asserted against GitHub mid-climb and closed the app, killing the step the test is named after. Its polling deadline (45 minutes) is longer than the order's budget, so the budget gate is seen when it fires, and its test timeout is longer than the deadline, so the test reports the run instead of Playwright killing it. The order's budget leaves room for the pipeline plus the climb: four agents and eight rungs take fifteen minutes on a good run, and at twenty minutes a slow builder hit the gate instead of shipping.
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
npm run lint:unused:production  # knip --production: no code that only tests reach
npm run lint:duplicates  # jscpd: no copy-pasted code
npm run typecheck  # TypeScript type check (no emit — zero errors required)
npm run format     # Prettier (auto-fixes)
```

The root `npx tsc --noEmit` checks nothing; use `npm run typecheck`, which checks main, renderer, shared, the core's specs (`tsconfig.test.json`: everything under `tests/unit`, `tests/integration` and `tests/e2e`; Playwright runs the e2e specs without checking their types, so this is the only check they get), both packages and every extension, each with its specs. Vitest and Playwright strip types without checking them, so every project whose `tsconfig.json` covers its sources only has a `tsconfig.test.json` beside it that extends that config and adds its tests: each extension's (`typecheck:extensions` runs `tsconfig.json` then `tsconfig.test.json`, which adds `tests/`, Vitest's globals and Node 24's library) and the design system's (its Playwright screenshot suite, `visual/`). The extension SDK's `tsconfig.json` already includes its `tests/`. A new extension written in TypeScript adds both files and both `tsc -p` runs to `typecheck:extensions`. Task Vault has a third, `tsconfig.view.json`, which checks its view from `src/renderer/main.tsx` without the `Temporal` types its backend has: the view also runs in the phone's browser, where iPhone Safari has no `Temporal` ([ADR 108](adr/108-temporal-in-extension-backends-not-in-views.md)). CI's Typecheck job runs `npm run typecheck`. Both `lint` and `typecheck` must pass with **0 errors** before opening a PR. Warnings are acceptable but should not accumulate.

`npm run lint` holds every function in every JavaScript and TypeScript file to size limits (the last block of `eslint.config.mjs`), specs, stories, scripts and configs included. The limits are:

- at most 30 lines, blank lines and comments aside (`max-lines-per-function`);
- complexity at most 10 (`complexity`);
- at most three parameters (`max-params`).

Tests are functions too, so a `describe` callback longer than 30 lines is split into describes named by topic. Shared hooks go into a module-level setup function (`function useX(): void { beforeEach(...) }`) that each describe calls. An e2e describe that shares one app through `beforeAll`, or is `test.describe.serial`, is not split, because its tests depend on the app and the order they run in: each test's body becomes a named function above it, and the describe lists the story (`test('title', stepName)`). A React component that outgrows them is split the way [Thinking in React](https://react.dev/learn/thinking-in-react) describes: named subcomponents for the parts of the UI, and hooks for state and effects that belong together (`src/renderer/shell/` holds the ones `App.tsx` wires up). Keep its hooks in the order they were called, because effects run in that order: Foundry's Forge, Floor and factory hall each gather theirs in one hook that calls the others in sequence (`useForgeState`, `useFloor`, `useFactoryHall`), and work out what they draw in a plain function beside it (`deriveForge`, `hallModel`). Code that draws or lays something out is checked against what it did before the split, call for call, and not only against its specs. Pass more than three values as one named object, and only where that is the natural shape.

`npm run lint` also rejects an explicit `any` (`@typescript-eslint/no-explicit-any` is an error). A spec fakes part of an object with `partialFake` (`tests/support/fakes.ts`), never `as unknown as`. The two `any`s left are each behind an `eslint-disable` comment that says why: the IPC handler signature that mirrors Electron's own (`src/main/ipc/channel-registrar.ts`) and electron-store's constraint on a schema (`src/main/storage/cached-store.ts`).

`npm run lint:unused` runs [knip](https://knip.dev) with `knip.jsonc` and must report nothing ([ADR 104](adr/104-unused-code-is-a-ci-gate.md)). Its plugins find the entry points: electron-vite's main, preload and renderer inputs, each extension's `src/index.ts` and view, Vite, Vitest, Playwright and Storybook configs, and the `exports` of the SDK and the design system, which are their public API. When it reports something:

- Unused and unreachable: delete it, with any test that covers only it (Constitution VI).
- Exported but used only in its own file: drop the `export`.
- Reached in a way knip cannot see (loaded by path at run time, a global declaration): add it to `knip.jsonc` with a comment that says how it is reached, and check that claim with `grep`.

`npm run lint:unused:production` runs the same configuration in knip's [production mode](https://knip.dev/features/production-mode), which leaves out tests and stories, and must report nothing too ([ADR 107](adr/107-production-only-unused-code-is-a-ci-gate.md)). A finding there is code that only a test reaches:

- Nothing in the app calls it: delete it with its tests.
- It is what a spec expects, not what the app does (a table of shortcuts, a list of sanctioned operations): move it beside the spec.
- It is a test seam (a clock setter, a reset): fake what the app reads instead (`vi.useFakeTimers`, `vi.resetModules`) and delete the seam.
- The app runs it from inside its own file, and a spec tests it directly: drop the `export` and test it through its caller, or tag it `/** @internal */` ([knip](https://knip.dev/reference/jsdoc-tsdoc-tags#internal)).
- A new production entry (an extension's `src/index.ts`, a file loaded by path): end its pattern in `knip.jsonc` with `!`.

`npm run lint:duplicates` runs [jscpd](https://github.com/kucherenko/jscpd) with `.jscpd.json` and must find no clones ([ADR 105](adr/105-duplicate-code-is-a-ci-gate.md)). A clone is a block of at least 6 lines and 60 tokens that appears twice in `src`, `packages` or `extensions`. Specs, `tests` and `stories` folders are not checked. When it reports one, move the code to the one place both copies may import:

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

`allowScripts` in `package.json` records which dependencies may run install scripts ([npm docs](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts)). npm 11 runs an unreviewed script and lists it after the install; a later npm release will block it. List unreviewed ones with `npm install-scripts ls` and approve or deny each before it lands.

---

## PR Checklist

Before opening a PR, verify:

- [ ] All tests pass (`npm test`)
- [ ] `npm run lint`, `npm run lint:deps`, `npm run lint:unused`, `npm run lint:unused:production`, `npm run lint:duplicates` and `npm run typecheck` pass with 0 errors
- [ ] `npm run format:check` passes
- [ ] `npm run build:extensions` succeeds (no compile errors)
- [ ] No unused imports, variables, or dead code introduced
- [ ] Documentation updated for every changed behavior (see table above)
- [ ] New core IPC channels declared in `src/shared/electron-api/manifest.ts` and registered through the invoke table
- [ ] ADR written if a significant architectural decision was made
