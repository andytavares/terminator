# ADR 123: Tests run once, sealed, and only the ones a change can reach

**Status**: Accepted

**Date**: 2026-10-22

Supersedes in part ADR 070 ("changed specs run three times", the e2e burn-in) and amends ADR 071 (shard count) and ADR 120 (no rerun in Foundry's final check).

## Context

CI was red on most pull requests for weeks, and the same commit gave different answers on different runs. Five inputs, other than the code and the test, decided a result:

| Input            | How it varied                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Order            | A spec that leaned on another's leftovers passed or failed depending on what ran before it                           |
| Timing           | Per-spec timeouts of 5 s to 120 s, and a machine busy with other specs, turned "slow" into "failed"                  |
| Environment      | Unit shards ran on Linux, the app and E2E on macOS, and a laptop is a third; `HOME`, git config and `PATH` leaked in |
| Outside services | `npm audit` and Codecov failed the build for what the pull request did not change                                    |
| Selection        | CI ran the specs a diff selected plus burn-in, and `ci:local` ran its own                                            |

## Decision

Terminator is macOS only. A result depends on the code and the test, and nothing else. Each input is closed:

- **Order.** No test depends on another (Constitution XIV), and the order is what proves it: every run shuffles the spec files and the tests inside each file with a new seed (`vitest.config.ts`), in CI, in `ci:local` and in `npm test`, and prints it. `TEST_SEED=<seed>` replays a failing order exactly. A test that fails in some order is rewritten to be independent; pinning the order is forbidden.
- **One run.** No repeat, retry or burn-in anywhere: not in vitest, not in Playwright, not in CI, not in Foundry's final check. The burn-in of changed e2e specs and its census step are gone, as is `BURN_IN_REPEATS` in `scripts/ci-e2e-local.mjs`. A failing shard does not stop the others (`fail-fast: false`), so one run lists every failure.
- **Timing.** One hang bound in `tests/support/bounds.ts`: 60 s for a test or a hook, 30 s for a wait on a condition; Playwright 180 s per test and 30 s per wait. They are far above any real duration, so a slower machine cannot change a result; they only end a hang. A spec may not set its own.
- **Environment.** Every job runs on `macos-26` (the same hardware as `macos-latest`, Apple silicon, 3 CPUs, 7 GB), as does `ci:local`. The Linux runners and the `apt` install of zsh are gone. Test processes start in one sealed environment (`scripts/test-env.mjs`).
- **Outside services.** Nothing the change does not touch gates it. `npm audit --audit-level=high` runs in Lint only when the pull request changes `package-lock.json`; a new advisory otherwise is found by `.github/workflows/audit.yml`, daily, which opens or updates one issue. Codecov's upload has `fail_ci_if_error: false`. The Test job's verdict is unchanged, and the E2E report stays non-required.
- **Selection.** One selector, `scripts/test-select.mjs`, for unit, integration and e2e, run by CI and by `npm test`. The diff is the commits since the merge base with `origin/main`.
  - Everything runs when `--all` is passed, when the pull request has the label `test: all` (CI sets `TEST_ALL=1`), on a push to main, or when a path in `ALWAYS_ALL` changes: test configuration and setup, `tests/support`, the lockfile and `package.json`, `.nvmrc`, `tsconfig*.json`, the e2e helpers, `scripts/test-env.mjs` and the selector itself.
  - Otherwise the unit specs are those vitest says import a changed file (its own import graph), plus `RUNTIME_READS`: a map from data files read with `fs` at run time (hints, recipes, manifests, stylesheets, fixtures, the workflows) to the specs that read them. A spec fails when a file the source reads is listed nowhere. Specs that read source files by path are added for a changed source file, since no import shows it.
  - Unknown means everything: a source or data file that no spec imports and no map claims runs everything. A docs-only diff runs nothing. A new or edited spec always runs.
  - The e2e specs come from `scripts/e2e-select.mjs`, called by the selector.
  - With a selection, coverage is limited to the changed files (`--coverage.changed=<base>`); with everything, coverage is as before.
  - The selection decides the unit shards: one under 100 specs, four otherwise.

Story screenshots follow the same rule: a story with no baseline fails (`--update-snapshots=none`), in CI and locally. A pull request labelled `update-story-baselines` runs `.github/workflows/story-baselines.yml`, which writes the missing and changed ones on the same macOS image and commits them to the branch.

## Consequences

- A pull request that touches a few files runs a few specs, on the same OS and in the same environment as the check a developer runs before pushing. The order differs on every run by design: a test whose result depends on it is a defect, and the printed seed reproduces it.
- A change to a path the selector does not know is slower, not wrong.
- A push to main runs everything, so a miss in a selection is caught there, and the `test: all` label gets the same run on a pull request.
- A spec that depends on another fails the build in the first order that exposes it, possibly on an unrelated pull request. It is fixed at its cause, never rerun (ADR 120).
- macOS runners are the scarce ones: GitHub allows five macOS jobs at once, so the jobs queue where they once ran apart. Selection pays for it, as most pull requests run a fraction of the suite.
