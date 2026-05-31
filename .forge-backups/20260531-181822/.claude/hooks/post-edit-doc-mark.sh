#!/usr/bin/env bash
# PostToolUse hook on Edit|Write: bumps staleness_score for any doc whose
# referenced_code_paths includes the edited file.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')
[ -z "$FILE_PATH" ] && exit 0

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
INDEX="$ROOT/.claude/doc-index.json"
[ ! -f "$INDEX" ] && exit 0

REL=$(realpath --relative-to="$ROOT" "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")

# Bump staleness for matching entries
TMP=$(mktemp)
jq --arg p "$REL" '
  .entries |= map(
    if (.referenced_code_paths // []) | index($p)
    then .staleness_score = ((.staleness_score // 0) + 1)
    else . end
  )
' < "$INDEX" > "$TMP" && mv "$TMP" "$INDEX"
