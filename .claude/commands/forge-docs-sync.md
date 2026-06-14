---
description: Refresh markdown docs that reference recently changed code
---

Run the `doc-keeper` subagent. It will:

1. Read `.claude/doc-index.json`.
2. Find entries with `staleness_score > 0` or `referenced_code_paths` overlapping with the last N commits.
3. Update each stale markdown to match the current code.
4. Bump `last_verified_commit` for verified entries.

Report a summary: docs updated, docs flagged as user-facing gaps, docs left untouched.
