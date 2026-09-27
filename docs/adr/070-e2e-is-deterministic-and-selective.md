# ADR 070: E2E is deterministic and selective

**Status**: Accepted

**Date**: 2026-09-27

## Context

The merge of PR #210 went red in E2E ([run 36290488257](https://github.com/andytavares/terminator/actions/runs/36290488257)). Both failures were deterministic, and both were already red on the PR, which merged because E2E was not a required check. Over the previous 98 CI runs, only 52 passed E2E clean; 28 passed only because `retries: 1` hid a failure, and 18 failed. Every PR ran all 190 tests, and E2E started only after the 5-minute unit job. The research is in `docs/research/e2e-deterministic-selective.md`.

## Decision

- No retries, locally or on CI. A test that fails once fails the build.
- Every flake class found gets fixed at its cause:
  - Profile cleanup moves to a global teardown, so it can no longer fail a test.
  - Sleeps become polls on the asserted condition.
  - Keys wait for the surface that should receive them to hold focus.
  - Each test passes when run alone.
  - Terminals start a stub `claude` from a fixture shell config, so no real agent runs.
  - Launches pass `-ApplePersistenceIgnoreState YES`. Without it, macOS's crash-restore alert blocks startup after an earlier app was force-killed.
  - A modal that opens while a terminal refocus is queued keeps its focus.
- `scripts/e2e-select.mjs` maps the changed paths to spec files. A core path, a push to `main` or any path the map does not know runs everything. A docs-only diff runs nothing.
- Changed specs run three times in a row before they can merge.
- Build starts alongside the other checks. E2E runs in two shards and reports through one `E2E result` job. That job is the check branch protection requires.

## Motivation

A retry is a policy of accepting non-determinism. Every flake in the record had a nameable cause. Most were in the harness; one was a focus race in the app. Selection matters because half the merged PRs touched only Foundry, and each of them paid for the whole suite.

## Alternatives Considered

- **Playwright `--only-changed`.** It follows the spec files' imports. E2E specs import no app code, so it cannot see an app change.
- **Coverage-based impact analysis.** Precise, but it needs coverage plumbing through Electron main, the renderer and every extension view.
- **Keep `retries: 1` and add `failOnFlakyTests`.** It reaches the same verdict, but spends the retry's time first.
- **Quarantine known flakes.** It removes coverage exactly where the bugs are.
- **`fullyParallel: true`.** Every file shares one app across its tests through `beforeAll`, so this would relaunch the app for each slice.

## Consequences

- A new spec must be placed in the map, the smoke set or the core set, or the selector's unit test fails.
- `waitForTimeout` cannot be used in `tests/e2e`; an ESLint rule rejects it.
- A PR whose E2E was skipped by selection merges green. The next push to `main` runs everything and catches a miss.
