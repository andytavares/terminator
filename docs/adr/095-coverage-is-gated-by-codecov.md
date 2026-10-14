# ADR 095: Coverage is gated by Codecov on the lines a change touches

**Status**: Accepted
**Date**: 2026-10-12
**Relates to**: Constitution Principle VI (2.0.0)

## Decision

The coverage gate is the Codecov statuses on the pull request, as configured in `codecov.yml`: `codecov/patch` at 80% of the lines the change adds or modifies, and `codecov/project`. A failing status is a failed change. The local gates that measure something else are removed: the four 80% thresholds in `vitest.config.ts` and the whole-file check in `scripts/check-patch-coverage.cjs` run by the pre-commit hook.

`codecov.yml` sets `if_ci_failed` and `if_not_found` to `error`, so a missing report or a failed test run cannot produce a passing status ([docs](https://docs.codecov.com/docs/commit-status)).

A branch that no real caller can reach is deleted together with its test, and a dependency that production always supplies is required, not optional.

## Context

The old rule measured whole files on statements, branches, functions and lines. Touching an old file forced tests for its untested branches, and every `?.` and `??` needed a case. The 2026-10-11 audit found 27% of cases in gated git-integration directories failed the standard of testing a reachable scenario, against 5% in ungated ones, and about 12% of all cases failed it overall. Partial mocks forced guards into production code, which then needed more cases.

## Alternatives considered

| Alternative                                | Why rejected                                               |
| ------------------------------------------ | ---------------------------------------------------------- |
| Keep the four-metric whole-file gate       | Produces the tests it should prevent                       |
| A local changed-line script beside Codecov | Two gates that can disagree; Codecov is the one CI reports |

## Consequences

- `codecov/patch` must be a required status check on `main`; branch protection is the place that makes it binding.
- Deleting unreachable code and its tests can lower project coverage; those deletions ship with the gate change, not before it.
