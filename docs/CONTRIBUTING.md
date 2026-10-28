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

Electron 44 no longer downloads its binary when it is installed: it does so on first run or through its `install-electron` bin ([breaking changes](https://github.com/electron/electron/blob/v44.7.0/docs/breaking-changes.md)). electron-vite does not run that bin, so `predev` and `prepreview` call `install-electron` before starting the app; it returns at once when the binary is already there. `pretest:e2e` does the same: otherwise each Playwright worker downloads the binary on its first launch, and the workers unpack it over each other in a fresh checkout.

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

Starts the app on a fresh profile and passes when the main log says `App ready`, every extension under `extensions/` logs `Extension <id> activated`, and nothing logs an error or an uncaught exception, in main or a renderer (renderer console output reaches it through [`ELECTRON_ENABLE_LOGGING`](https://www.electronjs.org/docs/latest/api/environment-variables#electron_enable_logging)). It then asks Electron to quit and requires exit code 0. The app runs in the background (`TERMINATOR_RUN_IN_BACKGROUND=1`), so no window appears. CI's `Start` job runs the first two on macOS from a clean `npm ci`, then packages the app unsigned and not notarized (`npx electron-builder --mac dir --publish never -c.mac.identity=null -c.mac.notarize=false`) and runs the third against `dist/mac-arm64/Terminator.app`.

### Packaging

`electron-builder.cjs` is the packaging configuration. electron-builder ships only the root package's production dependencies, so the bundled extensions and the packages their backends require at run time (`scripts/extension-externals.cjs`, closed over `package-lock.json` by `scripts/extension-runtime-modules.cjs`) are copied in explicitly, to `app.asar/extensions` and `app.asar/extensions/node_modules`. A package an extension backend adds to the esbuild `external` list ships by being in `scripts/extension-externals.cjs`; nothing else needs editing.

`npmRebuild` is off: the one native module, node-pty, loads the N-API prebuild it ships for the platform (`node_modules/node-pty/lib/utils.js`), which does not depend on Electron's ABI. Rebuilding failed outright for Electron 44: "Could not detect abi for version 44.7.0" (@electron/rebuild's node-abi).

`asarUnpack` also lists the Claude adapter (`@agentclientprotocol/claude-agent-acp`) and every package it imports. It runs as a child process, which resolves its imports on disk and cannot read `app.asar`; a missing one makes every agent start fail with "ACP connection closed". `tests/unit/config/asar-unpack.spec.ts` fails when an adapter dependency is not listed.

The `zip` target and the `publish` section exist for self-update (ADR 128): each build writes `dist/latest-mac.yml`, and `release.yml` uploads it with the zip and the blockmaps. Installed apps find a release only through that file.

#### Signing certificate

`release.yml` signs with the Developer ID Application certificate in the `APPLE_CERTIFICATE` secret (a base64 `.p12`, password in `APPLE_CERTIFICATE_PASSWORD`). It must come from Apple's Developer ID G2 authority: the original authority expires on February 1, 2027, and the `Check the signature` step fails any build signed from it. G2 certificates last one year; the same step warns 30 days before expiry. To renew:

1. In Certificates, Identifiers & Profiles, add a **Developer ID Application** certificate and choose the **G2 Sub-CA** intermediary.
2. Confirm it: `openssl x509 -inform DER -in developerID_application.cer -noout -issuer` must show `OU=G2`.
3. Install it and [`DeveloperIDG2CA.cer`](https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer) in the login keychain, then export the new identity from Keychain Access as a `.p12`.
4. `base64 -i terminator-g2.p12 | gh secret set APPLE_CERTIFICATE`, then `gh secret set APPLE_CERTIFICATE_PASSWORD`, and delete the `.p12`.
5. Run the `Test Notarization` workflow and confirm it passes.

### Before you push

```bash
npm run ci:local        # Every check CI runs, at once as CI runs them; e2e last
npm run ci:local:e2e    # Only the e2e job: specs selected by the diff, ci.yml's three shards at once, two apps each
```

`npm run ci:local` runs what `.github/workflows/ci.yml` runs, where CI runs it. A local pass must predict a CI pass, so it tests what CI tests:

- **The same commit.** It fetches `origin/main`, merges your `HEAD` with it in the persistent check worktree `.worktrees/.ci-local`, and runs there. It never tests your dirty working tree, and it prints the `HEAD` and `origin/main` shas first. If the merge conflicts it stops and says so.
- **The same machine.** CI runs the app (E2E, Start, story screenshots) on macOS and every other job on `ubuntu-24.04-arm`. ci:local runs the macOS steps on this Mac and the Ubuntu steps in a Docker container of Ubuntu 24.04 on arm64 with the `.nvmrc` Node (`scripts/ci-linux.Dockerfile`, `scripts/ci-linux.mjs`), so it needs Docker running. The container works in a second worktree at the same merged commit, `.worktrees/.ci-local-linux`, so its jobs and the Mac's never write into each other's files; its `node_modules` are Docker volumes of Linux installs.
- **The same Node.** It refuses to start unless `node -v` is `v` plus the version in `.nvmrc`, and names both.
- **The same install.** In the check worktree, on the Mac and in the container, it runs `npm ci` when the hash of `package-lock.json` differs from the one recorded in `node_modules/.lock-hash` after the last install; otherwise it keeps `node_modules`.
- **The same checks.** `scripts/ci-plan.mjs` reads each job's own `run` steps from the workflow, so the two cannot drift. A GitHub expression or condition it does not know stops it, naming the job and step. It runs the jobs at once, as CI does: a job starts when the jobs it `needs` have passed, a failure lets the running jobs finish and skips the ones that need it, and each job's output prints as one block with its seconds. The e2e specs run last, alone, once every job has passed. Without a flag the diff selects the specs; `--all` runs every test and sets `TEST_ALL=1` for the e2e step. Every step runs without the `GIT_` variables a git hook sets, as CI does. It prints what it leaves to CI and why: the stability gate's repeats of changed specs run in CI only.

`--prepare-only` does the Node check, the fetch, the merge and the install, prints the shas, and exits.

On a pass it records `<HEAD sha> <origin/main sha>` in your repository (`git rev-parse --git-path ci-local-passed`) The pre-push hook (`.husky/pre-push`) reads the record and refuses to push a commit with no recorded pass, naming `npm run ci:local`. When it lets a push through, it leaves a background process that waits (up to two minutes) for GitHub to have the commit and then sets its `local-check` commit status through `gh`: GitHub takes a status only for a commit it has. The hook only checks the record: git opens the connection to the remote before it runs the hook, and a hook that ran the whole suite left that connection idle until it dropped. So commit, run `npm run ci:local`, then push. A deleted ref passes, and the hook does nothing where `CI` is set: the release and story-baseline jobs push their own commits.

To see whether local passes have predicted CI, run `node scripts/ci-parity-report.mjs --since 2026-10-15`. It lists every failed CI job on a commit that had a `local-check` success (a parity break) and every commit whose same job both failed and passed (a flip), prints the counts, and exits 1 when either is non-zero.

### Run tests

```bash
npm test                # The unit + integration specs your branch can reach (Vitest), with coverage
npm test -- --all       # Every spec
npm run test:watch      # Watch mode
npm run test:e2e        # E2E — launches real Electron app (Playwright)
npm run test:perf       # Wall-clock budgets (*.perf.spec.ts), one file at a time
npm run test:coverage   # Coverage report in coverage/
npm run test:stories    # The design system's Storybook stories, run as tests
npm run test:visual     # The design system's screenshot tests
```

**Which tests run.** `npm test` runs what `scripts/test-select.mjs` selects for the commits on your branch since `origin/main` (not uncommitted work), and CI runs the same command ([ADR 123](adr/123-tests-run-once-sealed-and-selected.md)). A push to main runs what its change reaches, compared with the commit main was at before. Everything runs for `--all`, for a pull request labelled `test: all`, in the nightly sweep and the release, and when a path that can change every result changes (`ALWAYS_ALL` in the script: test config and setup, `tests/support`, the lockfile, `package.json`, the e2e helpers). A source or data file that no spec imports and no map claims also runs everything. Read the choice with `node scripts/test-select.mjs`, which prints `mode`, `unit`, `e2e`, `base` and `reason`. A data file the source reads with `fs`, which no import shows, goes in `RUNTIME_READS` in that script, with the specs that read it; its unit test fails for one that is listed nowhere. The suite runs once, in a fixed order, with no retry, repeat or shuffle, on macOS in CI as here. With a selection, coverage covers the changed files only.

**Temporary directories.** A spec makes one with `makeTempDir(prefix)` from `tests/support/temp-dir.ts`, never with `mkdtempSync` in `os.tmpdir()`: `tests/setup.ts` removes every one after the spec file ends, passed or failed. An E2E spec uses `e2eTempDir(prefix)` from `tests/e2e/helpers.ts`, which `tests/e2e/global-teardown.ts` removes with the run's root. CI runs each unit shard through `node scripts/check-temp-leaks.mjs`, which points `TMPDIR` at an empty directory (read by [`os.tmpdir()`](https://nodejs.org/api/os.html#ostmpdir), git, sh and mktemp) and fails if anything is left in it; run it locally the same way, `node scripts/check-temp-leaks.mjs npx vitest run`. Specs that skipped this once left ~22,000 folders in `/tmp` in a day and filled the disk.

A spec that asserts a wall-clock budget is named `*.perf.spec.ts`. `npm test` leaves it out, because beside every other spec in parallel it measures the load; `npm run test:perf` (`vitest.perf.config.ts`) runs it alone, and CI's `Stories` job runs that after the Storybook build.

Notepad's and git-integration's DOM specs run in [happy-dom](https://vitest.dev/guide/environment), not jsdom (`HAPPY_DOM_INCLUDE` in `vitest.config.ts`). They mount CodeMirror and the design system, which inject stylesheets, and jsdom validates every declaration it parses (cssstyle, css-tree, css-color), with no option to turn that off. CodeMirror's 5 KB of theme CSS took 150-250 ms on the first view of each file, and the first test of a file 1-2 s, which went past the five-second timeout on a busy machine. happy-dom parses the same CSS in a few milliseconds, and every spec in both passes unchanged.

Every other spec has to pass on a loaded machine too, where a test can run ten times slower than on an idle one. It waits for the event it needs, never for a fixed time that hopes the event came first. A clock the code reads (a replay, a poll) is a fake one, `vi.useFakeTimers({ toFake: [...] })` with only the timers that code uses. A canvas whose pixels the spec does not check gets no 2D context (`getContext` returns `null`), because a `vi.fn()` fake records every call of every frame. `tests/setup.ts` makes jsdom parse its built-in stylesheet before the first test, so that test is not charged 300 ms for it. To find a flake, run 4–6 copies of the spec at once: `for i in 1 2 3 4 5 6; do npx vitest run <spec> & done; wait`.

**Every run is sealed and shuffled (ADR 123).** A unit spec sees the same environment on every machine: `tests/global-setup.ts` makes an empty `HOME` for the run and `tests/setup.ts` replaces the worker's `process.env` with `testEnvironment()` from `scripts/test-env.mjs` (UTC, `en_US.UTF-8`, git reading `tests/fixtures/git/gitconfig`, a short PATH), so your shell, `~/.gitconfig` and time zone never reach it. Files and the tests inside them run in a new random order each run, with one worker per core. Vitest prints the seed (`Running tests with seed "<n>"`); a failure that depends on order reproduces with `npx vitest run --sequence.seed=<n>`, and is fixed by making the test not need what ran before it, never by fixing the order. Mocks are restored, stubbed env and globals are unstubbed, and fake timers are real again after every test, so a spy or stub is made in `beforeEach`, not `beforeAll`. In the node project a connection to any host but localhost throws, and a test that leaves an interval, a server, a socket, a watcher or a child process running fails, naming the line that started it. A spec that makes the logger write awaits `flushLogs()` (`src/main/logger.ts`) before its folder goes.

Coverage is gated by Codecov on the pull request, not locally ([ADR 095](adr/095-coverage-is-gated-by-codecov.md)). `codecov/patch` needs 80% of the lines your change adds or modifies, and `codecov/project` must not drop. A test covers a scenario the running app can produce; a branch no real caller can reach is deleted, not tested.

To see whether a test depends on the machine's speed, run it with every core kept busy: `node scripts/under-load.mjs -- npx vitest run <spec>` (`--threads N` to choose how many). The load is threads of that one process, so it ends when the command does. Never make load with background shell jobs (`yes > /dev/null &`): a non-interactive shell cannot kill them reliably, and ten such processes once ran for four hours, until the e2e check refused the machine as busy. That refusal now names the busiest processes.

### Measure performance

```bash
npm run build
node scripts/perf/app-metrics.mjs --runs=5 --throughput
```

Prints the median start-up milestones (process attached, window, DOM ready, sidebar), memory per process type after the app settles, and the time to print 50 MB in a terminal. A change that claims a speed-up records this before and after in its commit.

`--extensions=each` measures the extension host instead: its memory with no extension, with a probe that loads nothing, with each bundled extension alone and with all of them ([2026-10-12 results](research/perf/2026-10-12-extension-host.md)).

### E2E rules

E2E runs with no retries, so a test that fails once fails the build ([ADR 070](adr/070-e2e-is-deterministic-and-selective.md)). An e2e test is a user flow, not a check of one thing ([ADR 115](adr/115-e2e-tests-are-user-flows.md)).

The suite runs in the background, so the machine stays usable while it runs. `launchApp()` sets `TERMINATOR_RUN_IN_BACKGROUND=1` (`src/main/background-mode.ts`). Every window is then created hidden with `backgroundThrottling: false`, which keeps it drawing and visible to the page ([Electron, Page visibility](https://github.com/electron/electron/blob/main/docs/api/browser-window.md#page-visibility)). The app is an `accessory` app, with no Dock icon and no menu bar, so launching it never makes it the active application. Showing or focusing a window does nothing, and no OS notification is shown. Your real cursor never sits over a test window either. Playwright clicks, types and takes screenshots through the DevTools protocol, which needs no visible window. `tests/e2e/fixtures/bin` holds stubs that win over the real tools on the app's PATH: `claude`, `gh`, and `ngrok`, which refuses, so a run never opens a public tunnel with your own ngrok token.

- A flow is one `test()` named for what the user achieves, made of `test.step()`s that each name a behaviour. A spec file launches the app once; a flow restarts it only when surviving the restart is what it checks. A check of one component or one channel is a unit or component test, not a new e2e test.

- Never sleep. Wait on the condition you assert next: a locator assertion, or `expect.poll`. ESLint rejects `waitForTimeout` in `tests/e2e`.
- Every flow passes alone (`npx playwright test tests/e2e/<file>:<line>`), unless its file is `test.describe.serial` because a later flow reads what an earlier one stored; such a file runs as a whole.
- Before sending keys to a surface you just opened, assert that it has focus.
- An extension view is an iframe ([ADR 114](adr/114-extension-views-are-frames-in-the-window.md)), and three things follow. The browser routes a click by the last frame it drew, so click into a host dialog that opened over a view only once it is drawn: `openSettingsSection` waits for that. A key pressed while focus is in a view reaches the host only for ⌘P and ⌘,, which the frame shim forwards; anything else needs focus moved first. A theme or setting reaches a view as a message after the host has it, so poll the view for it. `launchApp()` emulates focus in every view as Playwright does for the page, so focus and blur fire there even when the window is not the active application.
- Launch the app through `launchApp()`. It isolates the profile, runs the terminals on a fixture zsh config (`tests/e2e/fixtures/zdotdir`) whose `claude` is a stub, so no real agent runs, and turns off macOS window restore, whose crash prompt blocks startup. A launch that does not reach the sidebar in 25 s fails with each window's state (its URL, whether it was still loading, whether its renderer crashed, or that main did not answer) and the app's own output. Close it with `closeApp()`: it returns only once the app's process has exited (killing it after 5 s), then fails the spec if any process the app started is still running 3 s later, and kills those and every process under them (`tests/e2e/leftover-processes.ts`). It finds them by the launch's marker in their environment and by the app's process tree taken just before the close, which also covers the git and gh commands the core runs with an environment of their own. Leaked processes add up on a CI runner until `fork` fails with `EAGAIN`; a process your feature starts must end when the app quits. CI prints the runner user's processes against its limit before and after each macOS E2E step, with the parent commands and a few full command lines of the commonest (`scripts/process-census.sh`).
- Read what a terminal shows with `readTerminalRows(page)` from `tests/e2e/helpers.ts`, never from `.xterm-rows`. A visible terminal draws with WebGL into a canvas and the DOM holds none of its text; `readTerminalRows` reads xterm's buffer through `window.terminatorE2E`, which the app sets up in `src/renderer/terminal/terminal-rows.ts`. It reads every open terminal, hidden ones too, one after another; when the row's terminal or its place on screen matters, read one pane with `readTerminalRowsIn(screen)`, where `screen` is that pane's `.xterm-screen` (`visibleTerminalScreen(page)` for the first one on screen).
- A new spec goes in `scripts/e2e-select.mjs`: under the extension it covers, or in `CORE_SPECS`. The selector's unit test fails for a spec that is in neither.
- **Live specs** (`tests/e2e/live/`) run a real agent on an order (`live-order.ts`). `full-run.spec.ts` polls until the run says it is over, never until the graph settles: the ladder's climb, then the push and the draft pull request, all come after the last node leaves the graph. Breaking on a settled graph once asserted against GitHub mid-climb and closed the app, killing the step the test is named after. Its polling deadline (45 minutes) is longer than the order's budget, so the budget gate is seen when it fires, and its test timeout is longer than the deadline, so the test reports the run instead of Playwright killing it. The order's budget leaves room for the pipeline plus the climb: four agents and eight rungs take fifteen minutes on a good run, and at twenty minutes a slow builder hit the gate instead of shipping.
- CI runs only the specs your diff selects, plus the smoke set, each once ([ADR 123](adr/123-tests-run-once-sealed-and-selected.md)). To see what your branch selects: `node scripts/test-select.mjs` (the `e2e` list).

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
npm run lint:workflows   # actionlint + shellcheck on .github/workflows, pinned versions
npm run typecheck  # TypeScript type check (no emit — zero errors required)
npm run format     # Prettier (auto-fixes)
```

The root `npx tsc --noEmit` checks nothing; use `npm run typecheck`, which checks main, renderer, shared, the core's specs (`tsconfig.test.json`: everything under `tests/unit`, `tests/integration` and `tests/e2e`; Playwright runs the e2e specs without checking their types, so this is the only check they get), both packages and every extension, each with its specs. Vitest and Playwright strip types without checking them, so every project whose `tsconfig.json` covers its sources only has a `tsconfig.test.json` beside it that extends that config and adds its tests: each extension's (`scripts/typecheck.mjs` runs `tsconfig.json` and `tsconfig.test.json`, which adds `tests/`, Vitest's globals and Node 24's library) and the design system's (its Playwright screenshot suite, `visual/`). The extension SDK's `tsconfig.json` already includes its `tests/`. A new extension written in TypeScript adds both files and both projects to `typecheckProjects` in `scripts/typecheck.mjs`, which runs every project at once, incrementally (`node_modules/.cache/typecheck`). Task Vault has a third, `tsconfig.view.json`, which checks its view from `src/renderer/main.tsx` without the `Temporal` types its backend has: the view also runs in the phone's browser, where iPhone Safari has no `Temporal` ([ADR 108](adr/108-temporal-in-extension-backends-not-in-views.md)). CI's Typecheck job runs `npm run typecheck`. Both `lint` and `typecheck` must pass with **0 errors** before opening a PR. Warnings are acceptable but should not accumulate.

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

`npm run lint:workflows` runs actionlint 1.7.12 with shellcheck 0.11.0 over `.github/workflows`, the `run:` scripts included. `scripts/workflow-lint.mjs` downloads both once into `node_modules/.cache/workflow-lint` and checks each archive's sha256 first, so CI and this Mac run the same binaries whatever else is on `PATH`. To move to a new version, change its version, URL and checksum there together.

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
3. Declare it in `src/shared/electron-api/manifest.ts` with its `signature`. The native and remote adapters, the remote allowlist and the renderer's `window.electronAPI` type all come from that one entry. If extension views need it, mark it `extensionView`: the frame's `window.electronAPI` is built from the manifest, so nothing else is written by hand.
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

| Override                                        | Patched version | Advisories                                                                                                                                         |
| ----------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agentclientprotocol/claude-agent-acp` → `zod` | 4.6.6           | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)                                                                           |
| `body-parser@2`                                 | 2.4.0           | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828)                                                                           |
| `brace-expansion@^5`                            | 5.0.12          | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) |
| `fast-uri`                                      | 3.1.8           | [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj), [GHSA-qw65-cvwx-89v3](https://github.com/advisories/GHSA-qw65-cvwx-89v3) |
| `find-my-way`                                   | 9.7.0           | [GHSA-c96f-x56v-gq3h](https://github.com/advisories/GHSA-c96f-x56v-gq3h)                                                                           |
| `js-yaml@4`                                     | 4.3.2           | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh)                                                                           |
| `postcss`                                       | 8.5.24          | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) |
| `tar`                                           | 7.5.22          | [GHSA-r292-9mhp-454m](https://github.com/advisories/GHSA-r292-9mhp-454m), [GHSA-23hp-3jrh-7fpw](https://github.com/advisories/GHSA-23hp-3jrh-7fpw) |

`allowScripts` in `package.json` records which dependencies may run install scripts ([npm docs](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts)). npm 11 runs an unreviewed script and lists it after the install; a later npm release will block it. List unreviewed ones with `npm install-scripts ls` and approve or deny each before it lands.

---

## PR Checklist

Before opening a PR, verify:

- [ ] All tests pass (`npm test`)
- [ ] `npm run lint`, `npm run lint:deps`, `npm run lint:unused`, `npm run lint:unused:production`, `npm run lint:duplicates`, `npm run lint:workflows` and `npm run typecheck` pass with 0 errors
- [ ] `npm run format:check` passes
- [ ] `npm run build:extensions` succeeds (no compile errors)
- [ ] No unused imports, variables, or dead code introduced
- [ ] Documentation updated for every changed behavior (see table above)
- [ ] New core IPC channels declared in `src/shared/electron-api/manifest.ts` and registered through the invoke table
- [ ] ADR written if a significant architectural decision was made
