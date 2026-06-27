# Conflict Test File

This file exists solely to produce merge conflicts for testing the conflict resolver UI.
Each section represents a different conflict scenario.

---

## Scenario 1 — Accept Theirs (PR wins)

The PR branch has the correct fix. The reviewer should choose the incoming change.

timeout = 5000
retry_count = 3
endpoint = "/api/v1/legacy"

---

## Scenario 2 — Accept Mine (Base wins)

The base branch has the correct value. The reviewer should keep the current version.

max_connections = 100
pool_size = 10
log_level = "info"

---

## Scenario 3 — Keep Both

Both branches added valid, non-overlapping items to this list. The resolver should
keep all entries from both sides.

features:

- dark_mode
- auto_save

---

## Scenario 4 — Three-Way Merge

The common ancestor (main) had version 1. Both branches independently updated the
same block: branch-a to version 2, branch-b to version 3. Neither is a clear winner.

version = "2.0.0-branch-a"
changelog = "Bumped to 2.0 with performance improvements"
author = "Team A"
