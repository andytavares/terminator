---
description: Export a context snapshot for external tools. Writes .forge/context-snapshot.json containing the current stack, stale docs, and latest research brief path — a single file any tool (Speckit, Cursor, CI) can read to get current codebase state.
---

Write `.forge/context-snapshot.json` with the following steps:

1. Read `.claude/stack.json`. If it does not exist or is older than 7 days, print a warning: "stack.json is missing or stale — run /forge-detect-stack first." and stop.

2. Read `.claude/doc-index.json`. Collect all entries where `staleness_score > 0`. These are stale docs.

3. Find the most recently modified file matching `.forge/*/research.md`. Record its path.

4. Write `.forge/context-snapshot.json`:

```json
{
  "generated_at": "<ISO 8601 timestamp>",
  "stack": <contents of .claude/stack.json>,
  "stale_docs": [
    { "path": "<path>", "staleness_score": <n>, "title": "<title>" }
  ],
  "latest_research": "<path to most recent .forge/*/research.md, or null>",
  "forge_version": "<VERSION from scripts/forge.sh>"
}
```

5. Print: `Context snapshot written to .forge/context-snapshot.json`
   Then print a compact summary:
   - Stack: `<languages>` / ast_search_tool: `<value>`
   - Stale docs: `<count>` entries
   - Latest research: `<path or "none">`
