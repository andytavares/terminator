# ADR 123: Tests run once, sealed, and only the ones a change can reach

**Status**: Accepted, amended by ADR 124 and ADR 132

**Date**: 2026-10-22

Supersedes in part ADR 070 ("changed specs run three times", the e2e burn-in) and amends ADR 071 (shard count) and ADR 120 (no rerun in Foundry's final check).

## Context

CI was red on most pull requests for weeks, and the same commit gave different answers on different runs. Five inputs, other than the code and the test, decided a result:

| Input            | How it varied                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Order            | A spec that leaned on the leftovers of another spec passed or failed, depending on what ran before it                |
| Timing           | Per-spec timeouts of 5 s to 120 s, and a machine busy with other specs, turned "slow" into "failed"                  |
| Environment      | Unit shards ran on Linux, the app and E2E on macOS, and a laptop is a third; `HOME`, git config and `PATH` leaked in |
| Outside services | `npm audit` and Codecov failed the build for what the pull request did not change                                    |
| Selection        | CI ran the specs that a diff selected plus burn-in, and `ci:local` ran its own                                       |

## Decision

Terminator is macOS only. A result depends on the code and the test, and on nothing else. Each input is closed:

- **Order.** No test depends on another (Constitution XIV), and the order proves it. Every run shuffles the spec files, and the tests inside each file, with a new seed (`vitest.config.ts`). This happens in CI, in `ci:local` and in `npm test`, and each run prints the seed. `TEST_SEED=<seed>` replays a failing order exactly. Rewrite a test that fails in some order so that it is independent. Pinning the order is forbidden.
- **One run.** There is no repeat, retry or burn-in anywhere: not in vitest, not in Playwright, not in CI, not in the final check of Foundry. The burn-in of changed e2e specs and its census step are gone, as is `BURN_IN_REPEATS` in `scripts/ci-e2e-local.mjs`. A failing shard does not stop the others (`fail-fast: false`), so one run lists every failure.
- **Timing.** One hang bound in `tests/support/bounds.ts`: 60 s for a test or a hook, 30 s for a wait on a condition. Playwright uses 180 s per test and 30 s per wait. The bounds are far above any real duration, so a slower machine cannot change a result. They only end a hang. A spec must not set its own bound.
- **Environment.** Only what runs the app is on `macos-26` (Apple silicon, 3 CPUs, 7 GB): the three E2E shards, Start and the story screenshots. GitHub runs five macOS jobs at a time below Enterprise (https://docs.github.com/en/actions/reference/limits). The 19 macOS jobs that CI once had queued for up to 7.6 minutes. Every other job runs on `ubuntu-24.04-arm`. `ci:local` runs those steps in a container of the same Ubuntu, on arm64, with the `.nvmrc` Node (`scripts/ci-linux.mjs`). So a failure that only Linux has shows on the Mac before the push. Every job has a time limit of 8 minutes or less. Test processes start in one sealed environment (`scripts/test-env.mjs`).
- **Outside services.** Nothing that the change does not touch gates the change. `npm audit --audit-level=high` runs in Lint only when the pull request changes `package-lock.json`. Otherwise `.github/workflows/audit.yml` finds a new advisory, daily, and opens or updates one issue. The upload of Codecov has `fail_ci_if_error: false`. The verdict of the Test job is unchanged, and the E2E report stays non-required.
- **Selection.** One selector, `scripts/test-select.mjs`, serves unit, integration and e2e. CI and `npm test` run it. The diff is the commits since the merge base with `origin/main`.
  - Everything runs in these cases: `--all` is passed, the pull request has the label `test: all` (CI sets `TEST_ALL=1`), a push to main, or a change to a path in `ALWAYS_ALL`. The paths in `ALWAYS_ALL` are test configuration and setup, `tests/support`, the lockfile and `package.json`, `.nvmrc`, `tsconfig*.json`, the e2e helpers, `scripts/test-env.mjs` and the selector itself.
  - Otherwise the unit specs are the specs that vitest says import a changed file (its own import graph), plus `RUNTIME_READS`. `RUNTIME_READS` is a map from data files that code reads with `fs` at run time (hints, recipes, manifests, stylesheets, fixtures, the workflows) to the specs that read them. A spec fails when a file that the source reads is listed nowhere. Specs that read source files by path are added for a changed source file, since no import shows the link.
  - Unknown means everything: a source or data file that no spec imports and no map claims runs everything. A docs-only diff runs nothing. A new or edited spec always runs.
  - The e2e specs come from `scripts/e2e-select.mjs`, which the selector calls.
  - With a selection, coverage is limited to the changed files (`--coverage.changed=<base>`). With everything, coverage is as before.
  - The selection decides the unit shards: one under 100 specs, four otherwise.

Story screenshots follow the same rule. A story with no baseline fails (`--update-snapshots=none`), in CI and locally. A pull request with the label `update-story-baselines` runs `.github/workflows/story-baselines.yml`. The workflow writes the missing and changed baselines on the same macOS image and commits them to the branch.

## Consequences

- A pull request that touches a few files runs a few specs. The specs run on the same OS and in the same environment as the check that a developer runs before pushing. The order differs on every run by design. A test whose result depends on the order is a defect, and the printed seed reproduces it.
- A change to a path that the selector does not know is slower, not wrong.
- A push to main runs everything, so main catches a miss in a selection. The `test: all` label gives a pull request the same run.
- A spec that depends on another spec fails the build in the first order that exposes it, possibly on an unrelated pull request. Fix it at its cause, and never rerun it (ADR 120).
- macOS runners are the scarce ones. GitHub allows five macOS jobs at once, so the jobs queue where they once ran apart. Selection pays for this, as most pull requests run a fraction of the suite.
