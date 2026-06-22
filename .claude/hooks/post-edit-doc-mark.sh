#!/usr/bin/env bash
# PostToolUse hook on Edit|Write: bumps staleness_score for any doc whose
# referenced_code_paths includes the edited file. A referenced path ending in
# "/" is treated as a directory: editing any file under it counts as a match,
# so docs that reference whole trees (e.g. ".claude/skills/") are flagged when
# anything in that tree changes — not only when a file at that exact path is.
set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""')
[ -z "$FILE_PATH" ] && exit 0

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
INDEX="$ROOT/.claude/doc-index.json"
[ ! -f "$INDEX" ] && exit 0

# Make the path repo-relative. Avoid `realpath --relative-to` (GNU-only; absent
# on macOS), which would leave an absolute path that never matches the relative
# referenced_code_paths. Stripping the repo root prefix works on every platform.
REL="${FILE_PATH#"$ROOT"/}"

# Bump staleness for matching entries. Directory references (trailing "/") match
# by prefix; file references match exactly.
TMP=$(mktemp)
jq --arg p "$REL" '
  .entries |= map(
    if ((.referenced_code_paths // []) | any(
          . as $rp
          | if ($rp | endswith("/")) then ($p | startswith($rp)) else ($p == $rp) end
        ))
    then .staleness_score = ((.staleness_score // 0) + 1)
    else . end
  )
' < "$INDEX" > "$TMP" && mv "$TMP" "$INDEX"
