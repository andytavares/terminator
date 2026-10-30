# ADR 095: Coverage is gated by Codecov on the lines a change touches

**Status**: Accepted
**Date**: 2026-10-12
**Relates to**: Constitution Principle VI (2.0.0)

## Decision

The coverage gate is the Codecov statuses on the pull request, as configured in `codecov.yml`. `codecov/patch` requires 80% of the lines that the change adds or modifies. `codecov/project` is the second status. A failing status is a failed change.

The local gates that measure something else are removed:

- the four 80% thresholds in `vitest.config.ts`
- the whole-file check in `scripts/check-patch-coverage.cjs`, which the pre-commit hook runs

`codecov.yml` sets `if_ci_failed` and `if_not_found` to `error`. So a missing report or a failed test run cannot produce a passing status ([docs](https://docs.codecov.com/docs/commit-status)).

Delete a branch that no real caller can reach, together with its test. Require a dependency that production always supplies. Do not make it optional.

## Context

The old rule measured whole files on statements, branches, functions and lines. Touching an old file forced tests for its untested branches. Every `?.` and `??` needed a case. The audit of 2026-10-11 found these results:

- 27% of cases in gated git-integration directories failed the standard of testing a reachable scenario.
- 5% of cases in ungated directories failed it.
- About 12% of all cases failed it overall.

Partial mocks forced guards into production code. Those guards then needed more cases.

## Alternatives considered

| Alternative                                | Why rejected                                               |
| ------------------------------------------ | ---------------------------------------------------------- |
| Keep the four-metric whole-file gate       | Produces the tests it should prevent                       |
| A local changed-line script beside Codecov | Two gates that can disagree; Codecov is the one CI reports |

## Consequences

- `codecov/patch` must be a required status check on `main`. Branch protection is the place that makes it binding.
- Deleting unreachable code and its tests can lower project coverage. Those deletions ship with the gate change, not before it.
