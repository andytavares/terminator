# Clarifications — 003-task-vault-recurring-engine-rewrite

## Resolved (2)

### End-count boundary condition

**Question:** The `after_count` end condition in `ensureNextOccurrence` — should it match the existing `spawnCount + 1 >= endCount` boundary exactly?

**Resolution:** Yes — replicate exactly. `endCount = 3` means the original task + 2 spawned occurrences (3 total). The check is `completedCount + 1 >= endCount` before inserting. This preserves existing user expectations.

**Affects:** T-003, T-004

### Single PR delivery

**Question:** Should the 10 tasks ship in 4 separate PRs (per merge guidance) or one?

**Resolution:** Ship everything in one PR. All 10 tasks go on a single branch `forge/003-task-vault-recurring-engine-rewrite`.

**Affects:** All tasks

## Deferred (0)
