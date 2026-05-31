#!/usr/bin/env bash
# UserPromptSubmit hook: when a /speckit.* command fires, inject Forge's
# current codebase context (stack summary + stale doc count) as additionalContext.
set -euo pipefail

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""')
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Only fire when the prompt is a /speckit.* slash command
if ! echo "$PROMPT" | grep -Eq '^\s*/speckit\.'; then
  exit 0
fi

STACK_FILE="$ROOT/.claude/stack.json"
DOC_INDEX="$ROOT/.claude/doc-index.json"

# Build stack summary
if [ -f "$STACK_FILE" ]; then
  LANGS=$(jq -r '.languages | join(", ")' "$STACK_FILE" 2>/dev/null || echo "unknown")
  AST_TOOL=$(jq -r '.ast_search_tool // "not installed"' "$STACK_FILE" 2>/dev/null || echo "unknown")
  STACK_SUMMARY="Stack: $LANGS | ast-search: $AST_TOOL"
else
  STACK_SUMMARY="Stack: unknown (run /forge.detect-stack)"
fi

# Count stale docs
STALE_COUNT=0
if [ -f "$DOC_INDEX" ]; then
  STALE_COUNT=$(jq '[.entries[] | select(.staleness_score > 0)] | length' "$DOC_INDEX" 2>/dev/null || echo 0)
fi

# Find latest research brief
LATEST_RESEARCH=$(find "$ROOT/.forge" -name "research.md" 2>/dev/null | sort | tail -1 || true)
RESEARCH_LINE=""
if [ -n "$LATEST_RESEARCH" ]; then
  RESEARCH_LINE=" | Latest research: ${LATEST_RESEARCH#$ROOT/}"
fi

CONTEXT="[Forge context] $STACK_SUMMARY | Stale docs: $STALE_COUNT${RESEARCH_LINE}"

jq -n --arg ctx "$CONTEXT" \
  '{ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: $ctx } }'
