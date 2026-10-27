# ADR 124: Flaky tests are caught before merge, and quarantined with an expiry

**Status**: Accepted, amended by ADR 131

**Date**: 2026-10-23

Amends ADR 123 ("One run").

## Context

ADR 123 removed every repeat: no burn-in, no retry, no quarantine. Order, timing and environment were closed as causes, but a flaky test was still found only when it failed on somebody's pull request. The night Dependabot was turned on, eight pull requests opened and three tests flaked on them: `settings.spec.ts` typed before the new terminal had focus, Foundry's `App.spec.tsx` clicked a card before it was drawn, and an e2e launch hung without saying where. Two of the three were seen only because Dependabot's labels gave each pull request three runs of the same commit. Nothing looked for them on purpose, and nothing stopped a new one from merging.

## Decision

The first run is still the verdict, and nothing retries a failure into a pass. Tests are repeated only to find flaky ones:

- **Stability gate.** Every spec a pull request adds or edits runs 30 times, each with a fresh seed, while every core is busy (`scripts/stability.mjs`, `scripts/under-load.mjs`). Every e2e spec it adds or edits runs with `--repeat-each=5`. One failure fails the check and prints the seed that reproduces it. CI splits the 30 runs over parallel runners, and the specs too when there are many, so each runner fits in 7 minutes (`stabilityShards`; 96 specs take 10 runners of 3 runs); the required check, Stability, is red unless every runner passed. A test that fails 10% of the time survives 30 runs 4.2% of the time.
- **Nightly sweep.** `.github/workflows/stability-sweep.yml` runs the whole unit suite five times and the e2e suite twice on one commit of `main`. `scripts/flaky-sweep.mjs` reads the JSON reports and opens or updates one issue per test that passed and failed on the same commit.
- **Quarantine.** A test the sweep found flaky may be tagged `quarantine` (Vitest tags) or `@quarantine` (Playwright tags) and listed in `tests/quarantine.json` with its issue and an expiry at most 7 days away. Required jobs exclude it (`--tagsFilter='!quarantine'`, `--grep-invert @quarantine`); the Quarantine job runs only those tests and does not gate. `scripts/check-quarantine.mjs` fails Lint when an entry is expired, when more than 5 tests are listed, when a test new to the change is quarantined, or when a change edits a quarantined spec and keeps it there.
- **Results.** Every unit and e2e shard uploads JUnit to Codecov Test Analytics with `fail_ci_if_error: false`, for history. Codecov never decides a check.

Trunk Flaky Tests was considered: it detects and auto-quarantines by overriding the test step's exit code. It was rejected because an outside service would then decide whether a check passes, and `ci:local` could not reproduce that.

## Consequences

- A pull request that changes a spec takes longer: about 30 runs of that spec file, and five of an e2e spec on a macOS runner.
- A flaky test written today fails its own pull request instead of someone else's next week.
- A flaky test already on `main` is named within a day, and stops blocking other work for at most 7 days while it is fixed or deleted.
- Retries stay at zero (`playwright.config.ts`), and skipping a test is still forbidden.
