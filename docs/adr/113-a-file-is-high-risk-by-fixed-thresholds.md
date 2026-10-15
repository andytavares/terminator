# ADR 113: A file is high risk by fixed thresholds

**Status**: Accepted
**Date**: 2026-10-14
**Relates to**: [ADR 072](072-a-review-reads-definitions-before-callers.md)

## Context

`computeRiskScore` (`extensions/git-integration/src/github/pr-review-service.ts`) scaled each metric min-max across the files of the same PR, then called a composite of 67 or more "high". In a two-file PR, the larger file scored 1.0 on every metric. So a 3-line change with 2 commits in 90 days read **High risk 80/100**, and its driver read "High churn — 2 commits/90d". `withComplexity` in `stores/pr-review.store.ts` did the same again when complexity arrived. The queue (150 and 400 lines) and the signal dots (churn 20 and 50, importers 10 and 20) already used fixed numbers.

## Decision

**A file's risk level comes from fixed floors in `src/review/risk-thresholds.ts`, the same numbers the queue and the signal dots use.**

- **High:** 50 or more commits in 90 days, 20 or more importers, or 400 or more changed lines.
- **Medium:** 20 or more commits, 10 or more importers, or 150 or more lines.
- **Low:** anything else.
- The relative composite stays. It orders files and nothing more. Complexity raises the composite and never changes the level.
- A driver label claims "changes often", "wide reach" or "large change" only past its floor. Otherwise it states the count ("2 commits in 90 days").

## Consequences

- A PR's labels mean the same thing in every PR, whatever the other files are.
- The file header shows a risk chip only for high. Medium and low appear in **Why this file**, which lists each factor against its floor.
- The queue's churn and used-by signal dots use the same floors and the same `>=` as the level, so at exactly 20 commits both read medium.
