# Pre-Change Baseline

**Feature**: `032-branch-first-sidebar` | **Captured**: 2026-08-27
**Base commit**: `fc8ef78a` (branched from `main` at `007a02ff`, which already contains PR #155)

Recorded per task T002 so that any later failure is attributable to this feature rather than inherited.

## Test suite

| Metric     | Value              |
| ---------- | ------------------ |
| Test files | 387 passed (387)   |
| Tests      | 6984 passed (6984) |
| Failures   | 0                  |

## Coverage — project and the two directories this feature touches

| Scope                             | Statements | Branches | Functions | Lines |
| --------------------------------- | ---------- | -------- | --------- | ----- |
| All files                         | 94.95      | 88.34    | 91.64     | 96.21 |
| `src/renderer/components/sidebar` | 93.58      | 90.02    | 91.96     | 94.86 |
| `src/renderer/sidebar`            | 99.39      | 99.29    | 100       | 100   |

Files this feature modifies:

| File               | Statements | Branches | Functions | Lines | Uncovered |
| ------------------ | ---------- | -------- | --------- | ----- | --------- |
| `SessionGroup.tsx` | 94.28      | 100      | 87.5      | 93.54 | 233–244   |
| `SessionRow.tsx`   | 96.42      | 94.23    | 95.23     | 97.87 | 155       |

Every one of these is already above the 80% gate, so this feature must not lower them.

## Other gates

| Gate                  | Result                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| `npm run lint`        | 0 errors, 24 warnings (all pre-existing `react-hooks/exhaustive-deps`) |
| `npx playwright test` | 53 passed                                                              |

## T001 — rebase prerequisite

**Already satisfied; no rebase performed.** PR #155 (`032-sidebar-workspace-grouping`) merged to `main` as `9ac89a43` while this feature was being planned, and this branch was cut from `main` after a `--ff-only` pull. Verified: `git merge-base --is-ancestor 6a501482 HEAD` returns true, and `SessionGroup.tsx` carries the `nested` and `workspaceName` props this feature builds on.

The plan and tasks documents were written when #155 was still open and describe the rebase as pending. That text is now stale rather than wrong; it is left as written so the planning record stays honest about what was known at the time.
