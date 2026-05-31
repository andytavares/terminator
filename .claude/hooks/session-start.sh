#!/usr/bin/env bash
# SessionStart hook: prints repo facts that Claude needs immediately.
# stdout is added to Claude's context.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

echo "=== session-start ==="
echo "repo: $(basename "$ROOT")"
echo "head: $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo 'not a git repo')"
echo "branch: $(git -C "$ROOT" branch --show-current 2>/dev/null || echo n/a)"

# Re-detect stack if missing or stale (>7 days)
STACK="$ROOT/.claude/stack.json"
if [ ! -f "$STACK" ] || [ "$(find "$STACK" -mtime +7 2>/dev/null)" ]; then
  echo "stack.json missing or stale — run /forge.detect-stack to refresh"
else
  echo "stack: $(jq -r '.languages | join(",")' < "$STACK" 2>/dev/null || echo 'unparseable')"
  echo "test:  $(jq -r '.test.command // "n/a"' < "$STACK" 2>/dev/null)"
  echo "lint:  $(jq -r '.lint.command // "n/a"' < "$STACK" 2>/dev/null)"
fi

# Surface recent uncommitted changes
DIRTY=$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "$DIRTY" -gt 0 ]; then
  echo "uncommitted: $DIRTY file(s) — Claude should ask before destructive ops"
fi

# Doc index health
INDEX="$ROOT/.claude/doc-index.json"
if [ -f "$INDEX" ]; then
  STALE=$(jq '[.entries[] | select(.staleness_score > 0)] | length' < "$INDEX" 2>/dev/null || echo 0)
  echo "stale-docs: $STALE entries need doc-keeper attention"
fi

# Project constitution injection
CONSTITUTION="$ROOT/.forge/constitution.md"
if [ -f "$CONSTITUTION" ]; then
  CHAR_COUNT=$(wc -m < "$CONSTITUTION" | tr -d ' ')
  if [ "$CHAR_COUNT" -gt 2000 ]; then
    echo "constitution: WARNING — .forge/constitution.md is ${CHAR_COUNT} characters (limit 2000). Trim it or Claude will not see it. Run /forge.constitution to edit."
  else
    echo "=== project-constitution ==="
    cat "$CONSTITUTION"
    echo "=== end project-constitution ==="
  fi
else
  echo "constitution: not found — run /forge.constitution to create one"
fi
