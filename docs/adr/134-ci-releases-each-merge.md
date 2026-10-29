# ADR 134: CI releases each merge

**Status**: Accepted

**Date**: 2026-10-29

Amends ADR 128 (where the release runs) and ADR 132 (what the release runs).

## Context

A merge to `main` started two workflows: CI, which ran the tests the change reaches (ADR 132), and `release.yml`, which ran every unit and e2e test again before it packaged the app. Each merge paid for a full test run, and two pipelines did the same setup.

## Decision

1. **The release is the last job of `ci.yml`** (`release`, then `release-cleanup`). It runs on a push to `main` only, once every check has passed: Lint, Typecheck, Format, Stories, Story screenshots, Test, Stability, Start and E2E result.
2. **The release runs no tests of its own.** A merge is released on the tests its change reaches (Constitution XIV, 7.0.0, approved by the maintainer on 2026-10-29). The nightly sweep still runs every test.
3. **One release at a time.** The job's `concurrency` group is `release` and never cancels a release in progress. A push waiting behind another is released with the next one. The bump commit carries `[skip ci]`, so it does not start another run.
4. **`release.yml` is deleted.** `ci:local` never runs the release jobs (`SKIPPED_JOBS` in `scripts/ci-plan.mjs`).
5. **The release runs on `macos-26`**, the one macOS runner CI uses (ADR 123), not `macos-14`.

## Consequences

- A regression in code a change does not reach can be released. The nightly sweep finds it within a day.
- A release no longer waits for a second full test run.
- Releases can no longer be started by hand. A push to `main` is the only trigger.
