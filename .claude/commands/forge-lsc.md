---
description: Plan and execute a large-scale change (rename/migrate/swap a contract across many call sites) using the large-scale-change skill
---

Run the `large-scale-change` skill for: $ARGUMENTS

First delegate to the `change-impact-analyst` subagent to enumerate the full caller set and the
Hyrum's-Law risks, then produce the sharded migration plan and execute it shard by shard, keeping
trunk green. If no argument is given, ask what symbol/API is changing.
