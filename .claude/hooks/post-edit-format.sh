#!/usr/bin/env bash
# PostToolUse hook on Edit|Write: runs project formatter on the changed file.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')
[ -z "$FILE_PATH" ] && exit 0
[ ! -f "$FILE_PATH" ] && exit 0

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
STACK="$ROOT/.claude/stack.json"
[ ! -f "$STACK" ] && exit 0

CMD=$(jq -r --arg p "$FILE_PATH" '.format.by_extension[($p | split(".") | last)] // empty' < "$STACK" 2>/dev/null)
if [ -n "$CMD" ]; then
  eval "$CMD \"$FILE_PATH\"" >/dev/null 2>&1 || true
fi
