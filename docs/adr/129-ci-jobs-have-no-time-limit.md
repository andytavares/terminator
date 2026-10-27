# ADR 129: CI jobs have no time limit

**Status**: Accepted, amended by ADR 132

**Date**: 2026-10-26

Amends ADR 123 (tests run once, sealed and selected): "Every job has a time limit of 8 minutes or less" no longer holds.

## Context

ADR 123 gave every job and many steps a `timeout-minutes` of 8 or less. A job that ran long was cancelled and its check went red, though nothing in it had failed. On PR #312, Quarantine (E2E) was cancelled this way after 15 minutes.

## Decision

1. **No workflow sets `timeout-minutes`**, on a job or a step. `tests/unit/scripts/ci-plan.spec.ts` fails if any file in `.github/workflows` does.
2. **Eight minutes per step stays the goal.** A step that takes longer is a finding to fix (split a shard, re-record `timings.json`), not a reason to cancel the run.

## Alternatives considered

- **Higher limits.** A run that is slow but correct still fails, only later.
- **Limits on some jobs only.** Each limit still cancels a correct run, and a lint rule cannot tell a hang from a slow runner.

## Consequences

- A hung job runs until GitHub's own limit (6 hours on a hosted runner, https://docs.github.com/en/actions/reference/limits) or until someone cancels it.
