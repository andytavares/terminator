# ADR 124: Flaky tests are caught before merge, and quarantined with an expiry

**Status**: Accepted, amended by ADR 132

**Date**: 2026-10-23

Amends ADR 123 ("One run").

## Context

ADR 123 removed every repeat: no burn-in, no retry, no quarantine. Order, timing and environment were closed as causes. But the team still found a flaky test only when it failed on the pull request of somebody. The night Dependabot was turned on, eight pull requests opened and three tests flaked on them. `settings.spec.ts` typed before the new terminal had focus. `App.spec.tsx` of Foundry clicked a card before it was drawn. An e2e launch hung without saying where. The team saw two of the three only because the labels of Dependabot gave each pull request three runs of the same commit. Nothing looked for flaky tests on purpose, and nothing stopped a new flaky test from merging.

## Decision

The first run is still the verdict, and nothing retries a failure into a pass. Tests repeat only to find flaky tests:

- **Stability gate.** Every spec that a pull request adds or edits runs 30 times, each time with a fresh seed, while every core is busy (`scripts/stability.mjs`, `scripts/under-load.mjs`). Every e2e spec that the pull request adds or edits runs with `--repeat-each=5`. One failure fails the check and prints the seed that reproduces it. CI splits the 30 runs over parallel runners, and splits the specs too when there are many, so each runner fits in 7 minutes (`stabilityShards`; 96 specs take 10 runners of 3 runs). The required check, Stability, is red unless every runner passed. A test that fails 10% of the time survives 30 runs 4.2% of the time.
- **Nightly sweep.** `.github/workflows/stability-sweep.yml` runs the whole unit suite five times and the e2e suite twice on one commit of `main`. `scripts/flaky-sweep.mjs` reads the JSON reports. It opens or updates one issue per test that passed and failed on the same commit.
- **Quarantine.** You can tag a test that the sweep found flaky `quarantine` (Vitest tags) or `@quarantine` (Playwright tags), and list it in `tests/quarantine.json` with its issue and an expiry at most 7 days away. Required jobs exclude the test (`--tagsFilter='!quarantine'`, `--grep-invert @quarantine`). The Quarantine job runs only those tests and does not gate. `scripts/check-quarantine.mjs` fails Lint in these cases: an entry is expired, more than 5 tests are listed, a test new to the change is quarantined, or a change edits a quarantined spec and keeps it there.
- **Results.** Every unit and e2e shard uploads JUnit to Codecov Test Analytics with `fail_ci_if_error: false`, for history. Codecov never decides a check.

The team considered Trunk Flaky Tests. It detects and auto-quarantines by overriding the exit code of the test step. The team rejected it, because an outside service would then decide whether a check passes, and `ci:local` could not reproduce that.

## Consequences

- A pull request that changes a spec takes longer: about 30 runs of that spec file, and five runs of an e2e spec on a macOS runner.
- A flaky test written today fails its own pull request instead of the pull request of someone else next week.
- The sweep names a flaky test already on `main` within a day. The test blocks other work for at most 7 days while someone fixes or deletes it.
- Retries stay at zero (`playwright.config.ts`), and skipping a test is still forbidden.
