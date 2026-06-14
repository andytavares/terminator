#!/usr/bin/env bash
# PostCompact hook: reinjects the project constitution after context compaction.
# Uses the same additionalContext envelope as prompt-augment.sh.
set -euo pipefail

# Consume stdin (event JSON) — required by the hook protocol even if unused.
INPUT=$(cat)

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CONSTITUTION="$ROOT/.forge/constitution.md"

if [ -f "$CONSTITUTION" ]; then
  CHAR_COUNT=$(wc -m < "$CONSTITUTION" | tr -d ' ')
  if [ "$CHAR_COUNT" -gt 2000 ]; then
    echo "PostCompact: constitution is ${CHAR_COUNT} characters (limit 2000) — skipping injection. Run /forge-constitution to trim it." >&2
  else
    CONTENT=$(cat "$CONSTITUTION")
    jq -n --arg c "$CONTENT" \
      '{ hookSpecificOutput: { hookEventName: "PostCompact", additionalContext: $c } }'
  fi
else
  echo "PostCompact: no project constitution found — run /forge-constitution to create one" >&2
fi
